# vscode-livepreview-editor

VS Code extension for a Markdown live-preview editing editor.
TypeScript + CodeMirror 6 + esbuild + VS Code API.

## 必須ルール

- 開発タスクは `feature-dev` を使う。
- `feature-dev` はコード修正・仕様書更新・バージョン更新・受け入れテスト更新まで担当する。
- `feature-dev` は `npm test` を実行しない。テストコードの更新・追加は行ってよい。
- 受け入れテストは、ユーザーから明示指示がある場合のみ `acceptance-test` で実行する。
- publish は `publisher` が build / commit / push まで担当する。
- 要求仕様書の正本は `docs/requirements-usdm.md`。
- 要求・仕様を変えたら `docs/requirements-usdm.md` を更新し、`package.json` の version を揃える。
- アーキテクチャ変更時は `docs/architecture.md` と関連 ADR を確認・更新する。
- ユーザーの Markdown 本文は書き換えない。装飾は表示のみ。

## 必要時に読む詳細

- 要求・仕様変更時: `docs/requirements-usdm.md`
- アーキテクチャ・データモデル・設計制約変更時: `docs/architecture.md` と `docs/adr/`
- エージェント運用判断時: `docs/ai/agent-workflow.md`
- リリース・バージョン・公開判断時: `docs/ai/release-policy.md`
- 技術スタック・構成確認時: `docs/ai/project-overview.md`
- 過去経緯が必要な調査時のみ: `docs/ai/development-history.md`

## よく使うコマンド

```bash
npm run compile
npm test
npm run coverage
```

## publisher 最短フロー

publisher は以下だけ行う:

1. `git status -sb`
2. `npm run compile`
3. `git diff --stat`
4. 必要な変更だけ stage
5. commit
6. push

禁止:

- リポジトリ全体の再調査
- docs 全体の読み直し
- 不要なレビュー
- `npm test` の実行
- 機能コードの編集

`npm run compile` 後に生成物が変わった場合は、追跡対象かどうかを `git status -sb` で確認し、必要なものだけ含める。

## 参照先

- 詳細な開発履歴: `docs/ai/development-history.md`
- 技術スタック・構成: `docs/ai/project-overview.md`
- エージェント運用詳細: `docs/ai/agent-workflow.md`
- リリース運用: `docs/ai/release-policy.md`
- 要求仕様: `docs/requirements-usdm.md`
- アーキテクチャ: `docs/architecture.md`
