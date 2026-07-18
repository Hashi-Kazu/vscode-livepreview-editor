# Live Preview Editor アーキテクチャ

**関連文書**: [requirements-usdm.md](requirements-usdm.md) | [acceptance-tests.md](acceptance-tests.md)

## 全体構成

```text
┌─────────────────────────────────────────────────────┐
│ VS Code Extension Host                              │
│ src/extension.ts                                    │
│ src/livePreviewViewerManager.ts                     │
│ - editable WebviewPanel の生成・URI 重複防止          │
│ - TextDocument 再取得・最小差分 WorkspaceEdit・明示/flush 保存 │
│ - active text editor follow・文書再バインド           │
└───────────────────────┬─────────────────────────────┘
                        │ init/update/edit/openLink/pasteMedia/insertMedia/…
┌───────────────────────▼─────────────────────────────┐
│ Webview (browser/IIFE) src/webview/main.ts          │
│ - CodeMirror 6 EditorView                           │
│ - Decoration / formatting / checkbox / link         │
│ - binding generation を全ドキュメント依存通知へ付与    │
└───────────────────────┬─────────────────────────────┘
                        │ pure functions
┌───────────────────────▼─────────────────────────────┐
│ src/core/                                           │
│ - model.ts: decoration descriptors                  │
│ - sync.ts: diff/EOL/IME/resync                      │
│ - viewer.ts: follow/dedup/binding decisions         │
│ - viewport.ts, format.ts, editing.ts                │
└─────────────────────────────────────────────────────┘
```

## ビューアライフサイクル

- `livePreview.openWith` は標準ソースを置換せず、`livePreview.viewer` の editable `WebviewPanel` を `ViewColumn.Beside` に作成する。
- `customEditors` contribution と `CustomTextEditorProvider` は使用しない。`livePreview.toggleSource` も提供しない。
- `viewersByUri` が URI ごとの所有者を管理する。同一 URI の再オープンは既存パネルを reveal し、異なる URI は複数パネルを許可する。
- パネルの active 状態と Webview の focus/pointer 操作で `lastInteractedViewerId` を更新する。書式コマンドと active editor follow はこのビューアを対象にする。
- `livePreview.followActiveEditor`（既定 `true`）が有効なとき、アクティブな Markdown ソースへ最後に操作したビューアを再バインドする。対象 URI の所有者が既に存在する場合は重複を作らず、その所有者を維持する。ビューアがまだなければ follow だけでは新規作成しない。

## 安全な文書切り替え

各 Viewer は `operationQueue` を持ち、Webview 編集と文書切り替えを受信順に直列化する。切り替えは先行する編集の `WorkspaceEdit` と保存の完了後に実行される。失焦・dispose の flush 保存も同じキューへ追加するため、dispose 前に受信した edit はパネル破棄後でも TextDocument への適用と保存を完走する（Webview 返信だけを抑止する）。

保存モデルはデバウンスバッチ apply＋即時保存である（ADR-0019、ADR-0018 を supersede）。毎打鍵アイドル自動保存（`SaveDebouncer`、ADR-0018 で廃止）には戻さない。Webview の `edit` は即 apply せず binding の `pendingEdit` に最新 version で coalesce し、タイピング停止後のデバウンス（既定 200ms、`EDIT_APPLY_DEBOUNCE_MS`）でバッチ apply する。apply とその直後の保存は単一の `flushPendingEdit` 操作として `operationQueue` 内で直列実行し（apply が save に先行）、apply 直後に必ず `performSave`（dirty のときだけ `document.save()`）して TextDocument の dirty 滞留を無くす。ソースタブ再表示への対策はこの dirty 滞留防止に一本化し、拡張機能はソースエディタータブを自動的に閉じない。

flush 点はすべて `flushPendingEdit` に統一する（取りこぼしゼロ）。

- 明示保存: WebviewPanel は `CustomTextEditor` ではないため VS Code の Ctrl+S は下層 TextDocument に届かない。Webview 側で `Ctrl+S`/`Cmd+S` を捕捉し `preventDefault` して host へ `save` メッセージを送り、host が `operationQueue` 上で `flushPendingEdit`（pending apply→save）を実行する。
- flush 保存: 失焦（パネル非 active 化）・dispose・バインド切替、および外部変更処理の入口の各時点で `flushPendingEdit` を呼び、受信済み edit の後ろに直列化してデータ喪失を防ぐ。

Live Preview の Undo/Redo は CodeMirror が単独所有のままで不変（デバウンス化の影響を受けない）。保存参加者・format-on-save のエコーは即時保存でも発生するため、`SelfSaveGuard` の own-save 窓、`isSaveParticipantNormalization`、`preserveHistory` レコンサイルは Undo 安全機構として据え置く。

各文書バインドには単調増加する `generation` を付ける。Webview は `edit`、`pasteMedia`、`openLink`、`renderError` に現在の generation を付与し、ホストは現在値と異なる遅延メッセージを拒否する。切り替え時は次を一括して更新する。

- URI 所有者マップ
- パネルタイトル
- `localResourceRoots` と画像等の resource base
- `onDidChangeTextDocument` listener
- LF 正規化済み Webview テキスト

## TextDocument と同期

Webview 編集のたびに `workspace.openTextDocument(uri)` で対象を取得する。この API は文書をロードするがエディタを reveal しないため、標準ソースタブを閉じた後も Live Preview から編集できる。

Webview の Live Preview Undo/Redo は CodeMirror `history()` だけが所有する。編集は `diffRange` と `fromLFPreserving` で既存 EOL を維持した最小 `WorkspaceEdit.replace` として即時適用する。host は最後に受理した version、成功 ack version、期待 LF 本文＋TextDocument version の version-keyed self-echo ledger を別々に管理し、ledger に一致しない変更を `classifyDocumentChange` で分類し、operationQueue で直列配信する。自己保存由来（`SelfSaveGuard.isActive` の own-save 窓、または `isSaveParticipantNormalization` が説明できる EOL・末尾改行・行末空白だけの差分）は `preserveHistory` 付きで送り、Webview は `computeRemotePatch` の最小差分を `addToHistory.of(false)` で適用して CodeMirror history を保持したままレコンサイルする。真の外部変更のみ authoritative update とする。Webview は `baseVersion === editVersion === ackVersion` の update だけを適用し、IME または未 ack edit 中は最新1件を保留する。真の外部更新・apply false rollback は `computeRemotePatch` で選択を再マップした新しい EditorState に置換し、古い CodeMirror history を破棄する。`paste`/`drop`/`dragover` は `Prec.highest(EditorView.domEventHandlers)` で DataTransfer の File、URI MIME、file URI-only plain text を処理する。URI は File より優先し、host response の request ID と追従選択範囲を使って snippet を挿入する。

`onDidChangeTextDocument` は ledger 不一致イベントを受けた時点で、`SelfSaveGuard` と内容差分から「保存正規化由来」か「真の外部変更」かを分類し、その由来とイベント snapshot を `operationQueue` へ保持する。pending edit がある場合は、同じ queue 項目内で `flushPendingEdit`（apply→save）を先に完了させる。保存正規化由来はその後 bound `TextDocument` を再取得して最終本文を再分類し、イベント時点の古い snapshot は再利用しない（最終改行だけなら従来どおり host 側のみ整合）。真の外部変更は flush 後も捕捉 snapshot を authoritative として一度だけ配信する。この順序により `lastAckVersion` が進んだ後に stale save-normalization update が version gate を通ることを防ぐ。

各 non-ledger イベントは TextDocument version ごとの由来と LF 本文を reconciliation 完了まで保持する。保存正規化後の再読込がより新しい真の外部イベントの version に到達した場合、古い callback は処理を譲り、後続 callback が authoritative update を一度だけ担当する。逆に flush 自身の保存参加者イベントなら、その最新本文を history-preserving に処理する。pending flush が捕捉済みの真の外部本文を TextDocument 上で上書きした場合は、専用の exact echo guard を登録して最小 `WorkspaceEdit` で外部本文を復元し、即時保存後の本文を Webview と binding へ送る。復元 apply の自己イベントは guard で吸収し、保存参加者イベントだけを通常の queue へ流すため、再入して外部変更と誤分類しない。

## Webview 描画

`computeDecorations` が返す `DecoSpec[]` を `src/webview/decorations.ts` が CodeMirror Decoration に変換する。`src/core/viewport.ts` の `viewportWindow` は Webview の `ViewPlugin` に本番結線し、可視範囲へ前後 50 行を加えた窓を `StateEffect` で装飾用 `StateField` に渡す。カーソル・選択行は常に窓へ含め、表と `<details>` の block decoration は引き続き `StateField` から提供する。レンダリング例外は `computeDecorationsSafe` 相当の安全表示と警告に留め、ソースエディタへ切り替えない。

## 設計制約

- Markdown 本文を表示目的で書き換えない。
- 新しい記法判定は先に `src/core` の純粋関数として実装する。
- Widget の副作用は Webview→Extension Host の message 経路で行う。
- CSP は nonce ベースを維持する。
- URI 重複・follow・binding 判定は `src/core/viewer.ts` に置き、VS Code 非依存でテストする。

## 主要ファイル

| 関心事 | ファイル |
|---|---|
| Viewer lifecycle / TextDocument sync / links | `src/livePreviewViewerManager.ts` |
| Media/link pure helpers (image, path formatting, snippet, filename uniqueness) | `src/core/pasteLink.ts` |
| activate / commands | `src/extension.ts` |
| Webview / CodeMirror / message generation | `src/webview/main.ts` |
| Follow / duplicate / binding pure logic | `src/core/viewer.ts` |
| Decoration model | `src/core/model.ts` |
| Minimal diff / IME / EOL | `src/core/sync.ts` |
| Acceptance definitions | `docs/acceptance-tests.md` |
