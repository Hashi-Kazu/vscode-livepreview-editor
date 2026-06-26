# Agent Workflow

## 基本方針

コード修正・機能追加・バグ修正など、あらゆる開発タスクは必ず `feature-dev` エージェントを通して行う。

すべてのエージェント起動は main が行う。サブエージェント間で直接指示はできない。

## エージェント一覧

| エージェント | 役割 |
|---|---|
| `feature-dev` | 開発全部（コード・仕様書・バージョン・受け入れテスト更新） |
| `debugger` | バグ調査のみ（読み取り専用） |
| `acceptance-test` | 受け入れテスト実行・ステータス `■■■` 反映 |
| `publisher` | build / commit / push |

## 開発フロー

1. main が `feature-dev` を起動する。
2. `feature-dev` がコード修正、仕様書更新（ステータス `■■□`）、バージョンバンプ、受け入れテスト更新を一括で行う。
3. バグ調査が必要な場合は main が `debugger` を起動する。
4. `feature-dev` は成功報告時に型チェック/build 通過とステータス `■■□` 更新済みを報告する。
5. 受け入れテストはユーザーから明示的に指示があった場合のみ、main が `acceptance-test` を起動して実行する。指示がない場合はスキップする。
6. 受け入れテストで FAIL がある場合は、main が `feature-dev` を再起動して修正させる。
7. PASS / SKIP のみ、または受け入れテストが明示指示なしでスキップされた場合、main が `publisher` を起動する。

## feature-dev のルール

- `feature-dev` は `npm test` を実行しない。`npm test` の実行は `acceptance-test` の責務。
- テストコードの更新・追加は行ってよい。
- 要件を変えたら `docs/requirements-usdm.md` を更新し、`package.json` のバージョンを揃える。
- アーキテクチャを変えたら `docs/architecture.md` と関連 ADR を確認・更新する。
- バージョンポリシーは、要件変更ありならマイナーアップ、コード修正のみならパッチアップ。

## エージェント定義の管理

エージェント定義（Claude Code = `.claude/agents/*.md`、Codex = `.codex/agents/*.toml`）は `C:\Claude Code\_agent-templates`（正本）から配布された同期コピー。

直接編集せず、正本を編集して `_agent-templates\sync-agents.ps1` を実行する。直接編集は次回同期で上書きされる。

プロジェクト固有の事情はエージェント定義ではなく、プロジェクト指示ファイル（`AGENTS.md` 正本 / `CLAUDE.md` は `@AGENTS.md` で取り込み）に書く。
