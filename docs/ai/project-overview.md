# Project Overview

## 概要

VS Code 拡張機能。Obsidian ライクな Markdown ライブプレビュー編集エディタ。TypeScript + CodeMirror 6 + esbuild + VS Code API（`CustomTextEditorProvider`）構成。

## 技術スタック

- TypeScript
- CodeMirror 6（`@codemirror/view` / `@codemirror/state` / `@codemirror/lang-markdown` / `@codemirror/commands`）
- VS Code Extension API（`@types/vscode` ^1.85.0）、`CustomTextEditorProvider`
- ビルド: esbuild（拡張ホスト = CJS / Webview = IIFE の 2 エントリ）
- テスト: Vitest（`src/core` の純粋ロジックを対象）
- エントリポイント: `src/extension.ts`（拡張ホスト）/ `src/webview/main.ts`（Webview）
- ビルド出力: `dist/extension.js` / `dist/webview.js`

## コマンド

```bash
npm install
npm run compile   # 型チェック(tsc --noEmit) + esbuild バンドル -> dist/
npm test          # Vitest（受け入れテスト）
npm run coverage  # カバレッジ付きテスト
npm run watch     # ウォッチビルド
```

## ディレクトリ構成

```text
src/core/         # 純粋ロジック（CodeMirror/VS Code 非依存・テスト対象）
src/webview/      # CodeMirror 6 統合（core の記述子を Decoration に変換）
src/              # 拡張ホスト（extension.ts / livePreviewEditorProvider.ts）
test/             # Vitest テスト
docs/             # 要求仕様書（USDM形式）・アーキテクチャ・受け入れテスト
media/            # アイコン・CSS
releases/         # リリース履歴と CHANGELOG
dist/             # ビルド出力（自動生成）
```

## 設計の肝

- 装飾判定ロジックは CodeMirror から完全分離した純粋関数として `src/core/model.ts`（`computeDecorations` / `computeDecorationsSafe`）に実装する。
- Webview 層（`src/webview/decorations.ts`）が `DecoSpec` 記述子を CodeMirror の `Decoration` にマッピングする。
- 新しい記法を追加するときは、まず `src/core/model.ts` に純粋関数として実装し、`test/` にユニットテストを追加する。
- 同期・差分・IME 抑制・カーソル行判定は `src/core/sync.ts`、ビューポート限定・設定解決は `src/core/viewport.ts`。
- ユーザーの Markdown テキストを書き換えない。装飾は表示のみで、`computeDecorations` は入力文字列を変更しない。

## 注意事項

- Webview バンドル（`dist/webview.js`）は CodeMirror に加え KaTeX（R-32 数式レンダリング、JS 約 +280KB）を含むため大きいが正常。KaTeX の CSS/フォントは `esbuild.js` がビルド時に `media/katex/` へコピーし Webview から配信する。
- スコープは素の Markdown（CommonMark + GFM）の編集・プレビュー。
- Obsidian 独自機能（Wikilink / 埋め込み / コールアウト / タグ / 脚注 / バックリンク等）は v1.5.0 で削除済み。再追加時は品質リスクとホスト側ワークスペース I/O を避ける方針を確認する。
