---
name: vitest-for-unit-tests
description: ユニットテストに VS Code Extension Test Framework でなく Vitest を採用
metadata:
  type: project
---

# ADR-0011: Vitest によるユニットテスト

- **ステータス**: 採択済み
- **確信度**: 高（package.json・vitest.config.ts から明示的に確認）

## コンテキスト

VS Code 拡張の標準テストフレームワーク（`@vscode/test-electron`）は VS Code インスタンスを起動してテストを実行するため、CI での実行が重く、セットアップが複雑。一方、本プロジェクトのテスト対象である `src/core/` は純粋関数であり、VS Code や DOM に依存しない。

## 決定

`src/core/` の純粋ロジックのユニットテストに Vitest を採用する。テストは VS Code インスタンスなしに Node.js で直接実行される。

```bash
npm test        # vitest run
npm run coverage # vitest run --coverage
```

## 理由

- ADR-0002 で純粋関数層を分離したことで、VS Code なしでテスト可能になった
- Vitest は Jest 互換の API を持ちつつ esbuild ベースで高速
- TypeScript の設定（`tsconfig.json`）と同じ環境でテストが動くため、型の不整合を早期検出できる
- CI でのセットアップが軽量（`npm test` 1 コマンド）

## 捨てた選択肢

- **@vscode/test-electron**: VS Code インスタンス起動が必要で CI が重い。`src/core/` のような純粋関数には過剰
- **Jest**: Vitest と機能差が少ないが、esbuild との統合が Vitest のほうがシームレス
