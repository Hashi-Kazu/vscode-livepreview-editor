---
name: decospec-intermediate-representation
description: フレームワーク非依存の中間表現 DecoSpec を設け、純粋ロジック層と CM6 Decoration API を橋渡しする
metadata:
  type: project
---

# ADR-0003: DecoSpec 中間表現の導入

- **ステータス**: 採択済み
- **確信度**: 高（src/core/model.ts・architecture.md から明示的に確認）

## コンテキスト

ADR-0002 で純粋関数層を分離したことで、純粋ロジック層の出力を CodeMirror の `Decoration` オブジェクトに渡す変換層が必要になった。この変換をどう表現するかを決定する必要があった。

## 決定

`DecoSpec` 型（絶対オフセット + 意味タグ + CSS クラス + 付加情報を持つプレーンオブジェクト）を中間表現として定義する。

```ts
interface DecoSpec {
  from: number;
  to: number;
  type: 'hide' | 'mark' | 'line' | 'replaceWidget';
  tag: string;        // 'strong', 'heading', 'table-block', …
  className?: string;
  attrs?: Record<string, string>;
}
```

`computeDecorations()` は `DecoSpec[]` を返す。Webview 層の `decorations.ts` がこれを `Decoration.mark/line/replace` に変換する。

## 理由

- CodeMirror の `Decoration` オブジェクトは DOM に依存するため純粋層では生成できない
- プレーンオブジェクト配列であるため JSON シリアライズ可能であり、テストでのアサーションが容易
- `tag` フィールドで意味的な区別（`strong` vs `em` など）を保持しつつ、CSS クラスは Webview 側で付与することで表示の責務を分離できる

## 捨てた選択肢

- **CodeMirror の RangeSet を直接返す**: 純粋層が CM6 に依存してしまい ADR-0002 の目的を達成できない
- **文字列ベースの記述子**: 型安全性が失われる
