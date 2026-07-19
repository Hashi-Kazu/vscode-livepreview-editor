---
name: custom-text-editor-provider
description: VS Code の CustomTextEditorProvider を使って Markdown を独自エディタとして登録
metadata:
  type: project
---

# ADR-0005: CustomTextEditorProvider の採用

- **ステータス**: 復活（v1.36.0、ADR-0020 で再採用。v1.20.0〜v1.35.x は ADR-0015 により廃止されていた）
- **確信度**: 高（src/livePreviewCustomEditorProvider.ts・package.json から明示的に確認）

## コンテキスト

VS Code 拡張として独自の Markdown エディタ UI を提供するための API を選定する必要があった。候補:
1. `CustomTextEditorProvider` — `TextDocument` と連動する独自エディタ
2. `WebviewPanel` — 独立した Webview パネル（エディタとは別枠）
3. `CustomEditorProvider` — バイナリ等の完全独自形式エディタ

## 決定

`vscode.CustomTextEditorProvider` を実装し、`*.md` ファイルを `priority: option`（デフォルトではなく選択肢として提供）で登録する。

> v1.20.0 でこの決定は一度廃止し（ADR-0015）、editable `WebviewPanel` と明示的な TextDocument 再取得方式へ移行した。その後 v1.36.0 で WebviewPanel 方式の複雑さ（dirty バッジ非表示・保存/Undo 統合・パネル/タブ二重管理）を解消するため、本決定を **ADR-0020 で再採用**した。現行の viewType は `livePreview.editor`。詳細は ADR-0020 を参照。

```json
"customEditors": [{
  "viewType": "livePreview.markdown",
  "selector": [{ "filenamePattern": "*.md" }],
  "priority": "option"
}]
```

## 理由

- `CustomTextEditorProvider` は `TextDocument` を自動的に管理してくれるため、ファイル I/O・保存・dirty 状態を VS Code に委譲できる
- `WebviewPanel` では `TextDocument` との同期を完全に自前実装しなければならず、保存・undo 統合が困難
- `priority: option` により、ユーザーが標準テキストエディタを既定として維持しつつ、Live Preview を「別の方法で開く」として選べる
- `supportsMultipleEditorsPerDocument: false` で複数 Live エディタの共存を禁止し、同期競合リスクを排除

## 捨てた選択肢

- **WebviewPanel**: TextDocument との手動同期が必要。保存・undo の VS Code 統合が複雑
- **CustomEditorProvider（バイナリ版）**: Markdown はテキストなので TextDocument の恩恵を受けるべき
