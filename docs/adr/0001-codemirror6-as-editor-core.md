---
name: codemirror6-as-editor-core
description: Webview内エディタエンジンとして CodeMirror 6 を採用
metadata:
  type: project
---

# ADR-0001: CodeMirror 6 をエディタコアとして採用

- **ステータス**: 採択済み
- **確信度**: 高（package.json の依存関係と初期コミットから明示的に確認）

## コンテキスト

VS Code 拡張として Obsidian ライクな Markdown ライブプレビューエディタを実装する必要があった。Webview 内で動作するエディタエンジンの選定が必要だった。

候補として考えられたエンジン:
- CodeMirror 6（@codemirror/* パッケージ群）
- CodeMirror 5
- Monaco Editor（VS Code 本体が使うエンジン）
- テキストエリア + カスタム描画

## 決定

CodeMirror 6（`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`, `@codemirror/commands`）を採用する。

## 理由

- `ViewPlugin` / `DecorationSet` による宣言的な装飾 API がライブプレビュー実装に直接対応する
- `@codemirror/lang-markdown` により Markdown の構文ハイライトと言語サポートを既製品として利用できる
- Monaco は VS Code の webview 環境では配布・CSP制約の問題があり、また本拡張の用途（軽量な Markdown 編集）に対してオーバースペック
- CodeMirror 5 は ES モジュール非対応で esbuild バンドルとの相性が悪い

## 捨てた選択肢

- **Monaco Editor**: CSP 制約と配布サイズの問題。VS Code 本体の webview 内での Monaco 利用は公式サポート外で複雑
- **テキストエリア + カスタム描画**: カーソル/選択/IME 処理を自前実装する必要があり、品質担保が困難
- **CodeMirror 5**: ES モジュール非対応。初期コミットから CM6 を採用しており CM5 への移行形跡なし（調査時点で痕跡なし）
