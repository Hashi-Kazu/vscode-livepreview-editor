---
name: esbuild-dual-bundle
description: esbuild で拡張ホスト (CJS/Node) と Webview (IIFE/browser) を 2 エントリでバンドル
metadata:
  type: project
---

# ADR-0004: esbuild による 2 エントリデュアルバンドル構成

- **ステータス**: 採択済み
- **確信度**: 高（esbuild.js・package.json から明示的に確認）

## コンテキスト

VS Code 拡張は 2 つの実行環境を持つ:
1. **拡張ホスト** — Node.js で動く CJS モジュール（VS Code API を使用）
2. **Webview** — ブラウザ環境で動く IIFE（CodeMirror を含む DOM 依存コード）

これらを 1 つのビルドシステムで管理し、開発体験を損なわず本番出力を最適化する必要があった。

## 決定

esbuild を採用し、1 つの `esbuild.js` スクリプトから 2 つのエントリポイントを並列ビルドする。

| エントリ | フォーマット | プラットフォーム | 出力 |
|---|---|---|---|
| `src/extension.ts` | CJS | node | `dist/extension.js` |
| `src/webview/main.ts` | IIFE | browser | `dist/webview.js` |

`vscode` は external として除外（Node runtime で注入される）。

## 理由

- esbuild は webpack/rollup と比較してビルドが桁違いに速く、ウォッチビルドの開発体験が良い
- CodeMirror をバンドルした webview.js が約 0.5MB になるが、IIFE 形式で CSP の `nonce` スクリプトとして機能する
- 2 エントリを並列処理（`Promise.all`）することで出力時間を最小化できる
- `tsc --noEmit` による型チェックと `esbuild` によるバンドルを分離することで、型エラーとバンドルエラーを独立して検知できる

## 捨てた選択肢

- **webpack**: 設定が複雑で VS Code 公式テンプレートでは使われているが、ビルド速度が遅い
- **rollup**: プラグインエコシステムの追加設定が必要で esbuild より設定量が多い
- **tsc のみ**: CodeMirror を含む大規模バンドルには tsc 単体では対応できない
