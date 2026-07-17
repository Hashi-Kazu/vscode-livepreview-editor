# Live Preview Editor アーキテクチャ

**関連文書**: [requirements-usdm.md](requirements-usdm.md) | [acceptance-tests.md](acceptance-tests.md)

## 全体構成

```text
┌─────────────────────────────────────────────────────┐
│ VS Code Extension Host                              │
│ src/extension.ts                                    │
│ src/livePreviewViewerManager.ts                     │
│ - editable WebviewPanel の生成・URI 重複防止          │
│ - TextDocument 再取得・最小差分 WorkspaceEdit・遅延合体保存 │
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

各 Viewer は `operationQueue` を持ち、Webview 編集と文書切り替えを受信順に直列化する。切り替えは先行する編集の `WorkspaceEdit` と保存の完了後に実行される。失焦・dispose の flush も同じキューへ追加するため、dispose 前に受信した edit はパネル破棄後でも TextDocument への適用と保存を完走する（Webview 返信だけを抑止する）。

各文書バインドには単調増加する `generation` を付ける。Webview は `edit`、`pasteMedia`、`openLink`、`renderError` に現在の generation を付与し、ホストは現在値と異なる遅延メッセージを拒否する。切り替え時は次を一括して更新する。

- URI 所有者マップ
- パネルタイトル
- `localResourceRoots` と画像等の resource base
- `onDidChangeTextDocument` listener
- LF 正規化済み Webview テキスト

## TextDocument と同期

Webview 編集のたびに `workspace.openTextDocument(uri)` で対象を取得する。この API は文書をロードするがエディタを reveal しないため、標準ソースタブを閉じた後も Live Preview から編集できる。

Webview の Live Preview Undo/Redo は CodeMirror `history()` だけが所有する。編集は `diffRange` と `fromLFPreserving` で既存 EOL を維持した最小 `WorkspaceEdit.replace` として即時適用する。host は最後に受理した version、成功 ack version、期待 LF 本文＋TextDocument version の version-keyed self-echo ledger を別々に管理し、ledger に一致しない変更を authoritative external update として operationQueue で直列配信する。Webview は `baseVersion === editVersion === ackVersion` の update だけを適用し、IME または未 ack edit 中は最新1件を保留する。外部更新・apply false rollback は `computeRemotePatch` で選択を再マップした新しい EditorState に置換し、古い CodeMirror history を破棄する。`paste`/`drop`/`dragover` は `Prec.highest(EditorView.domEventHandlers)` で DataTransfer の File、URI MIME、file URI-only plain text を処理する。URI は File より優先し、host response の request ID と追従選択範囲を使って snippet を挿入する。

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
| activate / commands | `src/extension.ts` |
| Webview / CodeMirror / message generation | `src/webview/main.ts` |
| Follow / duplicate / binding pure logic | `src/core/viewer.ts` |
| Decoration model | `src/core/model.ts` |
| Minimal diff / IME / EOL | `src/core/sync.ts` |
| Acceptance definitions | `docs/acceptance-tests.md` |
