---
name: viewport-decoration-wiring
description: StateEffect で可視行窓を装飾 StateField へ渡す設計を採用
metadata:
  type: project
---

# ADR-0016: ビューポート限定装飾の結線

- **ステータス**: 採択済み（v1.23.0 で採択）
- **確信度**: 高

## コンテキスト

`computeDecorations` は `lineRange` による装飾範囲の限定と `viewportWindow` によるパディング済み行窓を提供していたが、Webview の CodeMirror には結線されていなかった。このため数千行の文書でも、入力や選択変更のたびに全行の装飾を再計算していた。

CodeMirror の表と `<details>` は block decoration を使用する。block decoration は `ViewPlugin` から直接提供できないため、ADR-0009 以来の装飾用 `StateField` を維持する必要がある。

## 決定

- `ViewPlugin` が CodeMirror の可視位置を 0-based 行番号へ変換し、`viewportWindow` で前後 50 行を含む窓を算出する。
- 行窓は `StateEffect` で装飾用 `StateField` へ渡し、`StateField` が `lineRange` と `DecorationSet` を保持する。
- 行窓が変化した場合だけ effect を dispatch し、同一窓による更新ループを防ぐ。
- 装飾再計算時はカーソルと選択範囲の行を必ず行窓へ含め、カーソル行の Markdown raw 表示を維持する。
- `lineRange` が未指定の場合は従来どおり全行を装飾し、純粋ロジックと呼び出し側の後方互換性を維持する。

## 理由

可視範囲の把握は `EditorView` を参照できる `ViewPlugin` の責務だが、block decoration の提供は `StateField` に残す必要がある。`StateEffect` を境界にすると、この二つの制約を分離したまま CodeMirror の transaction 内で状態を更新できる。

## 影響

- スクロール、文書変更、初期表示の後に行窓が更新され、窓外の装飾は生成されない。
- カーソル・選択行が可視範囲外にある場合、raw 表示を守るため行窓はその行まで拡張される。
- 遠距離スクロール時も、同一のパディング済み窓である限り装飾 transaction は追加されない。

## 捨てた選択肢

- **`ViewPlugin` から decoration を直接提供する**: block decoration に関する CodeMirror の制約に反する。
- **スクロールのたびに無条件で effect を dispatch する**: 同一行窓で不要な再計算が発生する。
- **カーソル行を行窓から除外する**: R-28 のカーソル行 raw 表示を壊す。
