# Live Preview Editor VS Code拡張機能 要求仕様書（USDM形式）

**文書番号**: LPE-REQ-001-USDM  
**バージョン**: 1.26.0
**作成日**: 2026-06-21  
**最終更新**: 2026-07-17
**ステータス**: 承認済み  
**関連文書**: [architecture.md](architecture.md) | [acceptance-tests.md](acceptance-tests.md) | [requirements.md](requirements.md)

> ▶️ **開発継続中（2026-07-17 時点 / v1.26.0）**: 毎打鍵アイドル自動保存（`SaveDebouncer`）を廃止し、標準エディタと同じ明示保存（Webview の Ctrl+S→host `performSave`）＋失焦・破棄・バインド切替時の flush 保存へ変更した。編集は従来どおり最小 `WorkspaceEdit` で即時反映する。Live Preview の Undo/Redo は CodeMirror が単独で所有する。host は単調 version の edit を apply 成功または差分なし確認後だけ ack し、期待 TextDocument version と LF 本文の ledger で `WorkspaceEdit` 自己エコーを識別する。ledger に一致しない文書変更は `classifyDocumentChange` で分類し、自己保存由来（保存参加者・own-save 窓中の format-on-save）は履歴を保持したままレコンサイルし、真の外部変更のみ履歴を破棄して再同期する。IME、末尾 LF、Explorer の URI/File ペーストは ack と request ID で整合させる。

---

## 検証ステータス凡例

各仕様の先頭に付く3桁マーカーは、左から順に検証段階を表す。各桁は `■`（達成）/ `□`（未達成）で示す。

| 表記 | 状態 |
|------|------|
| `□□□` | 未着手 |
| `■□□` | レビュー済（実装未） |
| `■■□` | 実装済・テスト未 |
| `■■■` | テスト済 |

> 3桁目（`■■■`）への昇格は受け入れテスト実行時にのみ行う。

---

## 目的・スコープ

本文書は、Obsidian ライクな Markdown ライブプレビュー編集 VS Code 拡張機能（`vscode-livepreview-editor`）の要求仕様を USDM 形式で記述する。本拡張は CodeMirror 6 を Webview に埋め込み、記法を保持したまま装飾表示し、カーソル位置の行・要素では生の Markdown 記法を表示する。

## ライブ編集ポリシー

本拡張のライブ編集（カーソル行で生記法・他行で装飾表示）は **標準 Markdown 記法（CommonMark + GFM）** を対象とする。

| カテゴリ | 動作方針 |
|------|------|
| 標準 Markdown 記法（見出し・インライン記法・リスト・タスク・表・コードブロック・リンク・画像 等） | **ライブ編集**（カーソル行で生記法を表示し、他行では装飾表示する） |
| HTML タグ（`<details>`・`<summary>` 等） | **ビューア専用**（常にウィジェット描画。生の HTML 記法を表示する編集モードは持たない。本文の編集は標準ソースエディタで行う） |

HTML タグを使ったブロック（`<details>` アコーディオン等）は「ビューアとして正しく成立すること」を満足条件とし、ライブ編集対応は要件としない。

## 用語定義

| 用語 | 定義 |
|------|------|
| 装飾（Decoration） | 記法を隠す/置換する/スタイルを当てる表示処理。CodeMirror の `Decoration` に対応 |
| カーソル行 | キャレットまたは選択範囲が掛かっている行。生記法を表示する対象 |
| DecoSpec | 純粋ロジックが返す装飾記述子（オフセット・種別・タグ・属性） |
| タスク項目 | `- [ ]` / `- [x]` で始まる GFM チェックリスト項目 |
| ビューア専用 | カーソル位置に依らず常にウィジェット描画し、生記法を表示する編集モードを持たないブロック |

> **スコープ注記（v1.5.0）**: 本拡張は素の Markdown（CommonMark + GFM）の編集・プレビューに専念する。Obsidian 独自機能（Wikilink・埋め込み・コールアウト・タグ・脚注・カスタムタスク状態・バックリンク・ノート補完・画像ペースト保存）は品質リスク低減のため v1.5.0 で削除した（削除した要件番号: R-07, R-10〜R-15, R-17, R-18）。なお「画像ペースト保存」は v1.24.0 で標準 Markdown エディタ相当の挙動として再導入した（R-29）。

## 動作環境

| 項目 | 要件 |
|------|------|
| VS Code バージョン | 1.85.0 以上 |
| 対象ファイル形式 | Markdown（`.md`） |
| Node.js（開発時） | 18.x 以上 |
| OS | Windows / macOS / Linux |

---

## ＜基本ライブプレビュー＞

### R-01 基本記法のライブプレビュー #core

> **理由：** Obsidian ライクに、記法を保持したまま見た目を装飾し、編集時のみ生記法を見せるため。

> **説明：** 装飾判定は CodeMirror 非依存の純粋関数 `computeDecorations`（`src/core/model.ts`）が担う。カーソル行は生記法、その他の行は装飾表示。

###### ＜カーソル連動＞

- ■■■ R-01-01 カーソル（選択範囲を含む）が掛かっている行は生の Markdown 記法を表示し、それ以外の行は記法を隠して装飾表示する。
- ■■■ R-01-02 `computeDecorations` は入力文字列を一切変更しない（表示のみ）。

###### ＜基本記法＞

- ■■■ R-01-03 太字 `**text**` を内側テキストの強調として装飾し、`**` マーカーを非カーソル行で隠す。
- ■■■ R-01-06 アンダースコア強調（`_`・`__`）は ASCII 単語文字に挟まれた語中（例 `my_var_name`）では発火しないこと（CommonMark 準拠。アスタリスクは語中可）。
- ■■■ R-01-04 見出し `#`〜`######` をレベル別クラスで装飾し、`#` プレフィックスを非カーソル行で隠す。
- ■■■ R-01-05 リスト `-` / `1.` を検知し、`-` マーカーをビュレットウィジェットへ置換（非カーソル行）。

---

## ＜拡張記法＞

### R-02 拡張 Markdown 記法 #syntax

> **理由：** 実用的な Markdown 文書を装飾表示するため、主要な記法を網羅する。

###### ＜インライン＞

- ■■■ R-02-01 斜体 `*text*` を装飾し、`**`（太字）と誤認しない。
- ■■■ R-02-02 インラインコード `` `code` `` を装飾し、内部の Markdown は装飾しない。
- ■■■ R-02-03 リンク `[text](url)` をラベル装飾＋href 保持で表示し、構文を非カーソル行で隠す。リンク遷移は左クリック時のみ実行し、右クリック時はリンクを開かず Webview のコンテキストメニューを表示すること。`.md` リンクの左クリックは同一 URI を重複させない別 Live Preview ビューアで開き、現在のビューアは維持する。`http(s)`/`mailto` は外部ブラウザ、その他相対パスは既定エディタで `preview: false`。
- ■■■ R-02-04 画像 `![alt](url)` を非カーソル行で画像ウィジェットに置換する。

###### ＜ブロック＞

- ■■■ R-02-05 引用 `> quote` を装飾し、`>` マーカーを非カーソル行で隠す。
- ■■■ R-02-06 フェンスコードブロック（```` ``` ````）を検知し、ブロック内の Markdown を一切装飾しない。
- ■■■ R-02-07 表（ヘッダ＋区切り行）を検知し、区切り行を非カーソル行で隠す。

---

## ＜表示制御・同期＞

### R-03 ソース横 Live Preview ビューア #viewer

> **理由：** 標準 Markdown ソースを維持したまま、横に並べた Live Preview でも編集でき、複数文書の確認と編集を安全に行えるようにするため。

> **説明：** `livePreview.openWith` は標準ソースエディタを置換せず、編集可能な `WebviewPanel` を横に開く。`customEditors` と `livePreview.toggleSource` は提供しない。同一 URI は常に 1 ビューアとし、異なる URI は複数ビューアを許可する。`livePreview.followActiveEditor` が有効な場合、アクティブな Markdown ソースへ最後に操作したビューアが追従する。切り替えは保留中の Webview 編集の適用後に行い、世代番号で旧バインド由来の遅延メッセージを拒否する。

###### ＜起動・重複防止＞

- ■■■ R-03-01 標準 Markdown エディタのタイトルバーボタンまたは Explorer コンテキストメニューの `livePreview.openWith` で、ソースを閉じずに Live Preview ビューアを `ViewColumn.Beside` へ開けること。
- ■■■ R-03-02 異なる Markdown URI の Live Preview ビューアは複数同時に開けるが、同一 URI のビューアは重複作成せず既存ビューアを再表示すること。
- ■■■ R-03-03 `.md` リンクは同一 URI の重複を作らず Live Preview ビューアで開き、現在のビューアを維持すること。外部 URL はブラウザ、その他の相対パスは `preview: false` の既定エディタで開くこと。
- ■■■ R-03-04 Live Preview は CodeMirror 編集、書式コマンド、チェックボックス、リンク、Undo、IME 抑制、CRLF 保持、最小差分同期を従来どおり提供し、Markdown テキストを表示目的で書き換えないこと。

###### ＜アクティブエディタ追従＞

- ■■■ R-03-05 `livePreview.followActiveEditor` は既定値 `true` とし、有効時はアクティブな Markdown ソースエディタへ最後に操作したビューアを追従させること。対象 URI を既に別ビューアが表示している場合は既存ビューアを所有者として維持し、重複切り替えを行わないこと。無効時は自動切り替えを行わないこと。
- ■■■ R-03-06 文書切り替えは、そのビューアで受信済みの保留編集を `WorkspaceEdit` へ適用した後に直列実行すること。各バインドに世代番号を付け、切り替え前の Webview が遅延送信した編集・タスク・リンク・エラー通知を新しい文書へ適用しないこと。
- ■■□ R-03-07 文書切り替え時はパネルタイトル、画像等の resource base、`localResourceRoots`、TextDocument 変更リスナーを新 URI へ再バインドすること。
- ■■□ R-03-08 ソースタブを閉じた後も Live Preview から編集できること。編集時は `workspace.openTextDocument(uri)` で TextDocument を再取得し、CodeMirror の local transaction を通常の edit 経路で最小 `WorkspaceEdit` として即時適用する。保存は明示保存（Webview の Ctrl+S／Cmd+S を捕捉し `preventDefault` して host へ `save` メッセージを送り `performSave` を実行する）と、失焦・破棄・バインド切替時の flush 保存（`performSave` 直接呼び出し）で行い、いずれも先行して受信済みの edit 適用後に同一 queue で完走する。毎打鍵アイドル自動保存は行わない。`workspace.applyEdit` false 時は警告し、失敗 version を基準とする authoritative rollback を返す。破棄済み Webview には新規メッセージを送らないが、既受信 edit の適用と保存は完走する。なお WebviewPanel は CustomTextEditor ではないため、パネル自体の dirty バッジは表示されない（ソースタブが開いていれば VS Code 標準の dirty ドットで未保存を示す）。これは既知の制約とする。ビューア内の未保存インジケータ（R-31）がこの制約を補う。
- ■■□ R-03-09 書式コマンドとアクティブエディタ追従の対象は最後に操作したビューアとし、ビューア操作後にソースへフォーカスを戻しても対象を保持すること。
- ■■□ R-03-10 Live Preview の対象ファイルが VS Code 内でリネームされた場合は、受信済みの保留編集を適用した後にビューアを新 URI へ再バインドし、世代番号、パネルタイトル、resource base、`localResourceRoots`、TextDocument 変更リスナーを更新して編集を継続すること。新 URI を別ビューアが所有している場合は重複を避けるため旧 URI 側を閉じること。対象ファイルが削除された場合はビューアを閉じること。

### R-04 ドキュメント同期 #sync

> **理由：** Webview の編集を TextDocument に正しく反映し、外部変更とも矛盾なく保つため。

###### ＜双方向同期＞

- ■■□ R-04-01 Webview の編集を最小差分（`diffRange`）で `WorkspaceEdit` に適用し、Undo 粒度を維持する。Live Preview の Undo/Redo は CodeMirror `history()` だけが所有し、ローカル transaction を履歴へ入れる。自己保存由来（保存参加者・own-save 窓中の format-on-save）の書き換えは `computeRemotePatch` の最小差分を `addToHistory.of(false)` で適用し、履歴を保持したままレコンサイルする（`preserveHistory`）。真の外部変更または apply 失敗 rollback だけが、選択を再マップした新しい EditorState に置換して履歴を破棄する。
- ■■□ R-04-02 Host は Webview の単調 version を受理順に管理し、重複・古い・不正な snapshot を適用しない。`WorkspaceEdit` 前に「期待 LF 本文＋期待 TextDocument version」を version-keyed ledger へ記録し、その組だけを自己エコーとして消費する。ledger に一致しない変更は `classifyDocumentChange` で分類し、自己保存由来（`SelfSaveGuard.isActive` の own-save 窓、または `isSaveParticipantNormalization` が説明できる EOL・末尾改行・行末空白だけの差分）は `preserveHistory` 付きで履歴を保持して再同期し、真の外部変更のみ authoritative update として履歴を破棄する。ack は apply 成功または差分なし確認後だけ送る。
- ■■□ R-04-03 Webview は edit version と ack version を別管理し、external update を `baseVersion === editVersion === ackVersion` のときだけ適用する。未 ack local edit、IME、または保留 local change 中は最新1件を保留して ack 後に再判定し、古い base は破棄する。旧形式（baseVersion なし）は未 ack local edit がない場合だけ適用する。`workspace.applyEdit` false の rollback は失敗 edit version を基準にして、より新しい local edit を上書きしない。

---

## ＜品質・エッジケース＞

### R-05 エッジケースと性能 #robustness

> **理由：** 実利用に耐える堅牢性とパフォーマンスを確保するため。

###### ＜堅牢性＞

- ■■■ R-05-01 ネストしたリスト（インデント付き）をレベル付きで検知する。
- ■■■ R-05-02 コードブロック内の `#` `**` `` ` `` `>` を誤装飾しない。未終了フェンスも安全に扱う。
- ■■■ R-05-03 IME 入力中（変換中）は同期を遅延し装飾ちらつきを防止する（`shouldEmitEdit`）。
- ■■■ R-05-04 レンダリング失敗時は警告を表示し、安全な無装飾表示を維持すること。標準ソースエディタへの切り替えや追加表示は行わないこと（`computeDecorationsSafe`）。

###### ＜性能＞

- ■■■ R-05-05 Webview の可視ビューポートに前後 50 行のパディングとカーソル・選択行を加えた範囲へ装飾計算を限定し（`viewportWindow` を `StateEffect` で装飾用 `StateField` に結線）、数千行でもキー入力・カーソル移動時の全行再計算を行わず処理時間が上限内に収まること。
- ■■□ R-05-06 CRLF 行末の文書でも記法検知・タスクトグルが正しく動作し、Webview 編集の反映時にファイルの EOL を保持して最小差分のみ適用すること。CRLF/LF 混在文書では未編集行を含む各行の EOL を行単位で維持し、Webview が要求した末尾 LF は旧文書に末尾改行がなくても fallback EOL で必ず生成すること（`toLF`/`fromLF`/`fromLFPreserving`、`splitLines` の CR 除外、`toggleTaskAt` の CR 許容）。
- ■■■ R-05-07 `buildDecorations` の `RangeSetBuilder.add()` 呼び出しは CodeMirror が要求する `(from, startSide)` 昇順を遵守すること。`MarkDecoration` の `startSide`（500000000）は `Decoration.replace` の `startSide`（499999999）より大きいため、同一 `from` では `hide`/`replaceWidget` を `mark` より前に追加すること（`sideOf` の順序を修正）。また `builder.add()` が例外をスローした場合は `onError` で報告し `Decoration.none` を返してエディタが空白になることを防ぐこと。
- ■■□ R-05-08 IME 合成中に受信した remote update は最新1件を保留し、`compositionend` 後のマイクロタスクで確定全文を一度だけ edit として送る。保留 remote は即時適用せず host ack 到達後に `baseVersion === editVersion === ackVersion` で再判定し、古ければ破棄する。`applyingRemote` 中は保留変更を消費しない（`shouldFlushComposition` / `shouldApplyRemoteUpdate`）。

### R-06 設定 #settings

> **理由：** ユーザーが表示を調整できるようにするため。

> **説明：** ソース表示は VS Code 標準エディタに委ねたため、装飾 ON/OFF 設定（旧 `livePreview.decorationsEnabled`）は v1.6.0 で廃止した。Live エディターは常に装飾表示する。

###### ＜設定項目＞

- ■■■ R-06-02 `livePreview.fontSize` を 8〜40 にクランプして反映する。

---

## ＜タスク管理＞

### R-08 タスクチェックボックス #task

> **理由：** Obsidian と同様に、チェックリストをインタラクティブなチェックボックスとして扱い、編集体験（WYSIWYG 操作）を高めるため。

> **説明：** `- [ ]`（未完了）・`- [x]`/`- [X]`（完了）で始まるリスト項目を対象とする。マーカー部をチェックボックスウィジェットに置換し、クリックで `[ ]`⇄`[x]` をトグルする。完了項目は本文に取り消し線スタイルを当てる。

###### ＜表示＞

- ■■■ R-08-01 `- [ ]` / `- [x]`（大文字 `X` を含む）を検知し、マーカー部を非カーソル行でチェックボックスウィジェット（`cm-lp-task-checkbox`、`checked` 状態を属性 `checked` に保持）へ置換すること。
- ■■■ R-08-02 完了タスク（`[x]`）の本文に取り消し線スタイル（`cm-lp-task-done`）を当てること。
- ■■■ R-08-03 カーソル行では `- [ ]` の生記法を表示すること（チェックボックス置換を行わない）。
- ■■■ R-08-04 インデントされたネストタスクも検知し、インデントレベルを属性 `indent` に保持すること。
- ■■□ R-08-06 タスク行（`.cm-lp-task`）の本文はリンク色・下線を継承しないこと（`.cm-line.cm-lp-task` に `color: var(--vscode-editor-foreground); text-decoration: none` を当てる）。ただし本文中の実リンク（`.cm-lp-link`）は R-21-04 に従いリンク色・下線を表示すること（`color` の上書きをせず `.cm-lp-link` のスタイルを継承させる）。
- ■■□ R-08-08 チェックボックスウィジェットの外観を CSS のみで次のとおりにすること（DOM・クラス名は不変）。未チェック（`.cm-lp-task-checkbox`）は `background: transparent`（エディタ背景と同化しない）・`border: 1.5px solid #888`（dark/light 両テーマで視認可能な中間グレー）・`border-radius: 4px` とする。チェック済み（`.cm-lp-task-checkbox-checked`）は**固定の赤** `background: #e5484d; border-color: #e5484d;` とし、チェックマーク（`::after`）は**白固定** `border-color: #fff`（回転四角コーナー形状を維持し、位置・サイズを角丸四角の中央に視覚的に収まるよう調整）とする。完了タスクの本文色（`.cm-lp-task-done` の `color`）は `var(--vscode-disabledForeground, var(--vscode-descriptionForeground, #888)) !important` とし、さらに `.cm-lp-task-done .cm-lp-link { color: inherit !important }` を追加してチェック済みタスク内のリンクも同じ暗転色で描画すること（`.cm-line.cm-lp-task .cm-lp-link` の明示 color による !important 上書きを防ぐ）。

###### ＜操作＞

- ■■■ R-08-05 Webview 上でチェックボックスをクリックすると、対応行の `[ ]`⇄`[x]` をトグルし、TextDocument に反映すること。（行トグル計算 `toggleTaskAt` を自動検証。クリック→反映の UI 結線は手動確認）
- ■■□ R-08-07 ホスト起点のトグル（`toggleTask`）でも、トグル結果を Webview へ確実に反映すること。`applyEditFromWebview` が `webviewText` を先行更新するため `onDidChangeTextDocument` のエコー抑制で `update` が送られず、CodeMirror のチェックボックス表示が更新されない問題を避けるため、`toggleTask` 処理では `applyEditFromWebview` の後に明示的に `postMessage({ type: 'update', text })` を送ること。Webview の `update` ハンドラはテキスト一致時 no-op のため通常編集には無害であること。また `setText`（Webview の `update` ハンドラが呼ぶ関数）は**最小差分 dispatch 方式**で実装すること: 共通プレフィックス・サフィックスを除いた最小変更範囲のみ `{ from, to: toOld, insert: text.slice(from, toNew) }` で dispatch し、セレクションを明示しない（CodeMirror が差分を通じてセレクションを自動マッピングするため cursor 位置がほぼ維持される）。全文置換（from:0, to:doc.length）では CodeMirror がセレクションを anchor:0 にリセットして `scrollIntoView` が走り、チェックボックストグル後にスクロール位置が先頭へジャンプする。最小差分方式はその根本原因を排除する。

---

## ＜リッチテキスト記法＞

### R-09 取り消し線・ハイライト #richtext

> **理由：** GFM／Obsidian で一般的な装飾記法をライブプレビュー対象に含め、レンダリング品質を高めるため。

###### ＜装飾＞

- ■■■ R-09-01 取り消し線 `~~text~~` を装飾し、`~~` マーカーを非カーソル行で隠すこと。
- ■■■ R-09-02 ハイライト `==text==` を装飾し、`==` マーカーを非カーソル行で隠すこと。コードブロック内・カーソル行では装飾／非表示を行わないこと。

---

## ＜編集体験の強化＞

### R-16 フォーマットコマンド #format

> **理由：** Obsidian と同様に、選択範囲へ装飾をトグルできるコマンド／ショートカットを提供し、編集体験を高めるため。

> **説明：** 純粋関数 `toggleWrap`（対称マーカー）を `src/core/format.ts` に実装。Webview のキーマップと VS Code コマンド（`livePreview.format.*`、Ctrl+B/I/Shift+X/Shift+H/E）から呼ぶ。

###### ＜トグル＞

- ■■■ R-16-01 選択範囲を対称マーカー（`**` `*` `~~` `==` `` ` ``）で囲めること。
- ■■■ R-16-02 既にマーカーで囲まれている場合（外側／選択端のいずれでも）は解除できること。
- ■■■ R-16-03 空選択では空のマーカーペアを挿入し、カーソルを中央へ置くこと。
- ■■□ R-16-05 コマンド `livePreview.format.*` とショートカット（Ctrl+B 等）から実行できること。（UI 結線は手動確認）

---

## ＜Markdown 記法の網羅＞

### R-19 水平線 #hr

> **理由：** 区切りを視覚化するため、水平線記法を表示する。

###### ＜表示＞

- ■■■ R-19-01 `---` / `***` / `___`（3 個以上・スペース許容）を水平線として検知し、非カーソル行でルールウィジェットに置換すること。リスト（`- `）や 2 個以下は誤検知しないこと。

### R-20 バックスラッシュエスケープ #escape

> **理由：** 記号を文字どおり表示するエスケープを CommonMark 準拠で扱うため。

###### ＜エスケープ＞

- ■■■ R-20-01 `\*` `\#` `\[` 等のエスケープは記法を発火させず、非カーソル行ではバックスラッシュを隠すこと。

### R-21 オートリンク・リンク視認性 #autolink

> **理由：** `<url>` 形式のオートリンクを表示・到達可能にするため。また、リンクの存在をユーザーが気づけるよう、常時下線で視認性を確保するため。

###### ＜表示＞

- ■■■ R-21-01 `<https://…>` をリンク化し `< >` を非カーソル行で隠すこと。
- ■■■ R-21-02 `<a@b.com>` には `mailto:` を付与すること。
- ■■■ R-21-03 CommonMark の山括弧宛先 `[ラベル](<相対パス>)`（パスにスペースを含み得る）を開く際、`openLink`（`src/livePreviewEditorProvider.ts`）が href の外側 1 組の山括弧 `< >` のみを除去（`/^<([\s\S]*)>$/`）してから解決すること。山括弧内のスペースは保持する（`Uri.joinPath` がそのまま扱う）。`model` のパース（`LINK_RE`）は href に山括弧を残す仕様とし、除去はホスト側 `openLink` で吸収する（`data-href`/title 表示には影響させない）。全角スラッシュ `／`(U+FF0F) は実フォルダ名の一部として不変に扱うこと。
- ■■□ R-21-04 リンク（`.cm-lp-link`）は常時下線（`text-decoration: underline`）を表示し、ホバー時も下線を維持すること。タスク行内のリンク（`.cm-line.cm-lp-task .cm-lp-link`）も同様に `.cm-lp-link` のリンク色と下線を継承して表示すること（本文色への上書きをしない）。

### R-22 表のレンダリング #table

> **理由：** GFM テーブルをライブプレビューで実際の表として表示するため。

> **説明：** `detectTableBlocks`/`parseTable` でブロックを解析。表は**カーソルがブロック外のとき**は単一の `table-block` ウィジェットへ置換して HTML テーブル描画し、**カーソルがブロック内に入るとウィジェットを解除して生の行 `| a | b |` を表示**してセル内テキストを直接編集できるようにする。テーブルのクリックは当該行（`<tr data-line>`）へキャレットを移動させ、再描画でブロックがアクティブ化して編集モードへ切り替わる。行の追加や列構造の編集は標準ソースエディタで行う。

###### ＜描画＞

- ■■■ R-22-01 表ブロック全体を 1 つの `table-block` ウィジェットに置換し、ヘッダ・整列・行データを保持すること。ウィジェットの `attrs` にブロック開始行（`startLine`）を載せ、Webview が各 `<tr>` に `data-line`（ヘッダ=`startLine`、区切り行はスキップ、`rows[k]`=`startLine+2+k`）を付与できるようにすること。
- ■■■ R-22-02 表は、カーソルがブロック内にあるときは `table-block` ウィジェットを出さず生の行を表示し**セル内テキストを編集可能**とすること。非カーソル時のみ従来どおりウィジェットへ置換すること。Webview 側でテーブルのクリックは、クリックされた `<tr>` の `data-line` を読み、その行頭へキャレットを移動（`view.dispatch({selection})`＋`view.focus()`）して編集モードへ遷移させること（`data-line` が無い区切り行などはキャレット移動しない）。コードブロック内の表もどきは表にしないこと。
- ■■□ R-22-03 表セル内の最小限のインライン記法（太字 `**` / `__`、斜体 `*` / `_`、インラインコード `` ` ``）を装飾描画し、生のマーカー（例 `**CPM**`）をそのまま表示しないこと（MAIO プレビュー同様）。装飾は Webview 層（`appendInlineCell`）でテキストノードへ安全に変換し、生 HTML を挿入しないこと。
- ■■■ R-22-04 区切り行は `|` を含み、セル数がヘッダ行と一致する場合のみ表と判定する（水平線 `---` や単独 `-` を区切り行と誤検知しない）。

---

## ＜編集体験の網羅＞

### R-23 リスト継続入力 #listcontinue

> **理由：** Enter での箇条書き継続という基本的な編集操作を提供するため。

> **説明：** 純粋関数 `continueList`（`src/core/editing.ts`）で次マーカーを算出し、Webview の Enter キーマップで適用する。

###### ＜継続＞

- ■■■ R-23-01 箇条書きを次のビュレットで継続すること。
- ■■■ R-23-02 順序リストは番号をインクリメントすること。
- ■■■ R-23-03 タスクは未完了チェックボックス `[ ]` で継続すること。
- ■■■ R-23-04 インデントを維持すること。
- ■■■ R-23-05 空項目で Enter したらマーカーを除去してリストを終了すること。

### R-24 インデント操作 #indent

> **理由：** Tab/Shift+Tab でリストの階層を調整できるようにするため。

###### ＜インデント＞

- ■■■ R-24-01 Tab で 2 スペースのインデントを追加すること（リスト行）。
- ■■■ R-24-02 Shift+Tab で先頭スペース（最大 2）またはタブ 1 つを除去すること。

### R-25 見出しトグル #headingtoggle

> **理由：** ショートカットで見出しレベルを切り替えられるようにするため。

###### ＜トグル＞

- ■■■ R-25-01 段落を指定レベルの見出しにすること（`Mod+Alt+1〜6`）。
- ■■■ R-25-02 同レベルの見出しは段落へ戻すこと。別レベルは変更すること。レベルは 1〜6 にクランプすること。

---

## ＜実挙動＞

### R-26 画像描画・リンク遷移 #render

> **理由：** プレビューで画像が実際に表示され、リンクが到達可能であることは編集体験の要であるため。

###### ＜描画・遷移＞

- ■■□ R-26-01 Webview の `localResourceRoots` と `asWebviewUri` による `resourceBase` で、相対パス画像（`![](img.png)`）を実描画すること。（リソース解決ロジック `resolveSrc` を実装。表示確認は手動）
- ■■■ R-26-02 標準リンク/オートリンクの左クリックで、外部 URL はブラウザ、相対パスはファイルを開くこと。リンク先が `.md` の場合は同一 URI を重複させない Live Preview ビューアで開き、それ以外は既定エディタで開くこと。右クリックでは `openLink` を送信せず、イベントを消費しないことで Webview のコンテキストメニューを表示すること。（マウスボタン判定を自動検証。UI 結線は手動確認）

---

## ＜Live エディターの操作・体裁＞

### R-27 HTML アコーディオン折りたたみ #fold

> **理由：** 補足情報を `<details>` アコーディオンで畳んで見通しを良くするため。見出しガター折りたたみは不要のため廃止し、HTML の `<details><summary>` 記法のレンダリングに置き換える。

> **説明：** HTML の `<details><summary>…</summary>…</details>` ブロックをプレビュー上でアコーディオンとしてレンダリングする。判定は純粋関数 `detectDetailsBlocks`（`src/core/model.ts`）が担い、**ビューア専用**としてカーソル位置に依らず常にブロック全体を 1 つの `details-block` ウィジェット（既定で折りたたんだ＝閉じた状態）へ置換する（生の HTML を表示する編集モードは持たない）。Webview 層（`src/webview/decorations.ts`）が実際の `<details>` 要素にマッピングし、`<summary>` クリックで開閉する。開閉状態は summary テキストをキーに `openDetails` 集合で記憶し、再描画後も保持する（同一サマリのアコーディオンは状態を共有する制限あり）。アコーディオン本文の編集は標準ソースエディタで行う。見出し（`#`）単位のガター折りたたみ（旧 `foldService`/`foldGutter`）は v1.7.0 で廃止したが、その後、廃止時の問題（常設ガター列がレイアウト幅を占有し左端整列 R-28-07 と衝突する）を回避した別方式として、`<details>` アコーディオンとは独立の見出し折りたたみを R-30 で再導入した。

###### ＜折りたたみ＞

- ■■■ R-27-01 `<details><summary>…</summary>…</details>` ブロックを検知し、ブロック全体を 1 つの `details-block` ウィジェットへ置換すること。フェンスコードブロック内の `<details>` はアコーディオンとみなさず、閉じタグの無い未終了ブロックは折りたたまない（文末まで畳まない）こと。
- ■■■ R-27-02 アコーディオンは既定で折りたたんだ（閉じた）状態で表示し、`<summary>` をクリックで開閉できること。開閉状態は再描画後も保持すること（summary テキストをキーに記憶）。
- ■■■ R-27-03 アコーディオンは**ビューア専用**とし、ブロック内にカーソルがあってもウィジェットのまま（生の HTML 記法を表示しない＝実質非編集）とすること。Webview 側ではウィジェット本体（サマリ以外）のクリックを capture フェーズで握りつぶし（`preventDefault`/`stopImmediatePropagation`）、CodeMirror 既定の mousedown によるキャレット移動を防ぐこと。`<summary>` クリックはネイティブ開閉に通すこと。
- ■■□ R-27-04 サマリ行は背景バー・枠・余計な padding を持たず、`▶`（閉）/`▼`（開）の三角マーカー＋サマリテキストのみの軽量な 1 行表示とし、本文インライン要素と馴染ませること。マーカーは開閉状態に追従する（`<details open>` で `▼`、閉で `▶`）。サマリテキストは通常ウェイト（`font-weight: 400`、太字継承を防ぐ）で表示し、マーカーとサマリテキストの間に半角程度の余白（マーカーの `margin-right` 約 `0.4em`）を設けること（MAIO 参照画像準拠）。
- ■■■ R-27-05 純粋関数 `detailsTagRanges`（`src/core/model.ts`）は各行の構造 HTML タグ（`<details …>`・`<summary …>`・`</summary>`・`</details>` の山括弧を含むタグ文字列）の範囲を返すこと（サマリ本文は含まない）。ビューア専用化により `computeDecorations` 内ではこの範囲を使った行内 `hide` は行わない（ブロック全体がウィジェット置換されるため）が、関数自体の仕様は維持する。
- ■■■ R-27-06 アコーディオンを開いたとき**本文を描画**すること（ビューア専用）。`detectDetailsBlocks` が `</summary>` より後〜`</details>` 直前の各行から構造タグを除去した本文行群を `DetailsBlock.body` に格納し（前後の空行はトリム）、`details-block` ウィジェットの `attrs.body` に JSON で渡す。Webview 層は `<details>` 内（サマリの後）に各本文行を `.cm-lp-details-body-line` として最小限のインライン記法（太字・斜体・インラインコード、`appendInlineCell`）で描画すること。複数段落・リスト・ネストは簡易描画で割り切る。本文の編集は標準ソースエディタで行う。

### R-28 Live エディターの編集体裁 #editing-ui

> **理由：** 実編集に耐える基本的な見た目（余白・キャレット・チェックボックス操作）を確保するため。

###### ＜体裁＞

- ■■□ R-28-01 本文左側に十分な余白（左パディング）を設けること。見出しガター廃止で空いた領域は本文余白として活用すること。
- ■■□ R-28-02 編集時にキャレット（テキストカーソル）が視認できること（`drawSelection` を有効化し、カーソル要素 `.cm-cursor` の `border-left-color` を `var(--vscode-editorCursor-foreground)`（フォールバックで editor 前景色）で確実に描画する）。
- ■■□ R-28-03 タスクチェックボックスはクリックでフォーカス・選択移動を起こさず、ON/OFF が確実にトグルされること（ウィジェットを `span` 化し、クリックを capture フェーズで受け、`preventDefault`/`stopImmediatePropagation` で CodeMirror の mousedown より先に処理してキャレット移動・再描画を防ぐ）。
- ■■□ R-28-04 本文・見出し・各記法の文字色を VS Code 標準テーマの色変数（`var(--vscode-...)`）に追従させ、独自のハードコード色を用いないこと。
- ■■□ R-28-05 本文体裁を GitHub / VS Code 標準 Markdown プレビュー（github-markdown-css 風）に寄せること。具体的には次を満たすこと（描画エンジンと装飾ロジックは変更せず CSS の体裁のみで実現する）:
  - 本文フォントは UI/サンセリフ（`var(--vscode-markdown-font-family, var(--vscode-font-family, system-ui, sans-serif))`）とし、コード（`.cm-lp-code`/`.cm-lp-codeblock`）のみ monospace を維持。行間は 1.6 前後。
  - 見出し `.cm-lp-h1`〜`h6` を MPE（Markdown Preview Enhanced）/GitHub 風に強化したサイズ（h1≈2em / h2≈1.6em / h3≈1.3em / h4≈1.15em / h5≈1em / h6≈0.9em 目安）にし、太さは基本 `font-weight: 600`、h1/h2 は `font-weight: 700` とする。見出しと本文の間に十分な余白を設けるため、見出し行の上下余白は `padding-top: 1.2em`／`padding-bottom: 0.6em`（h1 は `padding-top: 1.4em`）とし、h1/h2 行に下境界線（`border-bottom: 1px solid var(--vscode-panel-border)`、境界線下の空きを含め `padding-bottom: 0.75em`）を付与する。h5/h6 は `var(--vscode-descriptionForeground)` で減色し本文との差別化を強める。
  - インラインコードは淡背景＋角丸の小ピル、ブロックコード `.cm-lp-codeblock` は全幅背景＋十分なパディング（例 `12px 16px`）にする。
  - 引用 `.cm-lp-quote`・表 `table.cm-lp-table`（ボーダー・ヘッダ背景・任意のゼブラ）・水平線 `.cm-lp-hr-line` を GitHub プレビュー風にする。
  - すべての色は `var(--vscode-*)` 変数でテーマ追従を維持し（ハードコード色禁止・フォールバックのみ可）、`.cm-lp-table-row` の `font-variant-numeric: tabular-nums` を維持する。カーソル行で生記法が見えても体裁が崩れないこと（カーソル行表示ロジックは変更しない）。
- ■■□ R-28-06 「Markdown All in One」プレビューに体裁を寄せる追加の磨き込みを行うこと（CSS のみ／装飾ロジック不変）: ブロックコードに淡いボーダー（`border: 1px solid var(--vscode-panel-border)`）、引用に淡い背景バンド（`var(--vscode-textBlockQuote-background)`）、`<details>` アコーディオンのマーカーを小さめ・控えめ（`▶`/`▼`、`font-size: 0.8em` 目安）にし、マーカーとサマリテキストの間に余白（`margin-right: 0.4em` 目安）を設け、サマリテキストを通常ウェイト（`font-weight: 400`）にすること。チェックボックスとタスク本文の間に十分な余白を設けること。
- ■■□ R-28-07 左右の読みやすい余白を「Markdown All in One」プレビューに寄せること（`.cm-content` のパディングを `20px 40px 24px 48px` 目安〔上 `20px`／右 `40px`／下 `24px`／左 `48px`〕とする。CodeMirror のインラインスタイル上書きを防ぐため `!important` を付与する）。見出しは行装飾のためインデントを増やさず、見出しと本文の左端が揃うこと。本文フォントは Markdown サンセリフスタックを明示指定（継承のみに頼らない）し、`font-weight: 400`（通常ウェイト）で等幅へフォールバックしないこと。
- ■■□ R-28-08 タスク行（`.cm-line.cm-lp-task`）内のインラインリンク（`.cm-lp-task .cm-lp-link`）は R-21-04 に従いリンク色（`.cm-lp-link` の `color` を継承）と下線（hover 含む）を表示すること。`color` の上書きは行わない（R-08-06 の補完）。
- ■■■ R-28-09 `<details>` アコーディオンは**ビューア専用**（R-27-03）のため、ブロック本文を生記法で表示する編集モードは持たない。本文・サマリのインライン記法（太字・斜体・インラインコード）は `details-block` ウィジェット側（`<summary>` は `appendInlineCell`）でのみ描画し、ブロック内カーソル時に生のマーカー（例 `**ワークパッケージ**`）が見えることはない。本文の編集は標準ソースエディタで行う。装飾は表示のみで入力文字列を変更しないこと。
- ■■□ R-28-10 ブロックウィジェット（`TableWidget`・`DetailsWidget`）は `block: true` で挿入されるため、ブロック高さ会計と実 DOM のズレを抑え、ウィジェットより**下の行**の `posAtCoords`（クリック位置と編集位置の不一致）を防ぐこと。高さ整合は **estimatedHeight 主導**とし（R-28-11 で再定義）、`toDOM` 内では `view.requestMeasure()` を**呼ばない**こと（`toDOM` は CodeMirror の measure サイクル内で実行されるため、ここで再 measure を要求すると高さ確定が次フレームへ遅れ、その間 `posAtCoords` が旧値のままクリックずれを生む）。更新パスの `updateDOM(_dom, view)` でのみ `view.requestMeasure()` を呼び（`return true` で既存 DOM を再利用）、初回描画は `estimatedHeight` で実態に近づける。`DetailsWidget` は開閉で高さが変わるため、`toggle` イベントリスナー内でも `view.requestMeasure()` を呼ぶこと（toggle は measure サイクル外・DOM がツリー内にあるタイミングのため有効）。
- ■■□ R-28-11 ブロックウィジェットの `get estimatedHeight()` は**現在のフォントサイズ**（ホストの `fontSize` 設定。既定 14px。`setFontSize` で webview の装飾層へ同期）と、アコーディオンの**開閉状態**を反映した値を返し、measure 確定前でもブロック直下のクリック位置が一致すること。具体的には、プレーン行高は `fontSize × 1.6`、テーブル行高は `fontSize × 0.95 × 1.6 + 13`（セル `padding: 6px 13px` の縦 12px＋border 1px）として、テーブル＝（ヘッダ 1＋本文行数）× テーブル行高＋`fontSize`（`margin: 0.5em 0`）、アコーディオン＝サマリ行（`fontSize × 1.4 + 2`）＋（開状態のみ）本文行数 ×（`fontSize × 1.4 + 2`）とすること（22/34px のハードコードは廃止）。あわせて、テーブルセルの行高を CSS で固定（`table.cm-lp-table th/td { line-height: 1.6; }`、インライン `<strong>`/`<code>`/`<em>` は `line-height/font-size: inherit`）し、セル内インライン記法（`**bold**`/`` `code` ``）や折返しで行高がブレないようにして推定と実測の乖離自体を縮めること。これによりフォントサイズ 14 以外・セル内インライン記法・details 開閉直後でもブロック直下クリックが正しい行に着地すること。
- ■■□ R-28-12 ブロックウィジェット（テーブル・`<details>`）は `block: true` で atomic 扱いのため、上下矢印（既定の `cursorLineUp/Down`）はブロック全体を 1 ストロークでスキップし、複数ソース行を飛び越えてしまう。これを防ぐため、上下矢印用のカスタムコマンド（`ArrowUp`/`ArrowDown`、既定キーマップより優先登録）を設け、キャレットが折りたたみブロックを越える場合は**1 ソース行ずつ**隣接行へ着地させること。判定は「CodeMirror の既定の縦移動（`moveVertically`）が現在行から 2 ソース行以上ジャンプするか」で行い（折返し段落の視覚行移動は同一/隣接ソース行に留まるため誤発火しない）、該当時のみ現在行 ±1 のソース行先頭へキャレットを移す。非該当（通常移動・折返し段落内の視覚行移動）は既定キーマップにフォールバックすること。
- ■■■ R-28-13 スクロール後にクリックしても、クリックした行に正確にカーソルが置かれること。`#editor { overflow: auto }` と CodeMirror の `.cm-scroller { overflow: auto }` が**二重スクロールコンテナ**を形成すると、`#editor.scrollTop` が増加する一方で `.cm-scroller.scrollTop` は 0 のままとなり、CodeMirror の `posAtCoords` がスクロール量ぶん座標変換をずらしてしまう（スクロールするほど同じクリック位置でもずれ量が増大する症状）。対策として `#editor` の `overflow` を `hidden` に変更し、スクロールを唯一のコンテナである `.cm-scroller` に完全委譲すること（`media/editor.css`）。
- ■■■ R-28-14 見出し行（`.cm-line.cm-lp-h1`〜`h6`）と HR 行（`.cm-lp-hr-line`）の上下余白が `margin` ではなく `padding` で表現されており、CodeMirror の height oracle が正確な行高さを計測できること。`getBoundingClientRect().height` は CSS `margin` を含まないため、見出し・HR 行の `margin-top`/`margin-bottom` が height oracle に計上されず、スクロール量に比例してクリック位置ずれが累積していた（R-28-10 でテーブルに対して同原則の修正を行ったが、見出し・HR に同問題が残存していた）。対策として `media/editor.css` の見出し `margin-top: 0.8em` → `padding-top: 0.8em`・`margin-bottom: 0.3em` → `padding-bottom: 0.3em`（h1/h2 は border-bottom 上の空きを統合し `padding-bottom: 0.55em`）、HR の `margin: 1em 0` → `padding: 0.15em 0`（余白縮小も兼ねる）へ変換すること。あわせて HR の `border-top` を 2px → 3px（`rgba(127,127,127,0.5)`）に変更し視認性を高めること。`applyFontSize` の末尾で `requestAnimationFrame(() => view.requestMeasure())` を呼び、フォントサイズ変更後に全行の実寸を再測定させること（`src/webview/main.ts`）。
- ■■■ R-28-15 ドラッグ選択範囲が左右余白にはみ出さず、かつ長文の上部・中盤・末尾やスクロール後でも確実に視認できること。`.cm-selectionLayer` は `contain:size` かつ子要素が absolute 配置のため、CSS 高さ未指定では used height が 0 となり選択矩形がすべてクリップされ、`height:100%` では viewport 高に固定され文書途中以降がクリップされる。対策として `src/webview/main.ts` の専用 `ViewPlugin` が CodeMirror の `requestMeasure` read/write フェーズを使い、read で `view.contentHeight` と対象レイヤーを取得し、write で inline `height: ${view.contentHeight}px` を同期すること。同一キーで重複 measure を集約し、初期生成、`docViewUpdate`（文書・装飾・viewport 由来の DOM 更新）、`geometryChanged` / `docChanged`、フォントサイズ変更、表・`<details>` の再測定後をカバーし、destroy 時は付与した inline height を除去すること。CSS は `width:100%` と `clip-path: inset(0 40px 0 48px)` を維持して左右余白を除外し、固定 height は指定しないこと。
- ■■□ R-28-16 Live エディター上で Ctrl（Windows/Linux）または Cmd（macOS）を押しながらマウスホイールを操作すると、ホイール上方向で 1px 拡大、下方向で 1px 縮小すること。ホイールの `deltaY` の大きさにかかわらず 1 回の gesture につき 1px のみ変更し、有効範囲は `livePreview.fontSize` と同じ 8〜40px にクランプする。計算は CodeMirror/DOM 非依存の純粋関数 `zoomFontSize`（`src/core/viewport.ts`）で行う。変更は現在の Webview タブ内の `fontSize` 状態だけに適用し、VS Code 設定、他タブ、再度開いたタブには保存・伝播しない。通常の修飾キーなしホイールは従来どおりスクロールし、キーボードショートカットによるズームは追加しない。ズーム時はポインタ直下の文書位置と行内 Y オフセットを変更前に記録し、既存 `applyFontSize` の再計測後に `.cm-scroller.scrollTop` を補正して表示アンカーを維持すること。

### R-29 画像・ファイルのペースト/ドロップ挿入 #paste-media

> **理由：** 標準 Markdown エディタと同様に、画像バイナリのペーストやファイルのドロップだけでワークスペースへ画像を保存し、Markdown リンクを自動挿入できることは編集体験の要であるため。v1.5.0 で削除した「画像ペースト保存」を、Obsidian 独自挙動ではなく標準 Markdown エディタ相当の挙動として v1.24.0 で再導入する。

> **説明：** 画像判定・山括弧エスケープ・スニペット生成・ファイル名衝突回避は VS Code 非依存の純粋関数（`src/core/pasteLink.ts`: `isImageFile`／`formatMarkdownLinkTarget`／`buildMediaSnippet`／`uniqueMediaName`）が担う。Webview（`src/webview/main.ts`）は `paste`/`drop` でファイル・`text/uri-list` を収集し、ファイルまたは URI があるときのみ `preventDefault` して `{ type: 'pasteMedia', binding, files: [{ name, data: Uint8Array }], uris? }` をホストへ送る（ファイルも URI も無い通常テキストは CodeMirror 既定に委ねる）。ホスト（`src/livePreviewViewerManager.ts` `handlePasteMedia`）はバイナリを document フォルダ相対の保存先（既定 `assets/`）へ `workspace.fs.writeFile` で保存し、同名衝突は `-N` 連番で回避する。ワークスペース内 URI（画像・非画像とも）は複製せず document フォルダ基準の相対パスへ変換し、元ファイルへ直接リンクする。`isCurrentBinding` 確認後、単一スニペットを `{ type: 'insertMedia', binding, text, placeholderFrom, placeholderTo }` として返信し、Webview が現在の選択範囲へ挿入してプレースホルダ（`alt text`／`text`）を選択状態にする。挿入後は既存 edit フローで保存まで確定する。往復は `enqueue` で直列化し、`resolveSrc`（R-26-01）で `assets/` 配下の画像が追加設定なしに描画される。

###### ＜ペースト/ドロップ＞

- ■■□ R-29-01 `formatMarkdownLinkTarget` は、パスにスペース・`(`・`)` を含む場合のみ `<...>` で囲むこと（例: `assets/新規 ビットマップ イメージ.bmp` → `<assets/新規 ビットマップ イメージ.bmp>`、`a(b).png` → `<a(b).png>`）。含まない場合は変化させず（例: `マークダウン.md` → `マークダウン.md`）、非 ASCII はエスケープしないこと。囲む場合に本文へ `<`/`>` が含まれれば `%3C`/`%3E` へエンコードすること。
- ■■□ R-29-02 `buildMediaSnippet` は、画像は `![alt text](<target>)`（プレースホルダ `alt text`）、非画像は `[text](target)` を生成し、プレースホルダ範囲（`placeholderFrom`/`placeholderTo`）が該当文字列を指すこと。非画像の表示名は貼り付け開始時の非空選択を優先し、なければ target basename の最終拡張子を除いた名前とする。`target` は `formatMarkdownLinkTarget` 適用済みを受け取る。
- ■■□ R-29-03 `isImageFile` は画像拡張子（png/jpg/jpeg/gif/bmp/webp/svg/ico/avif/tiff）を true、それ以外（`.md`/`.txt` 等）を false と判定すること。
- ■■□ R-29-04 `uniqueMediaName` は、保存先に同名ファイルがあるとき拡張子の前へ `-1`,`-2`… を付与して衝突を回避すること（例: `image.png` 有り → `image-1.png`、さらに有りで `image-2.png`）。
- ■■□ R-29-05 Webview の高優先度 DataTransfer handler は `files`、`items`、`text/uri-list`、`application/vnd.code.uri-list` を収集する。`text/plain` は、全行 file URI のとき、または（file URI fallback が該当しない場合に限り）全行が絶対ファイルパス（POSIX `/...`、Windows `X:\...`／`X:/...`、UNC `\\server\...`）のときだけ fallback とし、`file:` URI へ正規化して候補へ合流する（Windows パスはドライブレター小文字化・`\`→`/`変換・パーセントエンコードを行う）。通常テキスト・相対パス・HTTP URL、および行の混在（一部行のみ絶対パス）は既定 paste/drop を変えない。URI は同名 File より優先し、workspace 内 URI は画像・非画像とも複製せず document フォルダ基準の相対リンクとする。URI を持たない Markdown File は document フォルダへ、画像とその他 File は `assets/` へ同名回避保存する。外部・無効・読込失敗 URI（絶対パス fallback 由来を含む）は警告し snippet を挿入しない。host 応答は request ID を返し、開始時 selection を追従して応答時に挿入する。

### R-30 見出しセクション折りたたみ #headingfold

> **理由：** 長い文書を見出し単位で畳んで見通しを良くするため。見出し（`#`）単位のガター折りたたみは v1.7.0 で一度廃止した（R-27）が、廃止時の問題（常設ガター列がレイアウト幅を占有し、左余白設計・見出し/本文の左端整列 R-28-07 と衝突する）を回避した設計で、`<details>` アコーディオン（R-27）とは独立の機能として再導入する。

> **説明：** 折りたたみ範囲の算出は VS Code / CodeMirror 非依存の純粋関数（`src/core/model.ts`）が担う。`scanHeadings(doc)` は全見出しをレベル・テキスト・行番号・絶対オフセット付きで返し、`detectCodeBlocks` によりフェンスコードブロック内の `#` を除外する（全文走査。ビューポート限定の `computeDecorations` には依存しない）。`headingFoldRange(doc, line)` は指定行が見出しなら、その行末から次の同レベル以下（同じ以上の強さ、level ≤ 当該レベル）の見出し直前行の行末までを折りたたみ範囲として返し、配下が無ければ `null` を返す（コードブロックを跨いでも正しく範囲を返す）。Webview（`src/webview/main.ts`）は `@codemirror/language` の `codeFolding()`＋カスタム `foldService`（`headingFoldRange` 由来）＋`foldGutter`＋`foldKeymap` を組み合わせて見出し配下を折りたたみ／展開する。既定は全展開。折りたたみ UI は常設ガター幅でレイアウトを崩さないよう、`.cm-gutters` を透明・最小幅にし、`.cm-content` の左パディングをガター幅ぶん減らして総左余白と見出し/本文の左端整列（R-28-07）を維持する。ガターのマーカー（`▼`/`▶`）と折りたたみプレースホルダは `var(--vscode-*)` 追従（R-28-04）。

###### ＜見出し折りたたみ＞

- ■■□ R-30-01 純粋関数 `scanHeadings` はフェンスコードブロック内の `#` を除外して全見出しを行番号・レベル・テキスト・オフセット付きで返すこと。
- ■■□ R-30-02 純粋関数 `headingFoldRange` は見出し行に対し、次の同レベル以下の見出し直前までを折りたたみ範囲として返し、配下が無い場合は `null` を返すこと。コードブロックを跨いでも正しく範囲を返すこと。
- ■■□ R-30-03 Webview は `codeFolding()`＋カスタム `foldService`（`headingFoldRange` 由来）＋`foldKeymap` で見出し配下を折りたたみ／展開できること。既定は全展開。
- ■■□ R-30-04 折りたたみ UI は常設ガター幅でレイアウトを崩さず、見出しと本文の左端整列（R-28-07）とテーマ色追従（R-28-04）を維持すること。

### R-31 未保存インジケータ #unsaved

> **理由：** `WebviewPanel` は `CustomTextEditor` ではないためパネル自体に dirty バッジが表示されない（R-03-08 の既知の制約）。ソースタブを閉じて Live Preview だけで編集している場合、未保存であることを確認する手段がなくなるため、ビューア内に視認可能なインジケータを設けて補う。

> **説明：** 未保存判定は host（`TextDocument.isDirty`）を正とし、Webview は独自に dirty を推定しない。host（`src/livePreviewViewerManager.ts` `postDirtyState`）は `workspace.openTextDocument(binding.uri)` で取得した `document.isDirty` を `{ type: 'dirty', dirty, binding: binding.generation }` として Webview へ送る。送信タイミングは編集適用成功後（`applyEdit`）、明示保存・flush 保存成功後（`performSave`）、初期表示（`postInit`）、外部変更・自己エコー後（`onDidChangeTextDocument` 経路）、および保存ライフサイクル（既存 `onDidSaveTextDocument`）。破棄済み Webview・バインド世代不一致（`shouldPostDirtyState`）には送らない。Webview（`src/webview/main.ts`）は CodeMirror の DOM 外（`#editor` の兄弟要素）に固定配置のオーバーレイ `cm-lp-unsaved-indicator` を生成し、`dirty` メッセージ（現在の binding 一致時のみ）で表示/非表示クラス（`is-visible`）を切り替える。色は `var(--vscode-editorWarning-foreground)` 追従（フォールバック値あり、R-28-04）。

###### ＜インジケータ表示＞

- ■■□ R-31-01 host は `TextDocument.isDirty` を正として、編集適用後・保存後・初期表示・外部変更後・保存ライフサイクルで `{ type: 'dirty', dirty, binding }` を Webview へ送ること。破棄済み Webview・世代不一致には送らないこと。
- ■■□ R-31-02 Webview はビューア内（CodeMirror DOM 外のオーバーレイ）に未保存インジケータを表示し、dirty=true のときのみ視認でき、dirty=false で消えること。色は `var(--vscode-*)` 追従。
- ■■□ R-31-03 インジケータ要素は CodeMirror の装飾・高さ計測・クリック位置に干渉しないこと。

### R-33 アウトライン/目次 #outline

> **理由：** 長い文書内で見出し間を素早く移動できるよう、ビューア内にナビゲーション用の目次を設ける。

> **説明：** 見出し抽出は R-30 で追加した全文走査の純粋関数 `scanHeadings`（`src/core/model.ts`）を再利用する（フェンスコードブロック内の `#` は除外。ビューポート限定の `computeDecorations`（R-05-05）には依存しない）。Webview（`src/webview/main.ts`）は CodeMirror の DOM 外にフローティングの目次パネル `cm-lp-outline-panel` を生成し、トグルボタンで表示/非表示を切り替える。ドキュメント変更時（`OutlineSync` ViewPlugin、マイクロタスクで軽くデバウンス）に `scanHeadings(view.state.doc.toString())` を再計算し、見出しレベルに応じてインデントした一覧を描画する。項目クリックで `view.dispatch({ selection: { anchor: doc.line(line + 1).from }, scrollIntoView: true })` により該当見出し行へキャレット移動・スクロールする（`line` は 0-based、`doc.line` は 1-based）。本文は一切書き換えない（R-01-02）。色は `var(--vscode-*)` 追従（R-28-04）。

###### ＜アウトライン/目次＞

- ■■□ R-33-01 純粋関数 `scanHeadings` により全文書の見出し（レベル・テキスト・行番号）を取得すること（コードブロック内 `#` は除外）。ビューポート限定装飾（R-05-05）に依存しないこと。
- ■■□ R-33-02 Webview はビューア内フローティングパネルに見出しをレベル別インデントで一覧表示し、表示/非表示をトグルできること。色は `var(--vscode-*)` 追従。
- ■■□ R-33-03 目次項目クリックで該当見出し行へキャレット移動・スクロールすること。本文は変更しないこと（R-01-02）。パネルは CodeMirror の装飾・計測・クリック位置に干渉しないこと。
