# Live Preview Editor アーキテクチャ

**関連文書**: [requirements-usdm.md](requirements-usdm.md) | [acceptance-tests.md](acceptance-tests.md)

## 全体構成

```text
┌─────────────────────────────────────────────────────┐
│ VS Code Extension Host                              │
│ src/extension.ts                                    │
│ src/livePreviewCustomEditorProvider.ts              │
│ - CustomTextEditorProvider（viewType livePreview.editor）登録 │
│ - VS Code が渡す単一 TextDocument に生涯バインド      │
│ - デバウンス apply（最小差分 WorkspaceEdit）・明示保存 │
│ - Undo/Redo は executeCommand へ委譲・self-echo ledger │
└───────────────────────┬─────────────────────────────┘
                        │ init/update/ack/dirty/edit/undo/redo/save/openLink/pasteMedia/insertMedia/…
┌───────────────────────▼─────────────────────────────┐
│ Webview (browser/IIFE) src/webview/main.ts          │
│ - CodeMirror 6 EditorView（history を持たない）      │
│ - Decoration / formatting / checkbox / link         │
│ - classifyUndoRedoKey で Undo/Redo/Save を host へ転送 │
└───────────────────────┬─────────────────────────────┘
                        │ pure functions
┌───────────────────────▼─────────────────────────────┐
│ src/core/                                           │
│ - model.ts: decoration descriptors                  │
│ - sync.ts: diff/EOL/IME/self-echo ledger            │
│ - editing.ts: list/indent/heading/key classification │
│ - viewport.ts, format.ts, pasteLink.ts              │
└─────────────────────────────────────────────────────┘
```

## エディタライフサイクル

- `customEditors` contribution（viewType `livePreview.editor`、`priority: option`、`filenamePattern: *.md`）を登録し、`CustomTextEditorProvider` を `registerCustomEditorProvider` で解決する（`supportsMultipleEditorsPerDocument: false`／`retainContextWhenHidden: true`）。
- `livePreview.openWith` は標準ソースを閉じず、`vscode.openWith` で `ViewColumn.Beside` に Live Preview エディタを開く。`supportsMultipleEditorsPerDocument: false` のため、同一リソースに既存エディタがあれば複製せず reveal される。
- 各エディタ（`LivePreviewEditorSession`）は VS Code が `resolveCustomTextEditor` に渡す単一の `TextDocument` に生涯バインドする。active editor follow、URI 所有者マップ、`workspace.openTextDocument` の再取得、binding generation による文書切り替えは持たない（VS Code が単一 TextDocument バインドとリネーム/削除を管理する）。
- 書式コマンド（`livePreview.format.*`）は最後に active になったエディタ（`lastActive`）を対象にする。

## 安全な文書更新

各エディタは `operationQueue`（`enqueue`）を持ち、Webview 編集の apply・保存・Undo/Redo・外部変更のレコンサイルを受信順に直列化する。失焦・dispose の flush もこのキューへ追加するため、dispose 直前に受信した edit はパネル破棄後でも TextDocument への適用まで完走する（Webview 返信だけを抑止する）。

保存モデルはデバウンスバッチ apply＋即時保存である（ADR-0019）。Webview の `edit` は即 apply せず `pendingEdit` に最新 version で coalesce し、タイピング停止後のデバウンス（既定 200ms、`EDIT_APPLY_DEBOUNCE_MS`）でバッチ apply する。apply は最小差分 `WorkspaceEdit.replace`（`diffRange` + `fromLFPreserving` で既存 EOL を維持）として実行する。

flush 点はすべて `flushPendingEdit` に統一する（取りこぼしゼロ）。

- 明示保存: WebviewPanel 自体は Ctrl+S を下層 TextDocument へ届けないため、Webview 側で `classifyUndoRedoKey` により `Ctrl+S`/`Cmd+S` を捕捉して host へ `save` メッセージを送り、host が `operationQueue` 上で `flushPendingEdit`→`document.save()`（dirty のときだけ）を実行する。VS Code 標準の autoSave も TextDocument に対して通常どおり動作する。
- flush 保存以外の flush 点: 失焦（パネル非 active 化）・dispose・Undo/Redo・save・外部変更処理の入口で `flushPendingEdit` を呼ぶ。失焦・dispose は flush するが保存はしない。

## Undo/Redo の VS Code 委譲

Live Preview の Undo/Redo は CodeMirror の history を持たず、VS Code へ委譲する（ADR-0020、R-33）。Webview は `classifyUndoRedoKey`（`src/core/editing.ts`）で `Ctrl/Cmd+Z`=undo・`Ctrl/Cmd+Shift+Z` および `Ctrl+Y`(非 Cmd)=redo・`Ctrl/Cmd+S`=save を分類し（IME 変換中・Alt 併用・修飾なしは対象外）、host へ転送する。host は undo/redo/save の実行前に必ず pending edit を flush し、その後 `executeCommand('undo'|'redo')`／`document.save()` を実行する。undo/redo は保存しない。undo/redo が TextDocument を書き換えた結果は `onDidChangeTextDocument` で外部変更として Webview に一方向反映される。

## TextDocument と同期

host は `applyPendingEdit` 前に「期待 LF 本文＋期待 TextDocument version」を version-keyed の self-echo ledger（`expectedChanges`）へ記録し、`consumeExpectedWorkspaceEditChange` で一致する変更だけを自己エコーとして消費する（Webview へ反映しない）。ledger に一致しない変更（VS Code の Undo/Redo、標準編集、保存参加者、Git、他拡張、autoSave 正規化）は真の外部変更として `reconcileExternalChange` が一方向に反映する（1回）。反映前に pending edit があれば先に `applyPendingEdit` して確定済み入力を失わない。

Webview（`src/webview/main.ts`）は edit version と ack version を別管理し、`shouldApplyRemoteUpdate` により `baseVersion === editVersion === ackVersion` の update だけを適用する。IME 合成中・未 ack edit 中は最新1件を保留する。外部更新・apply false rollback は `computeRemotePatch` で選択を再マップした新しい EditorState に置換する（CodeMirror history を持たないため単純置換）。`paste`/`drop`/`dragover` は `Prec.highest(EditorView.domEventHandlers)` で DataTransfer の File、URI MIME、file URI-only plain text を処理し、URI は File より優先する。

## Webview 描画

`computeDecorations` が返す `DecoSpec[]` を `src/webview/decorations.ts` が CodeMirror Decoration に変換する。`src/core/viewport.ts` の `viewportWindow` は Webview の `ViewPlugin` に本番結線し、可視範囲へ前後 50 行を加えた窓を `StateEffect` で装飾用 `StateField` に渡す。カーソル・選択行は常に窓へ含め、表と `<details>` の block decoration は引き続き `StateField` から提供する。レンダリング例外は `computeDecorationsSafe` 相当の安全表示と警告に留め、ソースエディタへ切り替えない。

## 設計制約

- Markdown 本文を表示目的で書き換えない。
- 新しい記法判定は先に `src/core` の純粋関数として実装する。
- Widget の副作用は Webview→Extension Host の message 経路で行う。
- CSP は nonce ベースを維持する。
- 同期・差分・IME・self-echo 判定は `src/core/sync.ts` に置き、VS Code 非依存でテストする。

## 主要ファイル

| 関心事 | ファイル |
|---|---|
| Custom Text Editor / TextDocument sync / Undo 委譲 / links | `src/livePreviewCustomEditorProvider.ts` |
| Media/link pure helpers (image, path formatting, snippet, filename uniqueness) | `src/core/pasteLink.ts` |
| activate / commands / custom editor 登録 | `src/extension.ts` |
| Webview / CodeMirror / message generation | `src/webview/main.ts` |
| List/indent/heading/Undo-Redo キー分類 pure logic | `src/core/editing.ts` |
| Decoration model | `src/core/model.ts` |
| Minimal diff / IME / EOL / self-echo ledger | `src/core/sync.ts` |
| Acceptance definitions | `docs/acceptance-tests.md` |
</content>
</invoke>
