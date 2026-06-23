---
name: ci-marketplace-publish
description: main ブランチへの push をトリガーに GitHub Actions で Marketplace 自動公開
metadata:
  type: project
---

# ADR-0014: GitHub Actions による Marketplace 自動公開

- **ステータス**: 採択済み（コミット 39bff5a で追加）
- **確信度**: 高（.github/workflows/publish.yml・コミット履歴から明示的に確認）

## コンテキスト

リリースごとに手動で `vsce publish` を実行する必要があり、忘れや手順ミスのリスクがあった。また、姉妹プロジェクト（mindmap-editor）が同様の CI 自動公開構成を持っていた。

## 決定

`main` ブランチへの push をトリガーに GitHub Actions ワークフロー（`.github/workflows/publish.yml`）を起動し、ビルド → テスト → VSIX 生成 → Marketplace 公開を自動実行する。

`publisher` エージェントの責務は commit〜push まで。以降は CI が引き継ぐ。

## 理由

- 手動公開の手順ミス・忘れを防止
- `main` ブランチの状態が常に公開済みバージョンと一致するシンプルなルール
- mindmap-editor で実績のある方式を踏襲（コミット e961a0a で push トリガー方式に統一）

## 捨てた選択肢

- **手動 vsce publish**: リリース漏れのリスク
- **タグベーストリガー**: push のたびにタグを打つ手間が生じる。main push 方式のほうがシンプル
