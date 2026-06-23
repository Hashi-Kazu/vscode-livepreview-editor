---
name: scope-commonmark-gfm-only
description: スコープを CommonMark + GFM の素の Markdown に限定し、Obsidian 独自機能は削除（v1.5.0）
metadata:
  type: project
---

# ADR-0010: Obsidian 独自機能の削除とスコープ限定

- **ステータス**: 採択済み（v1.5.0 で採択）
- **確信度**: 高（CLAUDE.md に明示的に記述）

## コンテキスト

当初、Obsidian ライクなエディタとして Wikilink・埋め込み・コールアウト・タグ・脚注・バックリンクなどの Obsidian 独自機能を実装していた。しかしこれらの機能はホスト側のワークスペース I/O（ファイル検索・リンク解決等）を必要とし、品質リスクが高かった。

## 決定

v1.5.0 でこれらの Obsidian 独自機能をすべて削除し、スコープを **CommonMark + GFM（GitHub Flavored Markdown）の素の Markdown** に限定する。

## 理由

- Wikilink 解決・バックリンク検索はワークスペース全体の I/O を必要とし、拡張の複雑度が急増する
- Obsidian 独自記法は VS Code エコシステムでは標準でなく、ユーザーに対する価値が普遍的でない
- CommonMark + GFM に集中することで品質・テスト・保守性を高められる

## 捨てた選択肢

- **Obsidian 独自機能の維持**: ホスト側 I/O の品質リスクが高く、デグレが生じやすい（CLAUDE.md で「再追加時は品質リスク」と明示）
- **一部機能のみ維持**: 半端な Obsidian 互換はユーザーの混乱を招く

## 注記

将来再追加する場合は、ホスト側ワークスペース I/O を避ける方針を守ること（CLAUDE.md に明記）。
