---
name: single-tab-editor-switch
description: Live ↔ 標準エディタ切り替えを「同一タブ内の再描画」として見せるための stale タブクリーンアップ方式
metadata:
  type: project
---

# ADR-0012: ビュー切り替えの単一タブ保持方式

- **ステータス**: 採択済み（v1.7.0 で再定義）
- **確信度**: 高（src/livePreviewEditorProvider.ts:50-90・architecture.md から明示的に確認）

## コンテキスト

`livePreview.toggleSource` コマンドで Live エディタ ↔ 標準テキストエディタを切り替える際、VS Code の `vscode.openWith` は Custom Editor と Standard Editor を **異なる EditorInput** として扱うため、既存タブを置き換えるのではなく新しいタブを開いてしまう。その結果、切り替えのたびにタブが増殖する問題があった。

## 決定

以下の 3 ステップで「同一タブ切り替え」を実現する:

1. `findTab(uri, fromFlavor)` で切り替え前のエディタタブを特定しておく
2. `vscode.openWith` でターゲットエディタを開く（この時点で新タブが開く）
3. 開いた後、古いタブが残っており、かつアクティブタブでないことを確認してから `tabGroups.close` で閉じる

「保存しますか？」ダイアログが出ない理由: 新エディタが同じ `TextDocument` を参照しているため、古いタブを閉じても dirty バッファは新タブ側で生きている。

## 理由

- VS Code API 上「同一タブを完全に in-place 置換」する手段が存在しない（`vscode.openWith` は常に新 EditorInput を生成する）
- stale タブクリーンアップは "最良近似" であり、VS Code のタブ API の動作に依存するため「手動 UI 検証前提」と architecture.md にも明記
- `supportsMultipleEditorsPerDocument: false` との組み合わせで重複 Live タブの共存を防止

## 捨てた選択肢

- **タブ増殖を許容**: ユーザー体験が悪い（v1.7.0 以前の挙動と推察）
- **独自ソースビュー（Webview 内）**: 保存確認ダイアログ問題を解決するために実装複雑度が大幅増。v1.7.0 で廃止

**[要確認]**: v1.7.0 以前の「独自ソースビュー」方式の具体的な問題点（保存確認ダイアログ以外に何があったか）
