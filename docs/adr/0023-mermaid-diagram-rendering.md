---
name: mermaid-diagram-rendering
description: ```mermaid フェンスを SVG としてライブレンダリングし、編集移行をコンテキストメニュー・オプトインで行う
metadata:
  type: project
---

# ADR-0023: Mermaid ダイアグラムのライブレンダリング

- **ステータス**: 採択済み（v1.43.0）
- **確信度**: 高（src/core/model.ts・src/webview/decorations.ts・src/webview/main.ts・package.json から明示的に確認）

## コンテキスト

GitHub Issue #42 は、```mermaid フェンスコードブロック（フローチャート・シーケンス図等）を編集中にそのまま図として確認できることを求める。既存の類似機能には二つの前例がある。

- **KaTeX 数式（R-32）**: SVG/DOM 描画を widget で行い、キャレットがブロックへ入ると自動的に生記法へフォールスルーする。ただし `katex.render` は**同期** API である。
- **`<details>` アコーディオン（R-27）**: 既定ではキャレット位置に依らず常にビューア専用ウィジェットを維持し、生記法編集への移行は右クリックコンテキストメニュー「Markdownコードを直接編集」からの**明示的オプトイン**でのみ発生する。

Mermaid には二つの固有事情がある。(1) Mermaid v10+ の `mermaid.render(id, code)` は **Promise を返す非同期 API** であり、同期の `toDOM()` では SVG を即時に得られない。(2) 図は情報密度が高く、キャレットが偶発的にブロックへ入るたびに生記法へ切り替わると閲覧体験を損なう。

## 決定

### 検知・装飾判定（純粋関数、R-36-01 / R-36-02）

- 純粋関数 `detectMermaidBlocks(lines, code)`（`src/core/model.ts`）で、`detectCodeBlocks` の結果を入力に、開始フェンス情報文字列先頭トークンが `mermaid`（大小無視）のフェンスコードブロックを `{ start, end, code }` として検知する。未終了フェンス・他言語は対象外。フェンス検知（`detectCodeBlocks`）は不変。
- `computeDecorations` は**既定ではキャレット位置に依らず**ブロック全体を `mermaid-block` block `replaceWidget`（`attrs.code`／`attrs.startLine`）へ置換する（ビューア専用、R-27-03 と同型）。`DecorationOptions.mermaidDirectEditStartLines?: Set<number>` に開始行がオプトインされ**かつ**キャレットがブロック内にあるときだけ、ウィジェットを emit せず既存コードブロック描画（R-34 言語ハイライト含む）へフォールスルーする。

### 編集移行＝コンテキストメニュー・オプトイン（R-27-07 踏襲、R-36-05）

- **KaTeX のキャレット自動フォールスルーは採らない。** 編集移行は Webview の右クリックコンテキストメニュー項目「Mermaidを編集」からのオプトインでのみ発生する。ハンドラは開始行を module-level `Set<number>`（`mermaidDirectEditStartLines`、`src/webview/main.ts`）へ登録し、キャレットを開始行へ移動する（`moveCaretToLineStart` を再利用）。
- キャレットがブロック外へ出たら `pruneMermaidDirectEdit`（`computeField` 内で毎回実行）が集合から除去し、次回計算でウィジェットへ復帰する（表 R-22-09・`<details>` R-27-07 と同じ体験）。メニュー chrome・`closeTableMenu`・`onDocMouseDownForTableMenu`・`onKeyDownForTableMenu` は既存を再利用する。

### 非同期レンダリング widget（R-36-03 / R-36-04）

- `MermaidBlockWidget`（`src/webview/decorations.ts`）は **同期プレースホルダ + 非同期注入**方式。`toDOM()` はコンテナ `<div class="cm-lp-mermaid-block" data-start-line>` を同期生成して即返し、`mermaid.render(uniqueId(), code)` の Promise resolve 時に `container.innerHTML = svg` で描画する（`securityLevel: 'strict'` の DOMPurify サニタイズ済み SVG 文字列のため、生ユーザー HTML の直接注入にあたらない）。
- モジュール初期化で `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })` を 1 回だけ行う。`theme` は `document.body` の `vscode-dark`／`vscode-high-contrast` クラスから `'dark'`／`'default'` を選択。
- レンダリング失敗（reject／throw）時は Webview を落とさず、生コードを `<pre class="cm-lp-mermaid-error">`（`textContent`、innerHTML 不使用）でフォールバック表示する。
- モジュールスコープの SVG キャッシュ（キー = `theme + '\n' + code`）でヒット時は `toDOM` 内で同期注入し、再描画のちらつき・再測定を抑える。`eq` は code と startLine で比較し DOM 再利用を効かせる。
- `estimatedHeight` を実装（`code` の行数 × `linePx()` + フォントサイズ）し、`toDOM` 内では `requestMeasure` を呼ばない。非同期描画完了時と `updateDOM` で `requestMeasure` を呼び、`block: true` ウィジェット直下のクリック位置ずれを解消する（R-28-10 / R-28-11）。非同期 resolve 時にコンテナが DOM から切り離されていれば注入・measure をスキップする。

## 理由

- **編集移行をオプトイン方式に（KaTeX の自動フォールスルー非採用）**: 図は閲覧価値が高く、キャレットがブロックへ入るたびに生記法へ切り替わると視認性を損なう。`<details>` と同じく「見るのが既定、編集は明示操作」の方が Mermaid の利用実態に合う。状態を module-level 集合に持たせ純粋関数がオプトイン集合とキャレット位置から判定する構成なら、新規 StateField 拡張なしに実現でき「装飾判定は純粋関数」の設計制約（ADR-0002 / 0003）を維持できる。
- **同期プレースホルダ + Promise 注入 + `requestMeasure` 収束**: `mermaid.render` が非同期のため、`toDOM` で SVG を待つことはできない。プレースホルダを即返し、resolve 後に注入・再測定する方式なら CodeMirror の同期描画契約を壊さず、ブロック高さ会計（R-28-10/11）も `requestMeasure` の収束で満たせる。
- **CSP 無変更**: 使用 mermaid バージョンは esbuild の IIFE バンドルに同梱でき、実行時に `eval`／`new Function`／外部フォント読込／web worker／動的 `import()` を要求しないことをバンドル走査で確認した。生成 SVG の inline `<style>` は既存 `style-src 'unsafe-inline'`（ADR-0006）で許可済み。よって CSP（nonce script-src／`style-src 'unsafe-inline'`／`img-src data:`）を一切変更しない。

## 影響

- 新規依存: `mermaid`。Webview バンドル（`dist/webview.js`）のサイズが大きく増加する（図表描画の価値とのトレードオフとして許容、ADR-0004 の二重バンドル構成・ADR-0021 の単一 Webview バンドル方針は不変）。
- `src/core/model.ts` に `detectMermaidBlocks`／`MermaidBlock`／`DecorationOptions.mermaidDirectEditStartLines` と `computeDecorations` のフェンス分岐先頭の mermaid 判定を追加。`detectCodeBlocks` と既存の table/details/math/alert 検知・R-34 言語ハイライトは不変。
- `src/webview/decorations.ts` に `MermaidBlockWidget`・`toDecoration` の `mermaid-block` 分岐・mermaid 初期化とキャッシュを追加。`src/webview/main.ts` に `mermaidDirectEditStartLines`／`pruneMermaidDirectEdit`／`showMermaidMenu`／contextmenu・mousedown 分岐を追加（既存 `detailsDirectEditStartLines`／表メニュー挙動は不変）。
- `media/editor.css` に `.cm-lp-mermaid-block`／`.cm-lp-mermaid-error` を追加（テーマ追従）。
- 検証は純粋関数 spec の単体テスト（`test/feature.issue42.mermaid.test.ts`）＋`npm run compile` 通過で担保する。非同期 SVG 描画・コンテキストメニュー結線・キャレット離脱復帰・CSP 実挙動・テーマ追従は DOM/Webview 依存のため実 Live Preview 上の手動確認で担保する（ADR-0021・R-27-07 と同じ担保方針）。
