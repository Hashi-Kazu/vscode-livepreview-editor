# Release Policy

## バージョンポリシー

- 要件変更あり: マイナーアップ。
- コード修正のみ: パッチアップ。
- フェーズまたはバージョン完了ごとに `package.json` の `version` を上げ、`releases/CHANGELOG.md` に変更点を追記する。

## publisher の責務

`publisher` は build / commit / push までを担当する。機能コードの変更、不要なレビュー、リポジトリ全体の再調査、docs 全体の読み直し、`npm test` の実行はしない。

標準フロー:

1. `git status -sb`
2. `npm run compile`
3. `git diff --stat`
4. 必要な変更だけ stage
5. commit
6. push

`npm run compile` 後に生成物が変わった場合は、追跡対象かどうかを `git status -sb` で確認し、必要なものだけ含める。

## Marketplace 公開

Marketplace への自動公開が設定済み。`main` ブランチへ push すると GitHub Actions（`.github/workflows/publish.yml`）が起動し、ビルド・テスト・Marketplace 公開まで自動実行される。

`publisher` は commit と push まで担当し、以降は CI が引き継ぐ。
