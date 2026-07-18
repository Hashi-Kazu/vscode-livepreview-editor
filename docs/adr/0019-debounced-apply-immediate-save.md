---
name: debounced-apply-immediate-save
description: Debounced batch apply plus immediate save to eliminate lingering dirty state.
metadata:
  type: project
---

# ADR-0019: Debounced batch apply plus immediate save

- **ステータス**: 採択済み（ADR-0018 を supersede）
- **確信度**: 高

## コンテキスト

ADR-0015 追記のとおり、`workspace.applyEdit` / `document.save()` の副作用で VS
Code コアが対象 URI のソースタブを自動再表示することがある。R-03-11
（`closeAutoOpenedSourceTab`）は再表示されたタブを閉じる補完策だが、これは対症
療法であり、根本原因は **TextDocument が dirty のまま滞留すること**にある。

ADR-0018（v1.26.0）では毎打鍵アイドル自動保存を廃止し、明示保存（Ctrl+S）＋失
焦・破棄・バインド切替の flush 保存へ移行した。しかしこのモデルでは、ユーザーが
Live Preview のみで編集を続けている間、apply 済みだが未保存の変更が dirty として
長時間滞留する。この dirty 窓の間にコアがソースタブを再表示し、抑制処理をすり抜
けたり、ちらつきとして観測されたりする。

「キャレット問題」（保存参加者・format-on-save の非同期エコーが外部変更と誤検知さ
れキャレットが後退する現象、ADR-0018 Context）は per-keystroke *apply* を要求して
いない。要求しているのは「save 参加者エコーの安全な吸収」だけで、それは
`SelfSaveGuard` / `isSaveParticipantNormalization` / `preserveHistory` /
`computeRemotePatch` / `isTrailingNewlineOnlyDifference` が担う。したがって apply
の間引き（デバウンス化）はキャレット問題と独立して両立でき、save 頻度が下がる分
エコー発生頻度も下がるため安全側である。

## 決定

- Webview→TextDocument 反映を毎打鍵 apply から**タイピング停止後のデバウンス**
  （既定 200ms、モジュール定数 `EDIT_APPLY_DEBOUNCE_MS`、設定項目化しない）での
  **バッチ apply** へ変更する。`'edit'` メッセージは即 apply せず binding の
  `pendingEdit` を最新 version で coalesce（最新 version 勝ち）し、タイマーを張り
  直す。
- タイマー発火・および全 flush 点は `flushPendingEdit(viewer)` に統一する。これは
  serial `operationQueue` 内で「pending があれば `applyEdit` →続けて
  `performSave`」を直列実行し、**apply 直後に必ず即時保存**して dirty 窓を最小化
  する。これにより dirty 滞留が無くなり、ソースタブ再表示の発生源を断つ。
- flush 点は次のすべて（取りこぼしゼロ）: 失焦（blur）、破棄（dispose）、バインド
  切替（switchDocument、旧 binding を flush してから切替）、明示保存（Ctrl+S の
  `'save'` メッセージ）、外部変更処理の入口（`onDidChangeTextDocument` で self-echo
  でない変更を分類する前に pending を flush）。
- キャレット退行防止機構（`SelfSaveGuard` own-save 窓、
  `isSaveParticipantNormalization`、`classifyDocumentChange` の
  `preserveHistory`、`computeRemotePatch`、`isTrailingNewlineOnlyDifference`）と
  ack・ledger プロトコルは一切変更しない。
- pending edit と保存参加者イベントが競合した場合、document-change listener はイベン
  ト時点で own-save／保存正規化か真の外部変更かを分類し、その由来を queue へ渡す。
  queue 内で pending の apply→即時保存を先に完了し、保存正規化由来なら bound
  `TextDocument` を再読込して最終本文を再分類する。捕捉済みの古い保存正規化 snapshot
  は更新済み ack version で Webview へ送らない。真の外部変更は捕捉 snapshot を保持し、
  flush 後も一度だけ authoritative に配信する。
  - flush が真の外部 snapshot を TextDocument 上で上書きした場合は、専用の期待 echo
    guard を付けた最小 `WorkspaceEdit` で外部 snapshot を復元して即時保存し、ディスク・
    TextDocument・binding・Webview を収束させる。
  - 再読込中により新しい document version の真の外部イベントが届いた場合は version
    ごとのイベント由来を柵とし、先行保存正規化 callback は処理を譲って後続イベント
    自身に一度だけ authoritative 処理させる。flush 自身の保存参加者による最新 version
    だけを history-preserving に取り込む。
- R-03-11 の抑制処理（`suppressSourceAutoOpen`、`closeAutoOpenedSourceTab`、
  `decideAutoOpenedTabsToClose`）は撤去せず **backstop** として残置する。

## 理由

- dirty 滞留が根本原因であり、apply 直後の即時保存でそれを消せば再表示の発生源を
  断てる（R-03-11 は保険として残す）。
- デバウンス中はホストが未 apply のため自己エコーも remote update も発生せず、
  Webview 内のキャレットはそのまま保持される（キャレット問題に対しむしろ安全側）。
- Live Preview の Undo/Redo は CodeMirror が単独所有（webview ローカル）のままで不
  変。ソースエディタ側の undo 粒度がバッチ単位に粗くなるだけで許容範囲。
- coalesce しても ledger は version-keyed のため整合し、デバウンス中は Webview の
  `editVersion > ackVersion` により remote update が保留される既存挙動が正しく機能
  する。

## 影響

- 保存モデルが「明示保存＋ライフサイクル flush」から「デバウンスバッチ apply＋即
  時保存（＋明示保存・flush 点）」へ変わる。ADR-0018 を supersede する。
- 未保存インジケータ（R-31）は通常 `dirty=false` のためほぼ表示されない（apply→
  save 間の一瞬・保存失敗時のみ）。機構自体は残す。
- 実挙動（EDH）の確認は手動受け入れが必要。純粋ロジック・既存同期テストの非回帰と
  compile 通過で担保する。

## 追記：ソースタブ自動クローズ backstop の廃止（2026-07-19）

v1.29.0 の決定時に残置した R-03-11 の抑制処理は、`workspace.applyEdit()` または
`document.save()` の待機中にユーザーが自発的に開いたタブと、VS Code の副作用で
表示されたタブを完全には識別できない。拡張機能がユーザーのタブを誤って閉じる
可能性を排除するため、v1.34.0 でこの判断を部分的に supersede する。

- dirty 滞留への対策は、デバウンス apply＋直後保存に一本化する。
- `vscode.window.tabGroups.close()` を使用したソースタブ自動クローズ処理、
  `livePreview.suppressSourceAutoOpen` 設定、およびクローズ対象の判定ロジックを廃止する。
- 拡張機能はソースエディタータブを自動的に閉じない。
