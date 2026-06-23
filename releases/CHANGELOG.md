# Changelog

本拡張のリリース履歴。各バージョンの VSIX は `releases/v{version}/` 配下に格納する。

> ▶️ **開発再開（2026-06-22 時点）**: v1.11.0 の開発凍結を v1.12.0 で解除し、開発を再開した。


## v1.16.5 — 選択ハイライト余白マスクを clip-path から mask-image 方式へ変更 (2026-06-23)

### 修正

- **`.cm-selectionLayer` のマスク方式を `clip-path: inset()` から `mask-image` グラデーション方式へ変更（`media/editor.css`）。** `clip-path` の絶対ピクセル指定では右端のクリッピングが実際のレイヤー幅に追従しないケースがあったため、`linear-gradient` マスクで左 48px・右 40px を透明にする方式に改善した。

## v1.16.4 — 選択ハイライトが左右余白にはみ出る問題を修正 (2026-06-23)

### 修正

- **`.cm-selectionLayer` に `clip-path: inset(0 40px 0 48px)` を追加（`media/editor.css`）。** `drawSelection()` による選択ハイライトが `.cm-content` の左余白（48px）・右余白（40px）にはみ出る問題を修正。`clip-path` で選択レイヤーをコンテンツ領域内に収めた。

## v1.16.3 — 区切り線の上下の空きを縮小 (2026-06-23)

### 修正

- **HR 行（`.cm-lp-hr-line`）の `padding` を `0.4em 0` → `0.15em 0` に縮小（R-28-14、`media/editor.css`）。** v1.16.1 で margin → padding 変換を行った際に設定した 0.4em の余白が大きすぎたため、0.15em に縮小した。

## v1.16.2 — リンクの常時下線表示・タスクリスト内リンクのスタイル修正 (2026-06-23)

### 修正

- **リンクを常時下線表示でリンクとわかる見た目に修正。** 装飾表示中のリンクテキストに下線が付かず、リンクであることがわかりにくかった問題を修正。
- **タスクリスト内のリンクもリンク色・下線を表示。** チェックボックス付きリスト項目中のリンクに対して、他のリンクと同様のリンク色・下線スタイルが適用されるようにした。

## v1.16.1 — 見出し・HR の margin→padding 変換によるクリック位置ずれ残存修正 (2026-06-23)

### 修正

- **見出し行（`.cm-line.cm-lp-h1`〜`h6`）の `margin-top`/`margin-bottom` を `padding-top`/`padding-bottom` に変換（R-28-14、`media/editor.css`）。** `getBoundingClientRect().height` は CSS `margin` を含まないため、CodeMirror の height oracle が見出し行の上下余白を計上できず、スクロール量に比例してクリック位置ずれが累積していた。R-28-10 でテーブルに対して同原則の修正（margin→padding）を行ったが、見出しと HR に同問題が残存していた。h1/h2 は `padding-bottom: 0.3em`（下余白）と `0.25em`（border-bottom 上の空き）を `0.55em` に統合。
- **HR 行（`.cm-lp-hr-line`）の `margin: 1em 0` を `padding: 0.4em 0` に変換（R-28-14、`media/editor.css`）。** 同じ理由（margin は height oracle に計上されない）で修正。同時に余白を 1em → 0.4em に縮小し、`border-top` を 2px（透明度 0.4）→ 3px（透明度 0.5）に変更して区切り線の視認性を向上。
- **`applyFontSize` 末尾に `requestAnimationFrame(() => view.requestMeasure())` を追加（R-28-14、`src/webview/main.ts`）。** フォントサイズ変更後に全行の実寸が変わるため、height oracle を強制更新するようにした。

## v1.16.0 — スクロール量依存のクリック位置ずれを根本修正 (2026-06-23)

### 修正

- **`#editor { overflow: hidden }` で二重スクロールコンテナを解消し、スクロール後クリック位置ずれを根本修正（R-28-13）。** `#editor { overflow: auto }` と CodeMirror が付与する `.cm-scroller { overflow: auto }` の二重スクロールコンテナが原因で、`#editor.scrollTop` が増加しても `.cm-scroller.scrollTop` は 0 のままになっていた。`posAtCoords` は `.cm-scroller.scrollTop` 基準で座標変換するため、スクロール量に比例してクリック位置がずれる症状が発生していた。`#editor` の `overflow` を `hidden` に変更することでスクロールを `.cm-scroller` に完全委譲し、`posAtCoords` の計算と実際のスクロール位置が一致するようにした（`media/editor.css` の 1 行変更のみ）。

## v1.15.2 — テーブル margin→padding 移管によるクリック位置ずれを修正 (2026-06-23)

### 修正

- **`TableWidget.toDOM()` でテーブルを div ラッパーに包み、`margin` を `padding` へ移管してクリック位置ずれを修正（`src/webview/decorations.ts`・`media/editor.css`）。** `getBoundingClientRect()` は CSS `margin` を含まないため、`table.cm-lp-table { margin: 0.5em 0 }` が付いた状態で CodeMirror が実測すると spacing 分（約 14px）が欠落し、ブロック高さが推定値より低くなっていた。`toDOM()` の戻り値を `div.cm-lp-table-wrapper` で包み、spacing を `padding: 0.5em 0` として wrapper に移管。`getBoundingClientRect()` は padding を含むため測定値が推定値に一致し、テーブル下のテキストへのクリックが正しい行に着地する（R-28-10）。

## v1.15.1 — テーブル行高さ推定誤差・初回 measure タイミングを修正 (2026-06-23)

### 修正

- **`tableRowPx()` の `Math.round` を `Math.ceil` に変更し、行数増加による累積誤差を解消（`src/webview/decorations.ts`）。** font-size 14px では `round(21.28)=21` → `ceil(21.28)=22` となり、行ごとに 1px 過小評価されていた累積ずれが正確な推定値へ収束する。
- **`TableWidget.estimatedHeight` の chrome に border-collapse 境界 1px を追加（`src/webview/decorations.ts`）。** `rows * tableRowPx() + currentFontSize` に `+ 1` を加え、thead/tbody 間の collapse 境界線を推定高さに計上した。
- **`case 'init':` ブロックの `view.setState()` 直後に `requestAnimationFrame(() => view.requestMeasure())` を追加（`src/webview/main.ts`）。** 初回描画後、最初のクリック前に実高さを再測定させることで、初回 `updateDOM` が来る前でも正しい行位置を CodeMirror が把握できるようにした。

## v1.15.0 — クリック位置ずれ・上下矢印の複数行ジャンプを根本修正 (2026-06-23)

### 修正

- **ブロックウィジェット直下のクリック位置ずれを根本修正（R-28-10 再定義 / R-28-11 新規）。** 主因は `toDOM` 内の `view.requestMeasure()` が CodeMirror の measure サイクル中に再 measure を要求し、高さ確定を次フレームへ遅らせていたこと、および `estimatedHeight` が固定値（`LINE_PX=22`/`TABLE_ROW_PX=34`）でフォントサイズ・折返し・details 開閉を無視していたこと。対策として (1) `toDOM` の `requestMeasure` を撤去し更新パス（`updateDOM`）と details の `toggle` のみに一本化、(2) `estimatedHeight` を**現在のフォントサイズ依存**（`setFontSize` でホスト設定を装飾層へ同期）かつ**アコーディオン開閉状態依存**に動的化（プレーン行＝`fontSize×1.6`、テーブル行＝`fontSize×0.95×1.6+13`、details 開時は本文行数を反映）、(3) テーブルセルの `line-height: 1.6` を CSS で固定しインライン `**bold**`/`` `code` `` で行高がブレないように。これによりフォントサイズ 14 以外・セル内インライン記法・details 開閉直後でもブロック直下クリックが正しい行へ着地する（`src/webview/decorations.ts`・`src/webview/main.ts`・`media/editor.css`）。
- **上下矢印がテーブル/アコーディオンをまたぐ際に複数行ジャンプする問題を修正（R-28-12 新規）。** `block: true` ウィジェットは atomic でブロック全体を 1 ストロークでスキップしていた。`ArrowUp`/`ArrowDown` 用のカスタムコマンドを既定キーマップより優先登録し、既定の縦移動（`moveVertically`）が 2 ソース行以上ジャンプする場合のみ現在行 ±1 のソース行へ 1 行ずつ着地させる。折返し段落内の視覚行移動は同一/隣接ソース行に留まるため誤発火せず、通常移動は既定にフォールバックする（`src/webview/main.ts`）。

## v1.14.3 — クリック位置ずれ・スクロール跳び・チェックボックス外観の追加修正 (2026-06-23)

### 修正

- **クリック位置ずれを再修正（R-28-10 再改訂）。** `TABLE_ROW_PX` を 33 → 34px（`padding: 6px 13px` + `line-height: 1.6` 実測値）、chrome を 14 → 15px（border-collapse 込み）に調整。さらに `toDOM(view)` の末尾（return 前）にも `view.requestMeasure()` を追加し（初回マウント直後の実高さ測定）、`updateDOM` を `return false` → `return true` に変更（既存 DOM を再利用しつつ measure のみ要求）。これにより初回描画・更新どちらでも確実に高さが再測定される。`TableWidget`・`DetailsWidget` 両方に適用（`src/webview/decorations.ts`）。
- **チェックボックストグル時のスクロール跳びを根本修正（R-08-07 改訂）。** `setText` を全文置換から**最小差分 dispatch 方式**へ書き換えた。共通プレフィックス・サフィックスを除いた最小変更範囲のみ dispatch することで、CodeMirror がセレクションを自動マッピングし cursor 位置を維持する。全文置換時に生じていた「selection → anchor:0 リセット → scrollIntoView」の連鎖を根本排除（`src/webview/main.ts`）。
- **未チェックボックスの背景を `transparent`、枠を固定 `#888` に変更（R-08-08 改訂、CSS のみ）。** 従来の `background: var(--vscode-input-background)` はエディタ背景と同化して見えにくく、テーマによって枠も薄かった。`transparent` + `#888` は dark/light 両テーマで枠が確実に視認できる（`media/editor.css`）。
- **チェック済みタスク内リンクの文字が暗転しない問題を修正（R-08-08 改訂、CSS のみ）。** `.cm-line.cm-lp-task .cm-lp-link` に明示 color があり `.cm-lp-task-done` の `!important` 継承に勝っていた。`.cm-lp-task-done .cm-lp-link { color: inherit !important }` を追加し、チェック済みタスク内のリンクも取り消し線色に統一した（`media/editor.css`）。

## v1.14.2 — チェックボックス CSS の視認性改善 (2026-06-23)

### 修正

- **未チェックボックスの枠が一部テーマで透明・淡すぎて見えない問題を修正（R-08-08 改訂、CSS のみ）。** `.cm-lp-task-checkbox` の `border` を `1px solid var(--vscode-input-border, …)` から `1.5px solid var(--vscode-checkbox-border, #767676)` へ変更した。`--vscode-input-border` はチェックボックス専用変数ではなくテーマによって透明になり得るため削除し、チェックボックス専用の `--vscode-checkbox-border` を優先する。フォールバックを WCAG AA 対応の `#767676` にしたことで、変数未定義のテーマでも枠が確実に視認できる。枠幅を 1px → 1.5px に拡大し存在感を強化した（`media/editor.css`）。
- **チェック済み本文（`.cm-lp-task-done`）の暗転色が他インライン装飾に上書きされる問題を修正（R-08-08 改訂、CSS のみ）。** `color: var(--vscode-descriptionForeground)` に `!important` を追加し、さらにより暗い `--vscode-disabledForeground` を先に参照する `var(--vscode-disabledForeground, var(--vscode-descriptionForeground, #888)) !important` に変更した。これにより、リンク色等のインライン装飾が付いたタスク本文でも取り消し線色が正しく暗転する（`media/editor.css`）。

## v1.14.1 — クリック位置ずれの根本修正／チェックボックストグル後のスクロールジャンプ修正 (2026-06-23)

### 修正

- **クリック位置ずれの根本原因を修正（R-28-10 再改訂）。** v1.14.0 で `toDOM` 内に `view.requestMeasure()` を追加したが、`toDOM` 実行時点では DOM がまだツリーに挿入されていないため measure が空振りしていた。`toDOM` からは `view.requestMeasure()` を削除し、代わりに `updateDOM(_dom, view)` メソッドを `TableWidget`・`DetailsWidget` 両方に追加して `view.requestMeasure(); return false;` を実行する方式へ変更した（`updateDOM` は DOM がツリー内にある更新パスで呼ばれるため正確に実高さを測定できる）。`DetailsWidget` の `toggle` イベント内の `requestMeasure` はそのまま維持（toggle は DOM がツリー内にあるため有効）。あわせて `estimatedHeight` 精度を向上: `TABLE_ROW_PX` を 31→33px（実測値 ≈ 33px に合わせる）、テーブルの chrome を 8→14px（`margin: 0.5em 0` ≈ 14px を計上）に変更（`src/webview/decorations.ts`）。
- **チェックボックストグル後にスクロール位置が先頭へジャンプする不具合を修正（R-08-07 補完）。** `setText`（`src/webview/main.ts`）の `dispatch` にセレクションを明示していなかったため、全文置換（`from:0, to:doc.length`）後に CodeMirror がセレクションを anchor:0 へリセットし `scrollIntoView` が走っていた。`dispatch` に `selection: { anchor: clamp(sel.main.anchor), head: clamp(sel.main.head) }` を追加し現在位置を保持するよう修正した（`clamp()` で新テキスト長を超えないよう保護）。

## v1.14.0 — クリック位置ずれの measure 主導修正／チェックボックス再デザイン (2026-06-23)

### 修正・変更

- **クリック位置と編集行のずれを measure 主導で解消（R-28-10 改訂）。** ブロックウィジェット（`TableWidget`・`DetailsWidget`、`block: true`）の `estimatedHeight` が実描画高さより小さく、CodeMirror のブロック高さ会計が painted DOM とズレてウィジェットより下の行の `posAtCoords` がずれていた。`TableWidget.toDOM` を `toDOM(view: EditorView)` に変更し DOM 構築後に `view.requestMeasure()` を呼ぶ。`DetailsWidget.toDOM` でも従来 toggle 時のみだった `view.requestMeasure()` を初回描画直後（return 前）にも呼ぶ。あわせて初期推定を改善: プレーン行用の `LINE_PX(22)` は残しつつ、パディング付きテーブル行用に `TABLE_ROW_PX(31)` を導入し `TableWidget.estimatedHeight` を `(ヘッダ＋本文行数) × TABLE_ROW_PX ＋余白` へ調整（`src/webview/decorations.ts`）。
- **タスクチェックボックスを再デザイン（R-08-08 追加、CSS のみ）。** チェック済み＝固定の赤（`#e5484d`／チェックマークは白固定 `#fff`）、未チェック＝テーマ追従の暗い角丸四角（`border-radius: 4px`、塗り `var(--vscode-input-background, …)`、枠 `var(--vscode-input-border, …)`）に変更。DOM・クラス名（`cm-lp-task-checkbox` / `-checked` / `::after`）は不変、チェックマークの位置・サイズを新サイズ・角丸に合わせ微調整（`media/editor.css`）。

## v1.13.0 — アコーディオン本文描画／テーブルのセル編集／ブロックウィジェットの高さ会計修正 (2026-06-22)

### 修正・変更

- **アコーディオンを開いても本文が表示されない不具合を修正（R-27-06 追加）。** `DetailsWidget`（`src/webview/decorations.ts`）がサマリのみ描画し本文を出していなかった。`detectDetailsBlocks`（`src/core/model.ts`）に `DetailsBlock.body`（`</summary>` より後〜`</details>` 直前の各行から構造タグを除去・前後空行をトリムした本文行群）を追加し、`details-block` ウィジェットの `attrs.body` に JSON で渡す。Webview 側は `<details>` 内に各本文行を `.cm-lp-details-body-line` として最小限のインライン記法（太字・斜体・コード、`appendInlineCell`）で描画する。`eq()` に body 比較を追加。CSS に本文行の余白・色（テーマ変数）を追加。
- **クリック位置と編集位置のずれを修正（R-28-10 追加）。** `TableWidget`・`DetailsWidget` は `block: true` なのに `estimatedHeight` 未指定で、CodeMirror のブロック高さ会計が実描画とズレ、ウィジェットより下の行の `posAtCoords` がずれていた（特に折りたたみアコーディオンで顕著）。両ウィジェットに `get estimatedHeight()`（1 行≈22px 前提の概算）を実装。`DetailsWidget` は `toDOM(view)` で `view` を受け取り、`toggle` で開閉により高さが変わるため `view.requestMeasure()` を呼んで再測定させる。
- **テーブルのセル内テキストを編集可能にした（R-22-02 再定義 / R-22-01 改訂）。** これまでテーブルは常にウィジェット化＋クリック握りつぶしで完全非編集だった。`computeDecorations` の table 分岐に `blockHasCursor` を追加し、**カーソルがブロック内のときはウィジェットを出さず生の行 `| a | b |` を表示**してセル編集を可能にした（非カーソル時のみ従来どおりウィジェット）。ウィジェット `attrs` に `startLine` を追加、Webview が各 `<tr>` に `data-line`（ヘッダ=start／区切り行スキップ／rows=start+2+k）を付与。テーブルのクリックは握りつぶしから「クリックした `<tr>` の `data-line` 行頭へキャレット移動」へ変更し、再描画で編集モードへ遷移させる。行マッピングは純粋関数 `tableRowSourceLine` に切り出してテスト。
- ユニットテストを新挙動へ更新（`test/feature.markdown.test.ts`・`test/phase2.syntax.test.ts`）: `detectDetailsBlocks` の `body` 抽出、table のカーソル内ウィジェット抑制、`tableRowSourceLine` のマッピングを検証。

## v1.12.0 — 表・アコーディオンのビューア専用化／チェックボックス・リンク・余白・ビュー切り替えの修正 (2026-06-22)

### 変更

- **表・`<details>` アコーディオンをビューア専用化（R-22-02 / R-27-03 再定義、R-27-05 / R-28-09 改訂）。** これまでブロック内にカーソルがあると生の Markdown／HTML 記法を表示して編集モードに入っていたが、カーソル位置に依らず**常に** `table-block` / `details-block` ウィジェットのまま（実質非編集）にした。ブロックの編集は標準ソースエディタで行う。`src/core/model.ts` から active/raw 分岐を撤去。Webview 側（`src/webview/main.ts`）はウィジェット本体のクリックを capture フェーズで握りつぶし（`preventDefault`/`stopImmediatePropagation`）、CodeMirror 既定の mousedown によるキャレット移動を防ぐ（`<summary>` クリックはネイティブ開閉に通す）。ユニットテストを新挙動へ改訂。
- **アコーディオン開閉状態の保持（R-27-02）。** `DetailsWidget`（`src/webview/decorations.ts`）に summary テキストをキーとする `openDetails` 集合を追加し、`toggle` で記憶・`toDOM` で復元することで、再描画後も開閉状態を維持するようにした（同一サマリのアコーディオンは状態を共有する制限あり）。
- **チェックボックス ON/OFF がトグルできない問題を修正（R-08-07）。** ホスト起点のトグル（`toggleTask`）で、`applyEditFromWebview` が `webviewText` を先行更新するため `onDidChangeTextDocument` のエコー抑制で `update` が Webview へ送られず CodeMirror が更新されなかった。`toggleTask` 処理で `applyEditFromWebview` の後に明示的に `postMessage({ type: 'update', text })` を送るようにした（`update` ハンドラはテキスト一致時 no-op のため通常編集には無害）。
- **相対パスリンクの山括弧宛先を修正（R-21-03）。** `[ラベル](<相対パス>)`（CommonMark の山括弧宛先、パスにスペースを含み得る）で `openLink` が `< >` を取り込んだまま解決し not-found になっていた。`openLink`（`src/livePreviewEditorProvider.ts`）で外側 1 組の山括弧のみを除去（`/^<([\s\S]*)>$/`）してから解決するようにした。スペースは保持（全角スラッシュ `／` は実フォルダ名の一部として不変）。
- **本文余白を調整（R-28-07、CSS のみ）。** `.cm-content` の padding を `32px 64px 40px 72px → 20px 40px 24px 48px` に戻した（`!important` は維持）。
- **ビュー切り替えの保存確認回避を堅牢化（R-03-05）。** `switchEditor`（`src/livePreviewEditorProvider.ts`）で、`vscode.openWith` の**後**に旧ビュー種別の重複タブを再評価し、現在のアクティブ（新規）タブと別物のときだけ閉じるようにした（アクティブ／dirty な入力を閉じないことで保存確認を回避）。`supportsMultipleEditorsPerDocument` は同期リスクを避けるため `false` を維持。VS Code の API 制約上、本挙動は手動 UI 検証を前提とする。

## v1.11.0 — `<details>` 編集中の構造タグ非表示・サマリ体裁を MAIO に寄せる (2026-06-22)

### 変更

- **編集中（カーソルが内側にある）`<details>` ブロックで構造 HTML タグを常に隠す（R-27-05 / R-28-09 更新）。** これまで `<details><summary>…</summary>` や `</details>` の生タグがそのまま表示されていた問題を修正。カーソル有無に関わらず、構造タグの山括弧部分（`<details …>`・`<summary …>`・`</summary>`・`</details>`）を `hide` 装飾で常に隠し、生のタグ文字列がユーザーに見えないようにした。`<summary>` と `</summary>` の間のサマリ本文は可視・編集可能な生テキストとして残し、インライン記法も描画する。判定は純粋関数 `detailsTagRanges`（`src/core/model.ts`）が各行のタグ範囲を返し、Webview が `Decoration.replace` にマップ（装飾は表示のみ・入力文字列不変、ユニットテスト追加）。
- **サマリ体裁を MAIO に寄せる（R-27-04 / R-28-06 更新、CSS のみ）。** サマリテキストを通常ウェイト（`font-weight: 400`、太字継承を防止）にし、マーカー `▶`/`▼` とサマリテキストの間に半角程度の余白（`margin-right: 0.4em`）を設けた（`▶WBS…` → `▶ WBS…`）。
- **Webview での左右余白が意図より狭かった問題を修正（CSS のみ）。** `.cm-content` の padding を `20px 40px 24px 48px → 32px 64px 40px 72px` に拡大。Webview 表示での実測値が意図したマージンより視覚的に狭く見えていたため、v1.10.0 で設定した値を全方向で拡大した。
- **`.cm-content` の padding に `!important` を追加（CSS のみ）。** CodeMirror が inline style で padding を上書きするため、意図した余白が反映されていなかった問題を修正。`!important` を付与することで CSS ルールが確実に適用されるようにした。

## v1.10.0 — ビューア体裁を「Markdown All in One」プレビューに寄せる磨き込み（左余白・details・タスク色） (2026-06-22)

### 変更

- **左右の読み余白を拡大（R-28-07）。** `.cm-content` のパディングを `16px 28px 16px 32px → 20px 40px 24px 48px` に拡大し、MAIO プレビューの広めの余白に寄せた。見出しは行装飾のためインデントが増えず、見出しと本文の左端が揃う。本文フォントは Markdown サンセリフスタックを明示指定し `font-weight: 400` を付与（等幅へのフォールバック防止）。
- **タスク行内のインラインリンクを本文色・下線なしへ（R-28-08）。** `- [ ] [ラベル](URL)` 形式のタスクで、リンク（`.cm-lp-task .cm-lp-link`）が青＋下線になる問題を修正。タスク行内のリンクは hover 含め本文色・下線なしで描画し、チェックリストが本文テキストとして読めるようにした。
- **アクティブな `<details>` でも本文インライン記法を描画（R-28-09）。** カーソルが内側にある（編集中）`<details>` ブロックでも本文行の太字・斜体・インラインコードを装飾し、`**ワークパッケージ**` の生マーカーが残らないようにした（構造 HTML タグ行は対象外。カーソル行は生記法を保つ）。`<summary>` ウィジェットのサマリも `appendInlineCell` で最小限のインライン記法を描画。`src/core/model.ts` の変更にはユニットテストを追加（入力文字列不変を担保）。

## v1.9.0 — ビューア体裁を「Markdown All in One」プレビューに寄せる磨き込み (2026-06-22)

### 変更

- **タスクリストの本文をリンク色・下線から本文色へ（R-08-06）。** タスク行（`.cm-lp-task`）がリンク色・下線を継承しないようガードし、本文を `var(--vscode-editor-foreground)` で表示。チェックボックスとテキストの間の余白を `6px → 8px` に拡大して MAIO のチェックリスト体裁に合わせた。本文中の実リンクは従来どおりリンク装飾を保持する。
- **表セルのインライン記法を描画（R-22-03）。** 表セル内の太字 `**`/`__`・斜体 `*`/`_`・インラインコード `` ` `` を装飾描画し、`**CPM**` のような生マーカーを表示しないようにした（Webview 層 `appendInlineCell` でテキストノードへ安全変換。生 HTML は挿入しない）。
- **`<details>` アコーディオン・コードブロック・引用の体裁を MAIO に寄せる磨き込み（R-28-06）。** アコーディオンのマーカー（`▶`/`▼`）を小さめ・控えめに、ブロックコードに淡いボーダー、引用に淡い背景バンドを追加。すべて `--vscode-*` テーマ変数のままでテーマ追従を維持し、装飾ロジック（`src/core`）は不変。

## v1.8.0 — ビューア体裁を標準 Markdown プレビュー風に・ビュー切り替えの重複タブ修正・リンク別タブ表示 (2026-06-22)

### 変更

- **Live ビューアの体裁を GitHub / VS Code 標準 Markdown プレビュー風に調整（R-28-05）。** 本文フォントを UI/サンセリフ（`--vscode-markdown-font-family`）に、行間を `1.6` に。見出しを GitHub 風サイズ（h1=2em / h2=1.5em …）にし h1/h2 に下境界線を追加。インラインコードを小ピル風、コードブロックを全幅背景＋余白拡大、引用・表（ゼブラ縞）・水平線も標準プレビュー風に。色は全て `--vscode-*` テーマ変数のままでテーマ追従を維持。装飾ロジック（`src/core`）は不変。
- **リンククリックは現在の Live ビューを維持しつつ別タブで開く（R-02-03）。** `.md` は Live ビューア・その他は標準エディタを、いずれも `preview: false` の永続タブで開く（ephemeral プレビュータブで既存タブを上書きしない）。外部リンクは従来どおりブラウザで開く。

### 修正

- **ビュー切り替えで別タブ（重複タブ）が開く不具合を修正（R-03-05）。** `vscode.openWith` がカスタムエディタ↔標準エディタ間で既存タブを置換せず新タブを追加する問題に対し、`window.tabGroups` で旧ビュー種別のタブを特定して切り替え後に閉じる方式に変更。新エディタが同じ `TextDocument` を参照し続けるため、未保存（dirty）状態でも保存確認ダイアログは出ない。

## v1.7.1 — Live エディタの体裁軽量化・キャレット/チェックボックスのバグ修正 (2026-06-22)

### 変更

- **`<details>` アコーディオンの体裁を軽量化（R-27-04）。** サマリ行の全幅背景バー・枠・余計な padding を除去し、`▶`（閉）/`▼`（開）の三角マーカー＋テキストのみの 1 行表示に。マーカーは開閉状態に追従する。
- **見出し色を VS Code 標準テーマへ追従（R-28-04）。** 独自のハードコード見出し色（`symbolIcon-functionForeground`）をやめ、`var(--vscode-editor-foreground)` に追従。サイズ・太字は維持。

### 修正

- **キャレットが視認できない不具合を修正（R-28-02）。** `drawSelection()` を有効化し、`.cm-cursor` の `border-left-color` を `var(--vscode-editorCursor-foreground)`（フォールバック付き）で確実に描画。
- **タスクチェックボックスがクリックでトグルされない不具合を修正（R-28-03）。** クリック処理を capture フェーズに移し、`stopImmediatePropagation` で CodeMirror の mousedown より先に処理することで、キャレット移動による再描画でトグルが無効化される問題を解消。

## v1.7.0 — ビュー切り替えの同一タブ再描画化・details アコーディオン折りたたみ・Live体裁追従 (2026-06-22)

### 変更

- **ビュー切り替えを同一タブ内の再描画方式に変更（R-03）。** 従来の open/close を経由する切り替えを廃止し、同一タブ内で再描画する方式に変更。エディタの open/close を経由しないため、ビュー切り替え時に保存確認ダイアログが出なくなった。
- **折りたたみ対象を見出しから HTML `<details><summary>` アコーディオンへ再定義（R-27）。** デフォルトで折りたたみ表示し、summary クリックで開閉する。従来の見出し折りたたみ（fold gutter）は廃止。
- **Live エディターの体裁を VS Code 標準テーマへ追従（R-28）。** 左余白を拡大し、文字色を VS Code 標準エディタのテーマ色へ追従させた。

## v1.6.0 — ビュー切り替え方式の刷新・ブロック折りたたみ・Live体裁修正 / 開発凍結 (2026-06-21)

### 変更

- **ビュー切り替えを Markdown All in One 風のエディタ切り替え方式に刷新（R-03 再定義）。** 従来の「同一 CodeMirror 上で装飾を ON/OFF する独自ソースビュー」を廃止。`.md` は既定で VS Code 標準テキストエディタ（ソース）で開き、標準エディタのタイトルバーの目アイコン（`livePreview.openWith`）で Live エディターへ、Live エディターの code アイコン（`livePreview.toggleSource`）で標準エディタへ戻す。いずれも **Tabs API で旧エディタを畳んで同一タブで置き換える**（新規タブを積まない）。
- Live エディター表示中にリンク先 `.md` を開くと、Live エディター状態の別タブで開く（従来挙動を維持）。リンクのパス解決を堅牢化（`#`/`?` 除去・`\` 正規化・パーセントデコード）。
- レンダリング失敗時のフォールバックを、webview 内生表示ではなく VS Code 標準エディタへの切り替えに変更。

### 追加

- **見出しブロックの折りたたみ（R-27）。** `@codemirror/language` の `foldService`/`codeFolding`/`foldGutter` で、見出し配下を次の同レベル以上の見出しまで折りたたむ。左ガターの `▸`/`▾` で開閉する。初期状態は展開（折りたたまない）。

### 削除（クリーンアップ）

- **旧プラグイン内ソースビューの残骸を撤去。** ソース表示を VS Code 標準エディタに委ねたため不要になった `livePreview.decorationsEnabled` 設定と、その装飾 OFF（生表示）経路を全削除（host 配線・webview の `previewOn`/`setPreview`/Compartment・core の `decorationsEnabled` オプションと `LivePreviewSettings.decorationsEnabled`・対応テスト）。Live エディターは常に装飾表示する。併せて未使用の `emptyDecorations` export・到達不能な `setPreview`/`previewState` メッセージ分岐・エントリポイントの不要 export を削除。

### 修正

- **チェックボックスのトグルが効かないことがある不具合（R-28-03）。** ウィジェットを `<input>` から `span`（`role=checkbox`）に変更し、`mousedown` を `preventDefault`/`stopPropagation` してフォーカス・選択移動の副作用を排除。
- **編集時にキャレットが表示されない不具合（R-28-02）。** `drawSelection` のカーソル要素（`.cm-cursor`）を VS Code のカーソル色で描画する CSS を追加。
- **本文左側に余白を追加（R-28-01）。** 折りたたみガター＋コンテンツのパディングで左余白を確保。

## v1.5.3 — 真っ白の根本原因（ブロック装飾）を修正 (2026-06-21)

### 修正（重大）

- **Webview が `RangeError: Block decorations may not be specified via plugins` で描画されず真っ白になる不具合を修正。** 表の HTML レンダリング（`block: true` のテーブルウィジェット）を ViewPlugin 経由で提供していたが、CodeMirror はブロック装飾を ViewPlugin から渡すことを禁止している。装飾の提供を **ViewPlugin → StateField**（`EditorView.decorations.from`）方式に変更し、ブロック装飾を許可される経路へ移した。
- 副作用としてビューポート限定の装飾計算（大ファイル最適化）は一旦撤去（StateField はビューポート非依存）。純粋関数 `computeDecorations` 側の `lineRange` 機能は維持。

## v1.5.2 — 真っ白になる重大バグ修正 (2026-06-21)

### 修正（重大）

- **Webview が完全に空白になる不具合を修正。** v1.4.0 で画像表示のため `localResourceRoots` を明示設定した際、既定値（拡張機能の install ディレクトリを含む）が上書きされ、Webview の `dist/webview.js`・`media/editor.css` がブロックされてスクリプトがロードされず真っ白になっていた。許可リストに `context.extensionUri` を追加して修正（v1.4.0〜v1.5.1 が影響）。

## v1.5.1 — リンク先 .md をビューアで開く (2026-06-21)

### 修正

- 標準リンク `[text](file.md)` のクリックで、リンク先が `.md` の場合は本 Live Preview ビューア（`vscode.openWith`）で開くように修正（R-26-02）。従来は `vscode.open` のため既定のテキストエディタで開いていた。`.md` 以外は従来どおり既定エディタで開く。

## v1.5.0 — スコープ縮小（素の Markdown へ） (2026-06-21)

過剰機能・品質リスクの棚卸しに基づき、Obsidian 独自機能とホスト側のワークスペース I/O を削除。**素の Markdown（CommonMark + GFM）の編集・プレビュー**に専念する構成へ単純化（Markdown 編集・プレビュースコアは 98 点を維持）。

### 削除（品質リスク低減）

- **ホスト側ワークスペース I/O**（保守リスク・スケール懸念・テスト不可だった経路）
  - バックリンク（`showBacklinks`：全 `.md` を毎回読み込み）
  - Wikilink 補完＋ノート一覧スキャン（`sendNoteList`：エディタを開くたびに全 `.md` 走査）
  - 画像ペースト保存（`attachments/` への自動書き込み・フォルダ生成）
- **Obsidian 独自記法（装飾）**
  - Wikilink `[[..]]`・埋め込み `![[..]]`・コールアウト `> [!note]`・タグ `#tag`・脚注 `[^id]`・カスタムタスク状態 `[/]`/`[-]` 等
- 関連: `src/core/links.ts` 削除、`@codemirror/autocomplete` 依存削除、`livePreview.showBacklinks`・`livePreview.format.wikilink` コマンド削除、`togglePair` 削除、未使用 CSS 削除
- 削除した要件番号: R-07, R-10〜R-15, R-17, R-18（USDM 上は欠番として履歴を明示）

### 維持（素の Markdown コア）

- 見出し・段落・リスト・順序リスト・**GFM タスク `[ ]`/`[x]`**・引用・コードブロック・水平線・**表（HTML 描画）**
- 太字・斜体・取消線・ハイライト・インラインコード・リンク・画像・オートリンク・エスケープ
- カーソル連動の生記法表示、ソース切替、最小差分 Undo、IME、CRLF、ビューポート性能、設定
- フォーマットショートカット（Ctrl+B/I/Shift+X/Shift+H/E）、リスト継続入力、Tab インデント、見出しトグル
- 画像の実描画、標準リンク/オートリンクのクリック遷移

### テスト

- 削除機能のテスト（wikilink/embed/links）を撤去、richtext は取消線・ハイライトのみに整理、robustness の混在テストを素の Markdown へ更新
- 全 **121 ケース**通過（リグレッションなし）

### バージョン

- 要件削除（スコープ変更）に伴いマイナーアップ：1.4.0 → 1.5.0

## v1.4.0 — Markdown 編集・プレビュー 95 点超え (2026-06-21)

「Markdown 記法の編集とプレビュー」のみを 100 点とした採点軸（[docs/markdown-editing-score.md](../docs/markdown-editing-score.md)）に切り替え、Obsidian 独自機能を採点外に。実装前 **73 点** → **98 点**（目標 95 点達成）。

### 記法の網羅

- **水平線**（R-19）`---` / `***` / `___`
- **バックスラッシュエスケープ**（R-20）`\*` 等は記法を発火させない
- **オートリンク**（R-21）`<https://…>` / `<a@b.com>`
- **表の HTML レンダリング**（R-22）— 非カーソル時は実際の `<table>` を描画、表内カーソルで生の行に戻して編集（`detectTableBlocks`/`parseTable`）

### 編集体験

- **リスト継続入力**（R-23）— Enter で次のビュレット/番号/タスクを継続、空項目で終了（`continueList`）
- **インデント**（R-24）— Tab/Shift+Tab でリストの階層調整（`changeIndent`）
- **見出しトグル**（R-25）— `Mod+Alt+1〜6` で見出しレベル切替（`toggleHeading`）

### 実挙動

- **画像の実描画**（R-26-01）— `localResourceRoots`＋`asWebviewUri` の `resourceBase` で相対パス画像を解決・表示（従来は表示されない可能性があった）
- **リンクのクリック遷移**（R-26-02）— 標準リンク/オートリンクをクリックで外部ブラウザ／ワークスペースのファイルへ

### テスト

- `feature.markdown.test.ts`（17）・`feature.editing.test.ts`（13）を追加
- 全 **164 ケース**通過（既存 134 ＋ 新規 30、リグレッションなし）
- 表のレンダリング方式変更に伴い Phase 2 の表テストを `table-block` 方式へ更新

### バージョン

- 要件追加（R-19〜R-26）に伴いマイナーアップ：1.3.0 → 1.4.0

## v1.3.0 — Obsidian パリティ 80 点超え (2026-06-21)

Obsidian との要件比較を重み付き 100 点で採点（[docs/obsidian-parity-score.md](../docs/obsidian-parity-score.md)）。実装前 **74 点** → 不足を実装し **81 点**（目標 80 点達成）。

### 追加機能

- **フォーマットコマンド/ショートカット**（R-16）— 選択範囲の装飾トグル。`toggleWrap`/`togglePair` 純粋関数＋キーマップ＋ VS Code コマンド（`livePreview.format.*`）。Ctrl+B（太字）/ Ctrl+I（斜体）/ Ctrl+Shift+X（取消線）/ Ctrl+Shift+H（ハイライト）/ Ctrl+E（コード）/ Ctrl+L（Wikilink）。
- **埋め込み `![[..]]`**（R-17）— 画像埋め込みは画像ウィジェット、ノート埋め込みはクリック可能なチップ。別名対応。
- **カスタムタスク状態**（R-18）— `[/]`（進行中）/`[-]`（取り消し）/`[>]`（転送）/`[?]` 等を状態付きで表示。未知文字はタスク扱いしない。
- **埋め込み補完**（R-14-04）— `![[` でもノート候補補完が起動。

### テスト

- `feature.format.test.ts`（9）・`feature.embed.test.ts`（19）を追加、補完テスト1件追加
- 全 **133 ケース**通過（既存 113 ＋ 新規 20、リグレッションなし）

### バージョン

- 要件追加（R-16〜R-18）に伴いマイナーアップ：1.2.1 → 1.3.0

## v1.2.1 — テスト拡充とバグ修正 (2026-06-21)

網羅的なエッジケース・組み合わせテストを追加し、その過程で判明した実バグを修正（コード修正のみ＝パッチ）。

### バグ修正

- **アンダースコア語中強調**（R-01-06）— `my_var_name` の `_var_` が斜体になっていた問題を修正。`_`/`__` は ASCII 単語文字に挟まれた場合は強調しない（CommonMark 準拠）。`*` は従来どおり語中可。
- **CRLF の記法検知**（R-05-06）— `splitLines` が行末 CR を含めていたため、`# 見出し`・リスト・引用など `^...$` ベースの記法が CRLF 文書で検知されなかった問題を修正。
- **CRLF の同期・タスクトグル**（R-05-06）— Webview（LF）と文書（Windows では CRLF）の混在により、最初の編集で全文が LF に書き換わる／`toggleTaskAt` が CRLF 行で失敗する問題を修正。`toLF`/`fromLF` で境界変換し、ファイルの EOL を保持して最小差分のみ適用。

### テスト

- `robustness.combinations.test.ts`（18）を追加：記法の組み合わせ、ブロック内インライン、語中アンダースコア、CRLF、マルチバイト、コールアウト変種、境界・退化ケース、および**構造不変条件**（オフセット境界・行装飾のゼロ幅・replace 装飾の非重複）
- `feature.task.test.ts` に CRLF トグルと EOL ヘルパーのテストを追加
- 全 **113 ケース**通過（既存 92 ＋ 新規 21）

## v1.2.0 — Obsidian 比較の残機能を一括対応 (2026-06-21)

[docs/obsidian-comparison.md](../docs/obsidian-comparison.md) の重要度「中」全項目＋「低」のタグを実装。大規模基盤を要する 3 件（グラフビュー・AI/Smart Composer 相当・プラグイン機構）のみスコープ外として明確化。

### 追加記法（装飾系・純粋ロジック＋テスト）

- **取り消し線 `~~text~~`・ハイライト `==text==`**（R-09）
- **タグ `#tag`**（R-10）— 単語境界判定、見出し `#`・語中 `#` は除外
- **脚注 `[^id]` / 定義行 `[^id]:`**（R-11）— 参照は上付き表示
- **コールアウト `> [!type] タイトル`**（R-12）— 型別の左罫色（note/tip/warning/danger ほか）

### 追加機能（リンク・添付）

- **バックリンク一覧**（R-13）— コマンド `livePreview.showBacklinks`。`findBacklinks` がワークスペースを走査し参照数つきで QuickPick 表示
- **Wikilink 入力補完**（R-14）— `[[` 入力でワークスペースのノート名を `@codemirror/autocomplete` で提示（前方一致優先）
- **画像の貼り付け**（R-15）— クリップボード画像を `attachments/` に保存し `![](...)` を挿入

### テスト

- `feature.richtext.test.ts`（12）・`feature.links.test.ts`（11）を追加
- 全 **92 ケース**通過（既存 69 ＋ 新規 23、リグレッションなし）

### 依存・バージョン

- `@codemirror/autocomplete` を追加
- 要件追加（R-09〜R-15）に伴いマイナーアップ：1.1.0 → 1.2.0

## v1.1.0 — Obsidian 互換機能の追加 (2026-06-21)

Obsidian（Smart Composer 含む）との機能比較に基づき、重要度「高」と判定したリンク機能・編集体験を追加。比較レポートは [docs/obsidian-comparison.md](../docs/obsidian-comparison.md)。

### 追加機能

- **Wikilink `[[ノート]]` / `[[ノート|別名]]`**（R-07）— 非カーソル行で `[[ ]]` を隠して表示名のみをリンク表示。Webview 上のクリックで対象 `.md` をワークスペースから解決して開く。コードブロック内・インラインコード内は装飾しない。
- **タスクチェックボックス `- [ ]` / `- [x]`**（R-08）— マーカー部をチェックボックスへ置換、完了タスクは取り消し線。クリックで `[ ]`⇄`[x]` をトグルし TextDocument に反映（純粋関数 `toggleTaskAt`）。ネストタスク・大文字 `[X]` 対応。

### ドキュメント・規約整備

- `_agent-templates` 規約に準拠する構成を新設：`CLAUDE.md`、`docs/requirements.md`、`docs/requirements-usdm.md`（USDM・正）、`docs/architecture.md`、`docs/acceptance-tests.md`、`.claude/agents/`（正本から同期）。`sync-agents.ps1` の配布対象に本 repo を追加。

### テスト

- Wikilink 5 ケース（R-07-01〜04＋標準リンク非誤認）、タスク 8 ケース（R-08-01〜05）を追加
- 全 69 ケース通過（既存 56 ＋ 新規 13、リグレッションなし）

### バージョニング

- 要件追加（R-07・R-08）に伴いマイナーアップ：1.0.0 → 1.1.0

## v1.0.0 — 正式版 (2026-06-21)

エッジケース対応・設定項目・Marketplace メタ情報を整備し、正式版として仕上げ。

### エッジケース対応

- ネストしたリスト（インデントレベルを保持）、リスト内コードブロック
- コードブロック内 Markdown の誤装飾防止を網羅（`#` / `**` / `*` / `` ` `` / `>`）、未終了フェンスの安全な扱い
- IME 入力中（日本語変換中）は同期を遅延し装飾ちらつきを防止（`shouldEmitEdit`）
- 大きいファイル（数千行）は装飾範囲をビューポート内に限定（`viewportWindow`）
- Webview レンダリング失敗時はソース表示へ自動フォールバック（`computeDecorationsSafe`）

### 機能・品質

- Undo/Redo を VS Code 標準同等に：Webview の編集を最小差分（`diffRange`）で適用し履歴粒度を維持
- 設定項目を追加：`livePreview.decorationsEnabled`（装飾 ON/OFF）、`livePreview.fontSize`。`onDidChangeConfiguration` で即時反映
- `package.json` のメタ情報整備（icon, galleryBanner, repository, categories, keywords）で Marketplace 公開可能な状態に

### テスト・カバレッジ

- ネストリスト／コードブロック誤装飾防止／未終了フェンス／IME／Undo round-trip／設定クランプ／大ファイルのパフォーマンス（処理時間上限）テストを追加
- 全 56 ケースが通過（フェーズ1・2 を含むリグレッションなし）
- コアロジックのカバレッジ：Stmts 99.69% / Branch 96.89% / Funcs 100%

### 既知の制約

- 表は HTML テーブルへの完全レンダリング未対応（行／区切り行検知とセル装飾のみ）
- リンク・画像 URL のバリデーションは最小限

## v0.2.0 — ブラッシュアップ (2026-06-21)

対応記法を大幅に拡張し、ソース／プレビュー切り替えと外部変更の再同期を追加。

### 追加記法

- 斜体（`*text*`）、インラインコード（`` `code` ``）、引用（`> quote`）
- リンク（`[text](url)`、href を保持）、画像（`![alt](url)` をウィジェット表示）
- フェンスコードブロック（```` ``` ````）— ブロック内の Markdown は装飾しない
- 表（ヘッダ＋区切り行の検知、区切り行を非表示、セルのインライン装飾）

### 機能

- ソース／プレビュー切り替えコマンド `livePreview.toggleSource`（エディタタイトルの目アイコン）。同一 CodeMirror インスタンス上で装飾を ON/OFF（別エディタへの切り替えではない）
- 外部ファイル変更（Git pull・他エディタ編集）を `onDidChangeTextDocument` で検知し、自身の編集エコーと区別して Webview を再同期（`shouldResync`）
- Webview からの編集を最小差分（`diffRange`）で `WorkspaceEdit` に適用し、VS Code の Undo 粒度を維持

### テスト

- 追加記法それぞれの正常系テスト、コードブロック内の誤装飾防止テストを追加
- ソース切り替え時に元テキストが不変であることのテスト
- 外部変更検知・最小差分・選択範囲→カーソル行変換のモック／単体テスト
- フェーズ1のテストを含む全 39 ケースが通過（リグレッションなし）

### 既知の制約

- 表は HTML テーブルへの完全レンダリング未対応（行／区切り行検知とセル装飾のみ）
- ネストリスト・IME ちらつき防止・大ファイル最適化・Undo/Redo の完全同等化・設定項目拡充は v1.0.0 で対応予定

## v0.1.0 — プロトタイプ (2026-06-21)

最初のプロトタイプ。Obsidian ライクな Markdown ライブプレビュー編集の土台を構築。

### 追加

- `CustomTextEditorProvider`（viewType: `livePreview.markdown`）を `*.md` に対し `option` priority で登録
- CodeMirror 6 を Webview に埋め込み、Extension Host と `postMessage` でテキスト同期
- 装飾判定を CodeMirror から分離した純粋関数 `computeDecorations`（`src/core/model.ts`）として実装
- 対応記法: **太字**（`**text**`）、見出し（`#`〜`######`）、リスト（`-` / `1.`）
- カーソル行は生記法を表示、その他の行は装飾表示
- Vitest によるユニットテスト（14 ケース、太字／見出し／リスト／カーソル行判定）

### 既知の制約

- 表・コードブロック・画像・リンク・引用・斜体・インラインコードは未対応（v0.2.0 予定）
- ソース／プレビュー切り替えコマンドは未実装（v0.2.0 予定）
- 外部ファイル変更の再同期、Undo/Redo の VS Code 標準同等化、大きいファイルのパフォーマンス最適化は将来フェーズ（v0.2.0 / v1.0.0）で対応
