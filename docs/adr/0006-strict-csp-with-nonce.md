---
name: strict-csp-with-nonce
description: Webview HTML に nonce 付き strict CSP を設定し inline script を制限
metadata:
  type: project
---

# ADR-0006: Webview への nonce ベース厳格 CSP の適用

- **ステータス**: 採択済み
- **確信度**: 高（src/livePreviewEditorProvider.ts:324-330 から明示的に確認）

## コンテキスト

VS Code の Webview は Chrome の iframe として動作し、悪意あるスクリプト注入（XSS）のリスクがある。特に Markdown 内容をレンダリングする性質上、ユーザーコンテンツが DOM に到達する経路を最小化する必要があった。

## 決定

Webview HTML に以下の CSP を設定する:

```
default-src 'none';
img-src ${webview.cspSource} https: data:;
style-src ${webview.cspSource} 'unsafe-inline';
script-src 'nonce-${nonce}';
font-src ${webview.cspSource};
```

スクリプトタグには 32 文字のランダム nonce を付与し、`script-src 'nonce-…'` だけを許可する。

## 理由

- VS Code の Webview セキュリティガイドラインへの準拠（VS Code 公式ドキュメントで推奨）
- `script-src 'unsafe-inline'` を避けることで、Markdown 内のインライン `<script>` タグが実行されない
- `default-src 'none'` をベースとすることで、必要なソースのみを明示的に許可するホワイトリスト方式を取れる
- 画像は `webview.cspSource`（拡張のローカルリソース）・`https:`・`data:` URI を許可し、ユーザーが埋め込んだ画像が表示できる

## 捨てた選択肢

- **`script-src 'unsafe-inline'`**: Markdown 内のスクリプトが実行されてしまうセキュリティリスク
- **CSP なし**: VS Code の Webview ガイドライン違反。Marketplace 審査で指摘される可能性がある
