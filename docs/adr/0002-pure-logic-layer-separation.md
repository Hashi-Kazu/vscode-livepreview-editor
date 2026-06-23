---
name: pure-logic-layer-separation
description: 装飾判定ロジックを CodeMirror/VS Code 非依存の純粋関数層 (src/core/) に分離
metadata:
  type: project
---

# ADR-0002: 装飾判定ロジックを純粋関数層として分離

- **ステータス**: 採択済み
- **確信度**: 高（architecture.md に明示的に記述・コードで実証）

## コンテキスト

Markdown の装飾判定（太字・見出し・テーブルなど）は複雑なロジックを含む。これをエディタ（CodeMirror）の ViewPlugin に直接実装すると、DOM / エディタインスタンスなしにユニットテストを書くことができない。

## 決定

装飾判定ロジックを `src/core/` 配下の純粋関数（CodeMirror / VS Code に一切依存しない）として実装する。

- `src/core/model.ts`: `computeDecorations()` — ドキュメント文字列 + カーソル行セットを受け取り `DecoSpec[]` を返す
- `src/core/sync.ts`: `diffRange()`, `shouldResync()`, `shouldEmitEdit()` など同期判定ロジック
- `src/core/viewport.ts`: ビューポート計算・設定解決

Webview 層（`src/webview/decorations.ts`）が `DecoSpec` 記述子を CodeMirror の `Decoration` オブジェクトにマッピングする（変換層）。

## 理由

- DOM やエディタインスタンスなしに Vitest で直接ユニットテストできる
- 「ユーザーの Markdown 文字列を書き換えない」という不変条件をテストで担保できる
- 新記法の追加時に「まず純粋関数を書いてテストを通す → 次に Webview 描画を足す」という安全な順序で開発できる
- ロジックの変更が CodeMirror の内部実装詳細から隔離される

## 捨てた選択肢

- **ViewPlugin 内に直接実装**: テスト不可能。DOM/エディタ依存でデバッグが困難
- **調査時点で他の分離パターンの形跡なし**
