---
name: minimal-diff-workspace-edit
description: Webview からの編集をドキュメント全体置換でなく diffRange による最小差分 WorkspaceEdit で適用
metadata:
  type: project
---

# ADR-0007: 最小差分による WorkspaceEdit 適用

- **ステータス**: 採択済み
- **確信度**: 高（src/core/sync.ts の diffRange・src/livePreviewEditorProvider.ts:167-183 から明示的に確認）

## コンテキスト

Webview（CodeMirror）でユーザーが文字を入力するたびに、VS Code の `TextDocument` を更新する必要がある。最も単純な実装はドキュメント全体を `edit.replace(全範囲, 新文字列)` で上書きすることだが、これには問題がある。

## 決定

`diffRange(oldText, newText)` で共通プレフィックス・サフィックスを除いた最小変更範囲を算出し、その範囲だけを `WorkspaceEdit` で `replace` する。

```ts
const diff = diffRange(current, target);
if (!diff) return;
edit.replace(document.uri, diff.range, diff.newText);
```

## 理由

- ドキュメント全体置換は VS Code の undo スタックを「全文書を1つのundo単位」として記録するため、undo の粒度が荒くなる（1文字入力でも1 undo = 全文書戻し）
- 最小差分 replace なら VS Code の undo 履歴が細かく保たれ、通常のテキストエディタと同等のundo体験になる
- CodeMirror の `ViewUpdate` は文書変更があるたびに発火するため、最小差分で `WorkspaceEdit` を発行することでオーバーヘッドも抑えられる

## 捨てた選択肢

- **全体 replace**: undo 粒度が失われる。ユーザー体験が著しく劣化
- **Character-by-character diff**: 実装複雑度に対してメリットが薄い。行レベルの前後トリムで十分
