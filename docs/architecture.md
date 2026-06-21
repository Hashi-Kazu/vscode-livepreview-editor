# Live Preview Editor アーキテクチャ

**関連文書**: [requirements-usdm.md](requirements-usdm.md) | [acceptance-tests.md](acceptance-tests.md)

> ⛔ **開発凍結（2026-06-21）**: 本拡張は v1.6.0 をもって開発を凍結する。

## 全体構成

3 層に分離する。**純粋ロジック層は CodeMirror / VS Code に一切依存せず**、Vitest で直接テストする。

```
┌─────────────────────────────────────────────┐
│ 拡張ホスト (Node/CJS)  src/extension.ts        │
│  - LivePreviewEditorProvider                  │
│    (CustomTextEditorProvider)                 │
│  - TextDocument 同期 / 設定 / コマンド          │
│  - Wikilink 解決・ファイルオープン              │
└───────────────▲───────────────────────────────┘
                │ postMessage（edit / update / openWikilink / toggleTask …）
┌───────────────▼───────────────────────────────┐
│ Webview (browser/IIFE)  src/webview/main.ts    │
│  - CodeMirror 6 EditorView                     │
│  - livePreviewPlugin（ViewPlugin）             │
│  - decorations.ts: DecoSpec → Decoration 変換   │
│    （Widget: bullet / image / wikilink / task） │
└───────────────▲───────────────────────────────┘
                │ import（純粋関数呼び出し）
┌───────────────▼───────────────────────────────┐
│ 純粋ロジック (src/core/) ★テスト対象            │
│  - model.ts   computeDecorations / 〜Safe       │
│  - sync.ts    diffRange / shouldResync /        │
│               shouldEmitEdit / cursorLines…     │
│  - viewport.ts viewportWindow / resolveSettings │
└─────────────────────────────────────────────────┘
```

## データモデル（DecoSpec）

`computeDecorations(doc, cursorLines, options)` は `DecoSpec[]` を返す。各記述子は絶対オフセットを持つ。

| フィールド | 意味 |
|---|---|
| `from` / `to` | ドキュメント絶対オフセット |
| `type` | `hide`（記法を隠す）/ `mark`（スタイル）/ `line`（行スタイル）/ `replaceWidget`（ウィジェット置換） |
| `tag` | 意味タグ（`strong` `heading` `wikilink` `task-checkbox` …） |
| `className` | 適用 CSS クラス |
| `attrs` | 付加情報（`href` `target` `checked` `indent` `widget` …） |

Webview の `decorations.ts` がこの記述子を CodeMirror の `Decoration.line/mark/replace` に変換する。`replaceWidget` のうち画像・Wikilink・タスクは専用 `WidgetType` を生成する。

## 処理フロー

1. ユーザー入力 → CodeMirror が `ViewUpdate` を発火。
2. `livePreviewPlugin` がビューポート行範囲を算出し `computeDecorations` を呼ぶ（性能のため範囲限定）。
3. 編集は `shouldEmitEdit`（IME/リモート抑制）を通過したら `edit` を postMessage。
4. 拡張ホストが `diffRange` で最小差分を `WorkspaceEdit` 適用。
5. 外部変更は `onDidChangeTextDocument` → `shouldResync` 判定 → `update` を postMessage。

## ビュー切り替えと折りたたみ（v1.7.0）

- **ビュー切り替え（R-03）**: 独自の「装飾 ON/OFF 生表示」ソースビューは廃止。`.md` は既定で VS Code 標準テキストエディタ（`customEditor` の `priority: option`）で開く。標準エディタ→Live は `livePreview.openWith`（タイトルバーの目アイコン）、Live→標準は `livePreview.toggleSource`。いずれも `LivePreviewEditorProvider.switchEditor` が `vscode.openWith`（`viewColumn: Active`）で**現在のタブを同じ場所に対象ビューへ再バインドして同一タブ内で再描画**する。**旧エディタの close は行わない**（v1.6.0 までは Tabs API で旧タブを閉じていたが、未保存タブの close が「保存しますか？」ダイアログを誘発するため廃止。`openWith` の in-place 再バインドにより stale タブは残らない）。`activeDocument` を保持してコマンドのルーティング先を決める。リンク先 `.md` は `openLink` が viewType 指定の `vscode.openWith` で Live 状態の別タブを開く。
- **折りたたみ（R-27）**: HTML の `<details><summary>…</summary>…</details>` アコーディオンを対象とする。判定は純粋関数 `detectDetailsBlocks`（`src/core/model.ts`）で、非カーソル時はブロック全体を 1 つの `details-block` ウィジェットへ置換し、Webview 側（`DetailsWidget`）が実際の `<details>` 要素（既定で閉）にマッピングする。ブロック内にカーソルがあるときは生 HTML を表示して編集可能にする。見出し単位のガター折りたたみ（旧 `@codemirror/language` の `foldService`/`codeFolding`/`foldGutter`）は廃止した。折りたたみは表示状態であり TextDocument を変更しない。
- **編集体裁（R-28）**: キャレットは `drawSelection` のカーソル要素を CSS（`.cm-cursor`）で VS Code カーソル色に。タスクチェックボックスは `<input>` をやめ `span`（`role=checkbox`）にして選択移動の副作用を排除。左パディングを拡大して左余白を確保（ガター廃止で空いた領域を本文余白へ）。本文・見出し・各記法の文字色は `var(--vscode-...)` でテーマ追従させ、ハードコード色を排除。

## 設計制約

- **ユーザーの Markdown 文字列を書き換えない**（装飾は表示のみ）。`computeDecorations` の入力不変性はテストで担保。
- 新記法は **まず `src/core` に純粋関数として実装し、テストを追加**してから Webview 描画を足す。
- Widget クリック等の副作用（Wikilink オープン・タスクトグル）は Webview→拡張ホストの postMessage 経由で行い、純粋ロジックには持ち込まない。

## 主要コンポーネント対応表

| 関心事 | ファイル |
|---|---|
| 装飾判定（全記法） | `src/core/model.ts` |
| 同期・差分・IME・カーソル行 | `src/core/sync.ts` |
| ビューポート・設定 | `src/core/viewport.ts` |
| Decoration 変換・Widget | `src/webview/decorations.ts` |
| エディタ起動・メッセージ | `src/webview/main.ts` |
| Provider・ホスト同期・Wikilink 解決 | `src/livePreviewEditorProvider.ts` |
| activate・コマンド登録 | `src/extension.ts` |
