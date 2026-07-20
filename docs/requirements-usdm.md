# Live Preview Editor VS Code拡張機能 要求仕様書（USDM形式）

**文書番号**: LPE-REQ-001-USDM  
**バージョン**: 1.37.8
**作成日**: 2026-06-21  
**最終更新**: 2026-07-20
**ステータス**: 承認済み  
**関連文書**: [architecture.md](architecture.md) | [acceptance-tests.md](acceptance-tests.md) | [requirements.md](requirements.md)

> ▶️ **開発継続中（2026-07-20 時点 / v1.37.8）**: v1.37.8 で、見出し折りたたみシェブロンの縦位置調整を、見出しレベルごとの独立した固定 `translateY`（見出し 1〜3 のみに追加適用、値はパディングとの算出根拠を共有しない手調整）から、見出し行の縦パディング比率 `--lp-hN-pt`/`--lp-hN-pb`/`--lp-hN-size` とガター倍率 `--lp-fold-gutter-size` を単一の真実源とし `(padding-top − padding-bottom) / 2` を `calc()` で導出する方式へ全面的に置き換えた（R-30-04）。見出し 1〜6 の全レベルにガター要素クラス `cm-lp-fold-h1`〜`cm-lp-fold-h6` を付与するよう `headingGutterMarks`（`src/webview/main.ts`）を拡張し、見出し 4〜6 も含めて字面中央に揃うようにした。見出しの font-size・padding-top・padding-bottom の見た目の値自体は変更していない（既存の `.cm-lp-hN` の描画結果は同一）。純粋関数 `scanHeadings`/`headingFoldRange` のロジックは変更していない。`npm run check-types` と `npx vitest run` で既存の fold 関連テストの回帰が無いことを確認した。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。
>
> ▶️ **開発継続中（2026-07-20 時点 / v1.37.7）**: v1.37.7 で、箇条書きの基本アイコンサイズ（`.cm-lp-list-bullet` の `font-size`）を `1.4em` から `1.6em` へさらに拡大した（2 段目の ○＝`.cm-lp-list-bullet-hollow` の `0.62em` は不変、R-01-05）。`test/feature.issue16.decorations.test.ts` の CSS 値アサーションを更新して検証。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。
>
> ▶️ **開発継続中（2026-07-20 時点 / v1.37.6）**: v1.37.6 で、折りたたみプレースホルダー（`.cm-foldPlaceholder`）の背景色が CodeMirror 既定テーマの `#eee`（詳細度 0,2,0）に上書きされ、editor.css 側で意図した地色寄りの `color-mix` 配色（R-30-04）が実際には適用されていなかった不具合を修正した。セレクタを `.cm-foldPlaceholder` から `.cm-editor .cm-foldPlaceholder` へ変更し、詳細度を 0,2,0 以上へ引き上げることで CodeMirror 既定テーマより優先されるようにした。`background`／`border`／`border-radius`／`padding`／`margin` の値自体は変更していない。`test/feature.issue30.foldPlaceholderTheme.test.ts` を新設して検証した。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。
>
> ▶️ **開発継続中（2026-07-20 時点 / v1.37.5）**: v1.37.5 で、3 点の微調整と不具合修正を行った。(1) 箇条書きの基本アイコンサイズ（`.cm-lp-list-bullet` の `font-size`）を `1.2em` から `1.4em` へさらに拡大した（2 段目の ○＝`.cm-lp-list-bullet-hollow` の `0.62em` は不変、R-01-05）。(2) 見出し 1 の折りたたみシェブロンの下方向ナッジを `translateY(0.55em)` から `translateY(0.7em)` へさらに下げた（見出し 2・3 の `0.42em`／`0.28em` は不変、R-30-04）。(3) ネスト引用（`>>` 等）の継続行が、`>` の再掲が無い、または再掲があっても直前の引用行より浅い深度の場合に階層インデント・背景バンドを失う不具合を修正した。`src/core/model.ts` に直前の引用行の深度を保持する状態（`lastQuoteLevel`）を追加し、空行を挟まない非空の継続行は直前の深度を継承した `cm-lp-quote-l{1〜6}` を付与するようにした（CommonMark の lazy continuation 準拠）。空行、または引用以外のブロック開始（見出し・水平線・フェンスコード・表・アコーディオン・数式ブロック・GitHub Alerts）で継続はリセットされる（R-02-05）。純粋関数の spec 変更は `test/feature.issue16.decorations.test.ts` の追加テストで検証。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。
>
> ▶️ **開発継続中（2026-07-19 時点 / v1.37.4）**: v1.37.4 で、箇条書き・番号付きリストのネスト階層マーカーの見直しと、見出し折りたたみアイコンの縦位置調整を行った。(1) 箇条書きのビュレットは 2 段目（`○`）以外は 3 段目以降もすべて `▪` へ統一し、周期的な繰り返し（3 段周期）を廃止した（`ULIST_BULLETS` のインデックスを段数クランプへ変更、R-01-05）。あわせて `.cm-lp-list-bullet` の `font-size` を `1.0em` から `1.2em` へ拡大した（○ の `0.62em` は不変）。(2) 番号付きリストの numeral は 1 段目（ローマ数字小文字）以外、2 段目以降はすべてアルファベット小文字へ統一し、周期的な繰り返しを廃止した（R-01-07）。(3) 見出し折りたたみシェブロンの下方向ナッジを見出し 1 のみ `translateY(0.42em)` から `translateY(0.55em)` へ変更し、見出し 2・3 は現行値（`0.42em`／`0.28em`）を維持した（R-30-04）。純粋関数（`src/core/model.ts`）の spec 変更は `test/feature.issue16.decorations.test.ts` で検証。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。
>
> ▶️ **開発継続中（2026-07-20 時点 / v1.37.3）**: v1.37.3 で、GitHub Issue #28 により、Live Preview ビューア内の重複した未保存インジケータと host↔Webview の `dirty` メッセージ経路を削除した。未保存状態は Custom Text Editor タブの VS Code 標準 dirty マークのみで表示する（R-03-08）。保存・同期・Undo/Redo の既存経路および `customEditors` の `livePreview.editor` 登録は維持し、ユーザーの Markdown 本文は引き続き書き換えない（R-03-12）。
>
> ▶️ **開発継続中（2026-07-19 時点 / v1.37.2）**: v1.37.2 で、GitHub Issue #26（#24 対応後の微調整）の 3 項目を CSS のみで実装した。(1) 箇条書きマーカーの階層間サイズバランスを再調整し、○（1 段目）の `font-size` を `0.72em` からさらに `0.62em` へ縮小する一方、•/▪ の `font-size` は `0.9em` から `1.0em` へ拡大した（R-01-05）、(2) 入れ子引用 `cm-lp-quote-l1〜l6` の `padding-left` 末尾定数を `12px` から `16px` へ広げ、テキスト開始位置を全階層で右へずらした（縦バーの本数・位置・`background-image`/`-size`/`-position` は不変、R-02-05）、(3) 見出し 1・2 のガター要素のみ下方向ナッジを `translateY(0.28em)` から `translateY(0.42em)` へ増やし（見出し 3 は `0.28em` のまま）、fold placeholder の背景を `var(--vscode-editorWidget-background, ...)` から `color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-editor-foreground) 10%)` という地色に近い控えめな色へ変更した（枠 `border` による差別化は維持、R-30-04）。装飾ロジック・純粋関数（`src/core/model.ts`）の spec は不変で、`test/feature.issue21.decorations.test.ts` の既存アサーションを維持する。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。色はすべて `var(--vscode-*)`／`color-mix` によるテーマ変数追従を維持する（R-28-04）。
>
> ▶️ **開発継続中（2026-07-19 時点 / v1.37.1）**: v1.37.1 で、GitHub Issue #24（Issue #21 対応の修正不備・追加対応）の 4 項目を実装した。(1) インラインコード `.cm-lp-code` の背景を `color-mix` で地の文よりさらに濃くブレンドし、ライト/ダーク双方で明確に浮くよう強調（R-02-02／R-28-06）、(2) 箇条書きの ○（1 段目）グリフのみ他階層より小さい `font-size` を追加し、•/▪ のサイズは不変のまま視覚サイズを揃える（R-01-05／#3）、(3) 入れ子引用 `cm-lp-quote-l1〜l6` を、`margin-left` による単一 `border-left` から階層数ぶんの縦バーを `linear-gradient` の重ね掛けで描画する方式へ改め、n 段目の行に祖先階層分を含む n 本のボーダーが表示されるようにした（インデント量は現状維持、R-02-05）、(4) 見出し折りたたみシェブロンの縦位置を #21 対応前の中央揃え（`align-items: center`）＋基本ナッジ `translateY(0.15em)` へ巻き戻しつつ、#21 で拡大した `font-size: 1.5em` は維持し、見出し 1〜3 のガター要素のみ `gutterLineClass`（`src/webview/main.ts` に追加した見出しレベル別 `GutterMarker`）でわずかに大きい下方向ナッジ（`translateY(0.28em)`）を追加、見出し 4〜6 は基本ナッジのまま据え置いた（R-30-04）。純粋関数（`src/core/model.ts`）の spec は不変で、`test/feature.issue21.decorations.test.ts` の既存アサーションを維持する。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。色はすべて `var(--vscode-*)`／`color-mix` によるテーマ変数追従を維持する（R-28-04）。
>
> ▶️ **開発継続中（2026-07-19 時点 / v1.37.0）**: v1.37.0 で、標準 Markdown プレビュー相当の表示へ寄せる 8 項目（GitHub Issue #21）を実装した。(1) インラインコード `.cm-lp-code` の背景コントラスト強化・左右パディング拡大（R-02-02／R-28-06）、(2) Live Preview タブへ識別アイコン付与（`webviewPanel.iconPath`）と `editor/title` メニュー `livePreview.openWith` の `when` に `activeCustomEditorId != livePreview.editor` を追加して Live Preview アクティブ時のボタンを抑止（R-03-13 新設）、(3) 箇条書きマーカー `•/○/▪` のグリフ字幅差を CSS で吸収しサイズ統一（R-01-05／#3、形状差別化は維持）、(4)(5) コードフェンス開始行の情報文字列（例 `markdown`）を非カーソル行で hide し言語名を line spec 属性 `lang`＋CSS `data-lang` ラベルへ整理、コードブロック内容へ言語別構文ハイライトを適用（`syntaxHighlighting`＋`HighlightStyle`、`markdown({ codeLanguages })`、色は `--vscode-symbolIcon-*` 追従。R-02-06 改訂／R-34 新設）、(6) 入れ子引用 `cm-lp-quote-l1〜l6` を階層ごとの独立ボーダー＋背景＋左マージンへ改訂（R-02-05）、(7) GitHub Alerts `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` を純粋関数 `detectAlertBlocks` で検知し種別別アイコン・タイトル色・背景バンドで描画（生ラベル非表示。R-02-08 新設）、(8) 見出し折り畳みシェブロンの拡大と縦中心合わせ（R-30-04）。純粋関数（`src/core/model.ts`）の spec は `test/feature.issue21.decorations.test.ts` で検証。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。構文ハイライト方式・新規依存（`@codemirror/lang-*`／`@lezer/highlight`）は ADR-0021 に記録。
>
> ▶️ **開発継続中（2026-07-19 時点 / v1.36.0）**: v1.36.0 で、Live Preview を editable WebviewPanel＋active editor follow 方式から **CustomTextEditorProvider（viewType `livePreview.editor`）の再採用**へ設計変更した（ADR-0020、ADR-0005 復活・ADR-0015 廃止）。各エディタは VS Code が渡す単一 TextDocument に生涯バインドし、URI 所有者マップ・active editor follow・`workspace.openTextDocument` 再取得・binding generation は持たない（VS Code が単一 TextDocument バインドとリネーム/削除を管理する。R-03-05／R-03-09／R-03-10 は廃止、R-03-12 を新設）。**Undo/Redo は VS Code へ委譲**し、Webview（CodeMirror）は history を持たず、`classifyUndoRedoKey` で Undo/Redo/Save キーを host へ転送、host が pending edit を flush してから `executeCommand('undo'|'redo')`／`document.save()` を実行する（R-33 新設、R-04-01／R-04-02 改訂、ADR-0017 の「CodeMirror 単独 Undo」を supersede）。デバウンス apply（`EDIT_APPLY_DEBOUNCE_MS`=200ms）＋即時保存の保存モデル（R-03-08、ADR-0019）と最小差分 `WorkspaceEdit`・self-echo ledger（`consumeExpectedWorkspaceEditChange`）・外部変更の一方向反映（`reconcileExternalChange`）は維持する。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。
>
> ▶️ **開発継続中（2026-07-18 時点 / v1.35.0）**: v1.35.0 で、Live Preview の装飾・レイアウトの見た目を標準 Markdown プレビュー相当に近づける 10 項目の修正を行った。箇条書きは階層別マーカー（`•`/`○`/`▪`）＋本文色追従（R-01-05 改訂）、番号付きリストは 1 段目ローマ数字・2 段目アルファベットの階層別 numeral（R-01-07 新設）、太字＋斜体の複合記法 `***text***`/`___text___` を strong＋em で同時装飾（R-01-08 新設）、入れ子引用（`>>`）を階層クラスで表示（R-02-05 改訂）を純粋関数（`src/core/model.ts`）に実装した。CSS/Webview 側では、見出し下の区切り線・水平線単体の余白縮小、インラインコードの強調、フェンスコードブロックの行別 role クラスによる枠の一体化、折りたたみアイコンの拡大、リスト階層インデントの拡大（R-28-05／R-28-06 改訂）を行った。初期表示フォントサイズはズーム基準値の 1.1 倍で描画するようにした（`displayFontSize`、R-28-17 新設）。ユーザーの Markdown 本文は引き続き書き換えない（R-01-02）。
>
> ▶️ **開発継続中（2026-07-19 時点 / v1.34.0）**: v1.34.0 で、Live Preview の編集・保存時に Markdown ソースエディタータブを自動的に閉じる処理を廃止した。ソースタブ再表示への対策は、デバウンス apply 直後の即時保存による TextDocument の dirty 滞留防止に一本化し、拡張機能はユーザーが開いたソースタブを閉じない（R-03-08／R-03-11、ADR-0015／ADR-0019）。
>
> v1.33.1 で、保留中の Webview 編集と保存参加者イベントが競合した場合、イベント時点で保存正規化か真の外部変更かを分類し、保存正規化は pending edit の apply→即時保存後に bound TextDocument を再読込して再分類するよう修正した。古い保存正規化 snapshot を更新済み ack version で Webview へ送らず、連続英字入力の本文・キャレットと CodeMirror Undo 履歴を後退させない（R-04-02、ADR-0019）。真の外部変更はイベント snapshot を authoritative として維持する。
>
> ▶️ **開発継続中（2026-07-18 時点 / v1.33.0）**: v1.33.0 で、Windows 限定の明示コマンドによるクリップボードファイルリンク挿入（R-29-06）を削除し、通常の DataTransfer による画像・ファイルのペースト/ドロップ（R-29-01〜05）は維持した。見出し折りたたみ（R-30-04）は、塗りつぶし三角形を VS Code 標準風の細いシェブロンへ変更し、見出し文字の視覚的な縦位置に揃える。v1.32.0 で、表とアコーディオンの「通常クリック操作」で生 Markdown ソース表示へ切り替わらないよう挙動を整理した。表の通常クリック（プライマリボタン）はキャレットをブロック内へ移さず、クリックされたセルのインライン入力を直接開く（R-22-08。旧「クリック→キャレット移動で生表示化」は撤去し R-22-02 を改訂）。生ソースの直接編集は表右クリックメニュー「Markdownコードを直接編集」からのみ開始でき、対象表の開始行へキャレットを移してカーソル駆動（R-22-02）で生行表示にする（R-22-09）。アコーディオンにも右クリックメニュー「Markdownコードを直接編集」を新設し、`DecorationOptions.detailsDirectEditStartLines`（0 始まり開始行の集合）に登録された `<details>` ブロックはキャレットがブロック内にある間だけウィジェットを抑止して生 HTML 行を描画する（R-27-07）。既定（集合なし）ではカーソル有無に依らず常にウィジェットのままで R-27-03 を満たす。キャレットがブロック外へ出ると表・アコーディオンとも自動でウィジェット表示へ復帰する（`pruneDetailsDirectEdit`）。見出し・リスト・リンク・画像など他ブロックのクリック挙動は不変。v1.31.0 で、表の行・列追加/削除の直後に Live Preview 上の表 DOM が更新されない不具合（`TableWidget.updateDOM` が内容の変わった widget に対しても stale DOM を再利用して `true` を返していたため）を修正し、`updateDOM` が `false` を返して `toDOM()` に新データで再生成させるよう変更した（R-22-01 改訂、高さ再計測の `requestMeasure` は維持）。あわせて、表を表形式のまま任意セルをダブルクリック（または右クリックメニュー「セルを編集」）でインライン `<input>` 編集し、Enter/フォーカスアウトで Markdown へ即時反映・Escape で取消できるセル直接編集を追加した（R-22-07）。セル内の `|` は `\|` にエスケープして保存し表構造を壊さない（`updateTableCell`／`buildRow`／`parseTableRow` の往復、R-22-05 拡張）。v1.29.0 で、Live Preview のみで編集中に閉じたソースタブが自動再表示される現象の根本原因（TextDocument が dirty のまま滞留すること）を断つため、Webview→TextDocument 反映を毎打鍵 apply からタイピング停止後のデバウンス（既定 200ms、モジュール定数 `EDIT_APPLY_DEBOUNCE_MS`）でのバッチ apply へ変更し、apply 直後に必ず即時保存して dirty 窓を最小化するモデルへ移行した（R-03-08／R-04-01、ADR-0019）。全 flush 点（失焦・破棄・バインド切替・明示保存・外部変更処理前）を `flushPendingEdit`（バッチ apply→即時保存）に統一し、取りこぼしをなくした。キャレット退行防止機構（`SelfSaveGuard`／`preserveHistory`／`computeRemotePatch`／`isTrailingNewlineOnlyDifference`）は不変。v1.28.2 で、Live Preview のみで編集中に `applyEdit`/`performSave` の副作用として閉じたはずのソースタブが自動再表示される現象を抑制する機能を追加した。v1.28.1 で Live Preview の連続 Undo が空行挿入・行数増加を起こす不整合（`files.insertFinalNewline` の最終改行エコーを out-of-history で CodeMirror へ適用していたため）を修正した（R-04-02、`isTrailingNewlineOnlyDifference`）。v1.28.0 ではレイアウト・操作性の強化として、見出しセクション折りたたみ（R-30）、未保存インジケータ（R-31）、数式レンダリング（KaTeX、R-32）、テーブルの行・列操作コンテキストメニュー（R-22-05/06）、見出し下余白の拡大（R-28-05 改訂）を追加した。アウトライン/目次ウィジェット（旧 R-33）は削除した。
>
> （v1.26.0 時点） 毎打鍵アイドル自動保存（`SaveDebouncer`）を廃止し、標準エディタと同じ明示保存（Webview の Ctrl+S→host `performSave`）＋失焦・破棄・バインド切替時の flush 保存へ変更した。編集は従来どおり最小 `WorkspaceEdit` で即時反映する。Live Preview の Undo/Redo は CodeMirror が単独で所有する。host は単調 version の edit を apply 成功または差分なし確認後だけ ack し、期待 TextDocument version と LF 本文の ledger で `WorkspaceEdit` 自己エコーを識別する。ledger に一致しない文書変更は `classifyDocumentChange` で分類し、自己保存由来（保存参加者・own-save 窓中の format-on-save）は履歴を保持したままレコンサイルし、真の外部変更のみ履歴を破棄して再同期する。IME、末尾 LF、Explorer の URI/File ペーストは ack と request ID で整合させる。

---

## 検証ステータス凡例

各仕様の先頭に付く3桁マーカーは、左から順に検証段階を表す。各桁は `■`（達成）/ `□`（未達成）で示す。

| 表記 | 状態 |
|------|------|
| `□□□` | 未着手 |
| `■□□` | レビュー済（実装未） |
| `■■□` | 実装済・テスト未 |
| `■■■` | テスト済 |

> 3桁目（`■■■`）への昇格は受け入れテスト実行時にのみ行う。

---

## 目的・スコープ

本文書は、Obsidian ライクな Markdown ライブプレビュー編集 VS Code 拡張機能（`vscode-livepreview-editor`）の要求仕様を USDM 形式で記述する。本拡張は CodeMirror 6 を Webview に埋め込み、記法を保持したまま装飾表示し、カーソル位置の行・要素では生の Markdown 記法を表示する。

## ライブ編集ポリシー

本拡張のライブ編集（カーソル行で生記法・他行で装飾表示）は **標準 Markdown 記法（CommonMark + GFM）** を対象とする。

| カテゴリ | 動作方針 |
|------|------|
| 標準 Markdown 記法（見出し・インライン記法・リスト・タスク・表・コードブロック・リンク・画像 等） | **ライブ編集**（カーソル行で生記法を表示し、他行では装飾表示する） |
| HTML タグ（`<details>`・`<summary>` 等） | **ビューア専用**（通常操作では常にウィジェット描画し生の HTML 記法を出さない。ただしコンテキストメニュー「Markdownコードを直接編集」を選んだ場合のみ、キャレットがブロック内にある間だけ生ソース編集へ移行できる。本文の一般的な編集は標準ソースエディタで行う） |

HTML タグを使ったブロック（`<details>` アコーディオン等）は「ビューアとして正しく成立すること」を満足条件とし、通常操作でのライブ編集対応は要件としない。生の HTML 記法を表示する編集モードは通常操作では持たないが、右クリックメニュー「Markdownコードを直接編集」選択時のみ生ソース編集へ移行でき、キャレットがブロック外へ出るとウィジェット表示へ復帰する（R-27-07）。

## 用語定義

| 用語 | 定義 |
|------|------|
| 装飾（Decoration） | 記法を隠す/置換する/スタイルを当てる表示処理。CodeMirror の `Decoration` に対応 |
| カーソル行 | キャレットまたは選択範囲が掛かっている行。生記法を表示する対象 |
| DecoSpec | 純粋ロジックが返す装飾記述子（オフセット・種別・タグ・属性） |
| タスク項目 | `- [ ]` / `- [x]` で始まる GFM チェックリスト項目 |
| ビューア専用 | カーソル位置に依らず常にウィジェット描画し、生記法を表示する編集モードを持たないブロック |

> **スコープ注記（v1.5.0）**: 本拡張は素の Markdown（CommonMark + GFM）の編集・プレビューに専念する。Obsidian 独自機能（Wikilink・埋め込み・コールアウト・タグ・脚注・カスタムタスク状態・バックリンク・ノート補完・画像ペースト保存）は品質リスク低減のため v1.5.0 で削除した（削除した要件番号: R-07, R-10〜R-15, R-17, R-18）。なお「画像ペースト保存」は v1.24.0 で標準 Markdown エディタ相当の挙動として再導入した（R-29）。

## 動作環境

| 項目 | 要件 |
|------|------|
| VS Code バージョン | 1.85.0 以上 |
| 対象ファイル形式 | Markdown（`.md`） |
| Node.js（開発時） | 18.x 以上 |
| OS | Windows / macOS / Linux |

---

## ＜基本ライブプレビュー＞

### R-01 基本記法のライブプレビュー #core

> **理由：** Obsidian ライクに、記法を保持したまま見た目を装飾し、編集時のみ生記法を見せるため。

> **説明：** 装飾判定は CodeMirror 非依存の純粋関数 `computeDecorations`（`src/core/model.ts`）が担う。カーソル行は生記法、その他の行は装飾表示。

###### ＜カーソル連動＞

- ■■■ R-01-01 カーソル（選択範囲を含む）が掛かっている行は生の Markdown 記法を表示し、それ以外の行は記法を隠して装飾表示する。
- ■■■ R-01-02 `computeDecorations` は入力文字列を一切変更しない（表示のみ）。

###### ＜基本記法＞

- ■■■ R-01-03 太字 `**text**` を内側テキストの強調として装飾し、`**` マーカーを非カーソル行で隠す。
- ■■■ R-01-06 アンダースコア強調（`_`・`__`）は ASCII 単語文字に挟まれた語中（例 `my_var_name`）では発火しないこと（CommonMark 準拠。アスタリスクは語中可）。
- ■■□ R-01-08 太字＋斜体の複合記法 `***text***`/`___text___` を、内側テキストへ `strong` と `em` を同時に適用して装飾し、外側の `***`/`___` マーカーを非カーソル行で隠すこと。太字（`**`）判定が複合記法を誤って「太字＋内側に生の `*` を含む本文」と解釈しないよう、複合記法の判定を通常の太字・斜体判定より先に行うこと。`___` は語境界規則（R-01-06）を尊重すること。カーソル行では生記法を表示すること（R-01-01）。
- ■■■ R-01-04 見出し `#`〜`######` をレベル別クラスで装飾し、`#` プレフィックスを非カーソル行で隠す。
- ■■□ R-01-05 リスト `-` / `1.` を検知し、`-` マーカーをビュレットウィジェットへ置換（非カーソル行）。ビュレットは階層（インデント 2 スペースを 1 段として `Math.floor(indent/2)`）に応じて `•`（0 段目）/`○`（1 段目）/`▪`（2 段目以降はすべて▪と同様）のいずれかに切り替え、色はリンク色ではなく本文文字色（`var(--vscode-editor-foreground)`）に追従すること。○（1 段目）グリフは字形の見え方の都合上 •/▪ と同じ `font-size` では他階層より大きく見えるため、他階層と視覚サイズを揃えるよう僅かに小さく描画すること（Issue #24）。基本アイコンサイズ（`.cm-lp-list-bullet` の `font-size`）は `1.4em` とし、○（2 段目、`.cm-lp-list-bullet-hollow`）のみ引き続き `0.62em` で不変とする。
- ■■□ R-01-07 番号付きリスト `1.`/`1)` は 0 段目（インデント 0〜1）はアラビア数字を生表示のまま維持し、1 段目はローマ数字小文字（`i.`/`ii.`/…）、2 段目以降はすべてアルファベット小文字（`a.`/`b.`/…）へ非カーソル行でのみマーカーをウィジェット置換すること。カーソル行では変換せず生記法（アラビア数字）を表示すること（R-01-01）。

---

## ＜拡張記法＞

### R-02 拡張 Markdown 記法 #syntax

> **理由：** 実用的な Markdown 文書を装飾表示するため、主要な記法を網羅する。

###### ＜インライン＞

- ■■■ R-02-01 斜体 `*text*` を装飾し、`**`（太字）と誤認しない。
- ■■■ R-02-02 インラインコード `` `code` `` を装飾し、内部の Markdown は装飾しない。
- ■■■ R-02-03 リンク `[text](url)` をラベル装飾＋href 保持で表示し、構文を非カーソル行で隠す。リンク遷移は左クリック時のみ実行し、右クリック時はリンクを開かず Webview のコンテキストメニューを表示すること。`.md` リンクの左クリックは同一 URI を重複させない別 Live Preview ビューアで開き、現在のビューアは維持する。`http(s)`/`mailto` は外部ブラウザ、その他相対パスは既定エディタで `preview: false`。
- ■■■ R-02-04 画像 `![alt](url)` を非カーソル行で画像ウィジェットに置換する。

###### ＜ブロック＞

- ■■□ R-02-05 引用 `> quote` を装飾し、`>` マーカーを非カーソル行で隠す。入れ子引用（`>>`・`>>>` … 最大 6 段）は `>` の連続数を階層深度として検知し、行クラスに `cm-lp-quote-l{1〜6}`（7 段以降は `l6` に丸める）を付与して段数に応じた左インデント・境界線幅を CSS で表現すること（純粋関数は深度算出のみを担い、色は引き続き `var(--vscode-*)` テーマ変数に追従、R-28-04）。マーカー非表示範囲は従来通り全 `>` とその直後の空白を覆うこと。入れ子引用は各階層の独立ボーダーバーを祖先階層分まとめて描画し、n 段目の行には n 本のボーダーが表示されること（ボーダー本数・位置は不変のまま、テキスト開始位置は Issue #26 で全階層 `padding-left` 末尾定数を `12px` から `16px` へわずかに右方向へ広げた）。空行を挟まない非空の継続行（`>` の再掲がない、または再掲があっても直前の引用行より浅い深度の行）は CommonMark の lazy continuation に倣い、直前の引用行の深度を継承して同じ `cm-lp-quote-l{1〜6}` の行クラス・インデント・背景バンドを維持すること。継続行に `>` マーカーが無い場合はマーカー hide を追加しない。空行、または見出し・水平線・フェンスコード・表・アコーディオン・数式ブロック・GitHub Alerts など引用以外のブロック開始で継続はリセットされ、以降の非引用行は通常の段落として描画されること。
- ■■□ R-02-06 フェンスコードブロック（```` ``` ````）を検知し、ブロック内の Markdown を一切装飾しない。開始行の情報文字列（言語名。例 ```` ```markdown ````）は非カーソル行で hide し（`fence-info`）、標準プレビュー同様に生の言語ワードを表示しないこと。言語名は開始行 codeblock line spec の属性 `lang`（`role === 'open'` かつ非カーソル行のみ）として持ち、Webview 側は `Decoration.line` の `data-lang` 属性へ橋渡しし、CSS の `.cm-lp-codeblock-open[data-lang]::after` でブロック枠上に整理された言語ラベルを描く。カーソル行では情報文字列を hide せず言語ラベルも付けない（生記法維持、R-01-01）。フェンス検知ロジック（`detectCodeBlocks`）自体は不変（R-02-06 改訂・#4/#5）。ブロック内容の言語別構文ハイライトは R-34 で規定する。
- ■■■ R-02-07 表（ヘッダ＋区切り行）を検知し、区切り行を非カーソル行で隠す。
- ■■□ R-02-08 GitHub Alerts（`> [!NOTE]` / `> [!TIP]` / `> [!IMPORTANT]` / `> [!WARNING]` / `> [!CAUTION]` の 5 種）を純粋関数 `detectAlertBlocks(lines, code)` で検知すること。開始行は `[!TYPE]` マーカーのみを内容に持つ引用行で、以降の連続する引用行を本文とする。フェンスコードブロック内の `> [!NOTE]` は素通し（リテラル文字列として扱い alert としない）。非カーソル行では、各行に行クラス `cm-lp-alert cm-lp-alert-{kind}`（開始行 `cm-lp-alert-open`／終了行 `cm-lp-alert-close`）を付与し、`>` マーカーを hide、開始行の `[!TYPE]` ラベルは種別アイコン＋タイトル名を描く `alert-title` replaceWidget へ置換して生ラベルを可視テキストとして残さないこと。種別ごとのアクセント色（アイコン・タイトル・左ボーダー・背景バンド）は `--vscode-*` テーマ変数に追従（フォールバックのみ、R-28-04）。カーソル行では生記法（`> [!NOTE]`）を維持しウィジェットを出さない（R-01-01）。装飾は表示のみで入力文字列を変更しない（R-01-02）。行装飾ベースのため block widget を用いず、ブロック高さ会計（R-28-10/11）に影響しない（R-02-08 新設・#7）。

---

## ＜表示制御・同期＞

### R-03 ソース横 Live Preview ビューア #viewer

> **理由：** 標準 Markdown ソースを維持したまま、横に並べた Live Preview でも編集でき、複数文書の確認と編集を安全に行えるようにするため。

> **説明：** `livePreview.openWith` は標準ソースエディタを置換せず、`CustomTextEditorProvider`（viewType `livePreview.editor`、`priority: option`）を `vscode.openWith` で `ViewColumn.Beside` に開く。各エディタは VS Code が `resolveCustomTextEditor` に渡す単一 TextDocument に生涯バインドし、`supportsMultipleEditorsPerDocument: false` により同一リソースの重複を作らず既存エディタを reveal する。active editor follow、URI 所有者マップ、`workspace.openTextDocument` 再取得、binding generation は持たない（文書のリネーム/削除は VS Code が管理する）。`livePreview.toggleSource` は提供しない。Undo/Redo は VS Code へ委譲する（R-33）。

###### ＜起動・重複防止＞

- ■■■ R-03-01 標準 Markdown エディタのタイトルバーボタンまたは Explorer コンテキストメニューの `livePreview.openWith` で、ソースを閉じずに Live Preview（Custom Text Editor、`vscode.openWith`）を `ViewColumn.Beside` へ開けること。
- ■■■ R-03-02 同一 URI の Live Preview エディタは `supportsMultipleEditorsPerDocument: false` により重複作成せず、既存エディタを再表示（reveal）すること。異なる URI のエディタは並行して開けること。
- ■■■ R-03-03 `.md` リンクは同一 URI の重複を作らず Live Preview（Custom Text Editor）で開き、現在のエディタを維持すること。外部 URL はブラウザ、その他の相対パスは `preview: false` の既定エディタで開くこと。
- ■■■ R-03-04 Live Preview は CodeMirror 編集、書式コマンド、チェックボックス、リンク、Undo/Redo（VS Code へ委譲、R-33）、IME 抑制、CRLF 保持、最小差分同期を提供し、Markdown テキストを表示目的で書き換えないこと。

###### ＜文書バインド＞

- 廃止 R-03-05（今回 version）: `livePreview.followActiveEditor` によるアクティブ Markdown ソースへの追従は、CustomTextEditor 化により廃止した。各エディタは VS Code が渡す単一 TextDocument に生涯バインドするため、follow 対象の選択・重複切り替え判定は不要となった。
- ■■■ R-03-06 保留中の Webview 編集は、Undo/Redo・save・外部変更処理・dispose の各時点で `flushPendingEdit`（apply）を先に完了してから後続処理を実行し、`operationQueue` で受信順に直列化すること。
- ■■□ R-03-07 Webview の `localResourceRoots`・画像等の resource base は、バインドされた単一 TextDocument の URI から `resolveCustomTextEditor` 時に一度だけ設定すること（文書切り替えによる再バインドは行わない）。
- ■■□ R-03-08 ソースタブを閉じた後も Live Preview から編集できること。編集は `resolveCustomTextEditor` でバインドされた単一 TextDocument へ、CodeMirror の local transaction を通常の edit 経路で最小 `WorkspaceEdit` として反映する。反映は毎打鍵ではなくタイピング停止後のデバウンス（既定 200ms、`EDIT_APPLY_DEBOUNCE_MS`）でバッチ apply し、連続打鍵は最新 version で coalesce する。apply 直後に必ず即時保存し、TextDocument が dirty のまま滞留しないようにする。バッチ apply→即時保存は単一の `flushPendingEdit` 操作として同一 queue で直列実行し、apply が save に先行する順序を保証する。明示保存（Webview の Ctrl+S／Cmd+S を `classifyUndoRedoKey` で捕捉し `preventDefault` して host へ `save` メッセージを送る）と、失焦・dispose・Undo/Redo・外部変更処理前の flush 点も同じ `flushPendingEdit` を経由し、いずれも先行して受信済みの edit 適用後に完走する。毎打鍵アイドル自動保存は行わない（VS Code 標準の autoSave は TextDocument に対して通常どおり動作する）。`workspace.applyEdit` false 時は警告し、authoritative rollback を返す。破棄済み Webview には新規メッセージを送らないが、既受信 edit の適用は完走する。Custom Text Editor 化により、Live Preview エディタのタブにも VS Code 標準の dirty マークを表示し、ビューア内に重複した未保存表示は行わない（Issue #28、R-31 廃止）。
- 廃止 R-03-09（今回 version）: 書式コマンドとアクティブエディタ追従の「最後に操作したビューア」対象保持は、active editor follow の廃止に伴い不要となった。書式コマンド（`livePreview.format.*`）は最後に active になった Live Preview エディタ（`lastActive`）を対象にする。
- 廃止 R-03-10（今回 version）: 対象ファイルのリネーム時のビューア再バインド・削除時のクローズは、CustomTextEditor 化により VS Code が単一 TextDocument バインドとリネーム/削除を管理するため、拡張側の再バインド処理は不要となり廃止した。
- ■■□ R-03-11 Live Preview の編集・保存処理は、ユーザーが開いたソースエディタータブを自動的に閉じないこと。ソースタブ再表示への対策は、デバウンス apply 直後の即時保存によって TextDocument の dirty 滞留を防止する方式とし、`vscode.window.tabGroups.close()` による補完処理は使用しない。
- ■■■ R-03-12 `customEditors` contribution（viewType `livePreview.editor`、`priority: option`、`filenamePattern: *.md`）を登録し、`registerCustomEditorProvider` の `supportsMultipleEditorsPerDocument: false`／`retainContextWhenHidden: true` で解決すること。`livePreview.openWith` は `vscode.openWith` でソース横（`ViewColumn.Beside`）に開き、既存エディタがあれば複製せず reveal すること。
- ■■□ R-03-13 Live Preview タブを標準 Markdown ソースエディタタブと視覚的に区別できるようにすること。(1) `resolveCustomTextEditor` で `webviewPanel.iconPath` に拡張機能同梱アイコン（`media/icon.png`）を設定し、Live Preview タブへ識別アイコンを付与する。(2) `editor/title` メニューの `livePreview.openWith` の `when` を `resourceExtname == .md && activeCustomEditorId != livePreview.editor` とし、Live Preview エディタがアクティブなタブでは「Live Preview エディタで開く」ボタンを表示しないこと（`explorer/context` の同コマンドは現状維持）（R-03-13 新設・#2）。

### R-04 ドキュメント同期 #sync

> **理由：** Webview の編集を TextDocument に正しく反映し、外部変更とも矛盾なく保つため。

###### ＜双方向同期＞

- ■■■ R-04-01 Webview の編集を最小差分（`diffRange`）で `WorkspaceEdit` に適用する。適用は毎打鍵ではなくタイピング停止後のデバウンス（既定 200ms）でバッチ化し、その間の連続打鍵は最新 version で coalesce してから1回の最小差分として適用する。Live Preview の Undo/Redo は CodeMirror が history を持たず VS Code へ委譲する（R-33）。デバウンス中はホストが未 apply のため自己エコーも remote update も発生せず、Webview 内のキャレットはそのまま保持される。ソースエディタ側の undo 粒度はバッチ単位に粗くなる（許容）。host が起こした自己エコー（`consumeExpectedWorkspaceEditChange` が一致させた期待変更）は Webview へ反映しない。真の外部変更（VS Code の Undo/Redo 結果・保存参加者・Git・他エディタ）または apply 失敗 rollback は、`reconcileExternalChange` が一方向に反映し、Webview は `computeRemotePatch` で選択を再マップした新しい EditorState に置換する（CodeMirror は history を持たないため単純置換）。
- ■■■ R-04-02 Host は Webview の単調 version を受理順に管理し、重複・古い・不正な snapshot を適用しない。`applyPendingEdit` 前に「期待 LF 本文＋期待 TextDocument version」を version-keyed の self-echo ledger（`expectedChanges`）へ記録し、`consumeExpectedWorkspaceEditChange` が一致させたその組だけを自己エコーとして消費する（Webview へ反映しない）。ledger に一致しない変更は真の外部変更として `reconcileExternalChange` が一度だけ一方向反映する。反映前に pending edit があれば先に `applyPendingEdit` して確定済み入力を失わない。VS Code の Undo/Redo で TextDocument が書き換わった結果も、この外部変更経路で Webview に反映される。ack は apply 成功または差分なし確認後だけ送る。
- ■■□ R-04-03 Webview は edit version と ack version を別管理し、external update を `baseVersion === editVersion === ackVersion` のときだけ適用する。未 ack local edit、IME、または保留 local change 中は最新1件を保留して ack 後に再判定し、古い base は破棄する。旧形式（baseVersion なし）は未 ack local edit がない場合だけ適用する。`workspace.applyEdit` false の rollback は失敗 edit version を基準にして、より新しい local edit を上書きしない。

> **R-04-02 追記（今回 version）**: CustomTextEditor 再採用と Undo/Redo の VS Code 委譲（R-33、ADR-0020）に伴い、旧設計の保存正規化再分類（`classifyDocumentChange`／`SelfSaveGuard`／`preserveHistory`／`isSaveParticipantNormalization`／`isTrailingNewlineOnlyDifference`）による history 保持レコンサイルは撤去した。現行 provider は self-echo ledger（`consumeExpectedWorkspaceEditChange`）で自己エコーだけを消費し、それ以外は `reconcileExternalChange` が一度だけ一方向反映する単純化した経路に統一している。CodeMirror が history を持たないため、外部反映は EditorState の単純置換で足りる（out-of-history 適用による Undo 崩れの問題自体が発生しない）。なお `src/core/sync.ts` の同名純粋関数は他テストの回帰基準として残置している。

---

## ＜品質・エッジケース＞

### R-05 エッジケースと性能 #robustness

> **理由：** 実利用に耐える堅牢性とパフォーマンスを確保するため。

###### ＜堅牢性＞

- ■■■ R-05-01 ネストしたリスト（インデント付き）をレベル付きで検知する。
- ■■■ R-05-02 コードブロック内の `#` `**` `` ` `` `>` を誤装飾しない。未終了フェンスも安全に扱う。
- ■■■ R-05-03 IME 入力中（変換中）は同期を遅延し装飾ちらつきを防止する（`shouldEmitEdit`）。
- ■■■ R-05-04 レンダリング失敗時は警告を表示し、安全な無装飾表示を維持すること。標準ソースエディタへの切り替えや追加表示は行わないこと（`computeDecorationsSafe`）。

###### ＜性能＞

- ■■■ R-05-05 Webview の可視ビューポートに前後 50 行のパディングとカーソル・選択行を加えた範囲へ装飾計算を限定し（`viewportWindow` を `StateEffect` で装飾用 `StateField` に結線）、数千行でもキー入力・カーソル移動時の全行再計算を行わず処理時間が上限内に収まること。
- ■■□ R-05-06 CRLF 行末の文書でも記法検知・タスクトグルが正しく動作し、Webview 編集の反映時にファイルの EOL を保持して最小差分のみ適用すること。CRLF/LF 混在文書では未編集行を含む各行の EOL を行単位で維持し、Webview が要求した末尾 LF は旧文書に末尾改行がなくても fallback EOL で必ず生成すること（`toLF`/`fromLF`/`fromLFPreserving`、`splitLines` の CR 除外、`toggleTaskAt` の CR 許容）。
- ■■■ R-05-07 `buildDecorations` の `RangeSetBuilder.add()` 呼び出しは CodeMirror が要求する `(from, startSide)` 昇順を遵守すること。`MarkDecoration` の `startSide`（500000000）は `Decoration.replace` の `startSide`（499999999）より大きいため、同一 `from` では `hide`/`replaceWidget` を `mark` より前に追加すること（`sideOf` の順序を修正）。また `builder.add()` が例外をスローした場合は `onError` で報告し `Decoration.none` を返してエディタが空白になることを防ぐこと。
- ■■□ R-05-08 IME 合成中に受信した remote update は最新1件を保留し、`compositionend` 後のマイクロタスクで確定全文を一度だけ edit として送る。保留 remote は即時適用せず host ack 到達後に `baseVersion === editVersion === ackVersion` で再判定し、古ければ破棄する。`applyingRemote` 中は保留変更を消費しない（`shouldFlushComposition` / `shouldApplyRemoteUpdate`）。

### R-06 設定 #settings

> **理由：** ユーザーが表示を調整できるようにするため。

> **説明：** ソース表示は VS Code 標準エディタに委ねたため、装飾 ON/OFF 設定（旧 `livePreview.decorationsEnabled`）は v1.6.0 で廃止した。Live エディターは常に装飾表示する。

###### ＜設定項目＞

- ■■■ R-06-02 `livePreview.fontSize` を 8〜40 にクランプして反映する。

---

## ＜タスク管理＞

### R-08 タスクチェックボックス #task

> **理由：** Obsidian と同様に、チェックリストをインタラクティブなチェックボックスとして扱い、編集体験（WYSIWYG 操作）を高めるため。

> **説明：** `- [ ]`（未完了）・`- [x]`/`- [X]`（完了）で始まるリスト項目を対象とする。マーカー部をチェックボックスウィジェットに置換し、クリックで `[ ]`⇄`[x]` をトグルする。完了項目は本文に取り消し線スタイルを当てる。

###### ＜表示＞

- ■■■ R-08-01 `- [ ]` / `- [x]`（大文字 `X` を含む）を検知し、マーカー部を非カーソル行でチェックボックスウィジェット（`cm-lp-task-checkbox`、`checked` 状態を属性 `checked` に保持）へ置換すること。
- ■■■ R-08-02 完了タスク（`[x]`）の本文に取り消し線スタイル（`cm-lp-task-done`）を当てること。
- ■■■ R-08-03 カーソル行では `- [ ]` の生記法を表示すること（チェックボックス置換を行わない）。
- ■■■ R-08-04 インデントされたネストタスクも検知し、インデントレベルを属性 `indent` に保持すること。
- ■■□ R-08-06 タスク行（`.cm-lp-task`）の本文はリンク色・下線を継承しないこと（`.cm-line.cm-lp-task` に `color: var(--vscode-editor-foreground); text-decoration: none` を当てる）。ただし本文中の実リンク（`.cm-lp-link`）は R-21-04 に従いリンク色・下線を表示すること（`color` の上書きをせず `.cm-lp-link` のスタイルを継承させる）。
- ■■□ R-08-08 チェックボックスウィジェットの外観を CSS のみで次のとおりにすること（DOM・クラス名は不変）。未チェック（`.cm-lp-task-checkbox`）は `background: transparent`（エディタ背景と同化しない）・`border: 1.5px solid #888`（dark/light 両テーマで視認可能な中間グレー）・`border-radius: 4px` とする。チェック済み（`.cm-lp-task-checkbox-checked`）は**固定の赤** `background: #e5484d; border-color: #e5484d;` とし、チェックマーク（`::after`）は**白固定** `border-color: #fff`（回転四角コーナー形状を維持し、位置・サイズを角丸四角の中央に視覚的に収まるよう調整）とする。完了タスクの本文色（`.cm-lp-task-done` の `color`）は `var(--vscode-disabledForeground, var(--vscode-descriptionForeground, #888)) !important` とし、さらに `.cm-lp-task-done .cm-lp-link { color: inherit !important }` を追加してチェック済みタスク内のリンクも同じ暗転色で描画すること（`.cm-line.cm-lp-task .cm-lp-link` の明示 color による !important 上書きを防ぐ）。

###### ＜操作＞

- ■■■ R-08-05 Webview 上でチェックボックスをクリックすると、対応行の `[ ]`⇄`[x]` をトグルし、TextDocument に反映すること。（行トグル計算 `toggleTaskAt` を自動検証。クリック→反映の UI 結線は手動確認）
- ■■□ R-08-07 ホスト起点のトグル（`toggleTask`）でも、トグル結果を Webview へ確実に反映すること。`applyEditFromWebview` が `webviewText` を先行更新するため `onDidChangeTextDocument` のエコー抑制で `update` が送られず、CodeMirror のチェックボックス表示が更新されない問題を避けるため、`toggleTask` 処理では `applyEditFromWebview` の後に明示的に `postMessage({ type: 'update', text })` を送ること。Webview の `update` ハンドラはテキスト一致時 no-op のため通常編集には無害であること。また `setText`（Webview の `update` ハンドラが呼ぶ関数）は**最小差分 dispatch 方式**で実装すること: 共通プレフィックス・サフィックスを除いた最小変更範囲のみ `{ from, to: toOld, insert: text.slice(from, toNew) }` で dispatch し、セレクションを明示しない（CodeMirror が差分を通じてセレクションを自動マッピングするため cursor 位置がほぼ維持される）。全文置換（from:0, to:doc.length）では CodeMirror がセレクションを anchor:0 にリセットして `scrollIntoView` が走り、チェックボックストグル後にスクロール位置が先頭へジャンプする。最小差分方式はその根本原因を排除する。

---

## ＜リッチテキスト記法＞

### R-09 取り消し線・ハイライト #richtext

> **理由：** GFM／Obsidian で一般的な装飾記法をライブプレビュー対象に含め、レンダリング品質を高めるため。

###### ＜装飾＞

- ■■■ R-09-01 取り消し線 `~~text~~` を装飾し、`~~` マーカーを非カーソル行で隠すこと。
- ■■■ R-09-02 ハイライト `==text==` を装飾し、`==` マーカーを非カーソル行で隠すこと。コードブロック内・カーソル行では装飾／非表示を行わないこと。

---

## ＜編集体験の強化＞

### R-16 フォーマットコマンド #format

> **理由：** Obsidian と同様に、選択範囲へ装飾をトグルできるコマンド／ショートカットを提供し、編集体験を高めるため。

> **説明：** 純粋関数 `toggleWrap`（対称マーカー）を `src/core/format.ts` に実装。Webview のキーマップと VS Code コマンド（`livePreview.format.*`、Ctrl+B/I/Shift+X/Shift+H/E）から呼ぶ。

###### ＜トグル＞

- ■■■ R-16-01 選択範囲を対称マーカー（`**` `*` `~~` `==` `` ` ``）で囲めること。
- ■■■ R-16-02 既にマーカーで囲まれている場合（外側／選択端のいずれでも）は解除できること。
- ■■■ R-16-03 空選択では空のマーカーペアを挿入し、カーソルを中央へ置くこと。
- ■■□ R-16-05 コマンド `livePreview.format.*` とショートカット（Ctrl+B 等）から実行できること。（UI 結線は手動確認）

---

## ＜Markdown 記法の網羅＞

### R-19 水平線 #hr

> **理由：** 区切りを視覚化するため、水平線記法を表示する。

###### ＜表示＞

- ■■■ R-19-01 `---` / `***` / `___`（3 個以上・スペース許容）を水平線として検知し、非カーソル行でルールウィジェットに置換すること。リスト（`- `）や 2 個以下は誤検知しないこと。

### R-20 バックスラッシュエスケープ #escape

> **理由：** 記号を文字どおり表示するエスケープを CommonMark 準拠で扱うため。

###### ＜エスケープ＞

- ■■■ R-20-01 `\*` `\#` `\[` 等のエスケープは記法を発火させず、非カーソル行ではバックスラッシュを隠すこと。

### R-21 オートリンク・リンク視認性 #autolink

> **理由：** `<url>` 形式のオートリンクを表示・到達可能にするため。また、リンクの存在をユーザーが気づけるよう、常時下線で視認性を確保するため。

###### ＜表示＞

- ■■■ R-21-01 `<https://…>` をリンク化し `< >` を非カーソル行で隠すこと。
- ■■■ R-21-02 `<a@b.com>` には `mailto:` を付与すること。
- ■■■ R-21-03 CommonMark の山括弧宛先 `[ラベル](<相対パス>)`（パスにスペースを含み得る）を開く際、`openLink`（`src/livePreviewCustomEditorProvider.ts`）が href の外側 1 組の山括弧 `< >` のみを除去（`/^<([\s\S]*)>$/`）してから解決すること。山括弧内のスペースは保持する（`Uri.joinPath` がそのまま扱う）。`model` のパース（`LINK_RE`）は href に山括弧を残す仕様とし、除去はホスト側 `openLink` で吸収する（`data-href`/title 表示には影響させない）。全角スラッシュ `／`(U+FF0F) は実フォルダ名の一部として不変に扱うこと。
- ■■□ R-21-04 リンク（`.cm-lp-link`）は常時下線（`text-decoration: underline`）を表示し、ホバー時も下線を維持すること。タスク行内のリンク（`.cm-line.cm-lp-task .cm-lp-link`）も同様に `.cm-lp-link` のリンク色と下線を継承して表示すること（本文色への上書きをしない）。

### R-22 表のレンダリング #table

> **理由：** GFM テーブルをライブプレビューで実際の表として表示するため。

> **説明：** `detectTableBlocks`/`parseTable` でブロックを解析。表は**カーソルがブロック外のとき**は単一の `table-block` ウィジェットへ置換して HTML テーブル描画し、**カーソルがブロック内に入るとウィジェットを解除して生の行 `| a | b |` を表示**してセル内テキストを直接編集できるようにする。テーブルのシングルクリックは当該行（`<tr data-line>`）へキャレットを移動させ、再描画でブロックがアクティブ化して編集モードへ切り替わる。表形式を保ったまま任意セルをダブルクリック（または右クリックメニュー「セルを編集」）すると当該セルのみをインライン `<input>` で直接編集できる（Enter/フォーカスアウトで確定、Escape で取消）。行の追加・削除や列の追加・削除は、テーブルウィジェット上の右クリックによるカスタムコンテキストメニューからも実行できる（`src/core/tableEdit.ts` の純粋関数で生ソース行を編集し、チェックボックストグルと同一の本文変更経路で反映する）。行・列やセルの編集で `json` が変わると `TableWidget.updateDOM` は `false` を返して `toDOM()` に再生成させ、追加操作なしで表 DOM を即時更新する。

###### ＜描画＞

- ■■□ R-22-01 表ブロック全体を 1 つの `table-block` ウィジェットに置換し、ヘッダ・整列・行データを保持すること。ウィジェットの `attrs` にブロック開始行（`startLine`）を載せ、Webview が各 `<tr>` に `data-line`（ヘッダ=`startLine`、区切り行はスキップ、`rows[k]`=`startLine+2+k`）を付与できるようにすること。各 `th`/`td` にはセル直接編集用に `data-col`・`data-row-type`（header/body）・`data-row-index`（body の 0 始まり）・`data-table-start-line` を付与すること。`TableWidget.updateDOM` は内容が変わった（`eq()` が false の）widget に対して stale DOM を再利用せず `false` を返して `toDOM()` に新データで再生成させ、行・列/セル編集の直後に追加操作なしで表 DOM を更新すること（高さ再計測の `requestMeasure` は `toDOM` 外で維持、R-28-10/11）。
- ■■■ R-22-02 表は、カーソルがブロック内にあるときは `table-block` ウィジェットを出さず生の行を表示し**セル内テキストを編集可能**とすること。非カーソル時のみ従来どおりウィジェットへ置換すること。ブロックの活性化（キャレットをブロック内へ移す操作）は R-22-09 の右クリックメニュー「Markdownコードを直接編集」経由でのみ行い、Webview 側でのテーブルの通常クリックはキャレットをブロック内へ移さず生表示化しないこと（通常クリックはセル編集＝R-22-08 に回す）。コードブロック内の表もどきは表にしないこと。
- ■■□ R-22-03 表セル内の最小限のインライン記法（太字 `**` / `__`、斜体 `*` / `_`、インラインコード `` ` ``）を装飾描画し、生のマーカー（例 `**CPM**`）をそのまま表示しないこと（MAIO プレビュー同様）。装飾は Webview 層（`appendInlineCell`）でテキストノードへ安全に変換し、生 HTML を挿入しないこと。
- ■■■ R-22-04 区切り行は `|` を含み、セル数がヘッダ行と一致する場合のみ表と判定する（水平線 `---` や単独 `-` を区切り行と誤検知しない）。

###### ＜行・列操作＞

- ■■□ R-22-05 純粋関数（`src/core/tableEdit.ts`）はテーブルの生ソース行配列に対し、行の追加（上/下）・行の削除、列の追加（左/右）・列の削除、および単一セルの更新（`updateTableCell`）を行い、区切り行の整合とアライメントを維持した新配列を返すこと。ヘッダ行の削除・最後の1列削除はガードすること。`updateTableCell` は区切り行・存在しない行/列を無変更コピーとして返し、セル値に含まれる `|` を `\|` にエスケープ（`buildRow`）して表構造を壊さないこと（`parseTableRow` はエスケープ済み `\|` を 1 セル内の文字として復元）。入力配列を破壊しないこと。
- ■■□ R-22-06 Webview はテーブルウィジェット上の右クリックでカスタムコンテキストメニューを表示し、行・列操作を実行すること。本文変更はチェックボックストグル（R-08-05）と同一経路（`computeRemotePatch` → `view.dispatch` → 既存 edit 同期）で最小 `WorkspaceEdit` として反映すること。右クリックはキャレット移動・ブロック active 化を起こさないこと。メニュー先頭に「セルを編集」を置き、区切りを挟んで既存の行・列操作を並べること。`role="menu"`/`role="menuitem"`、無効項目に `aria-disabled="true"` を付与すること。メニュー色は `var(--vscode-*)` 追従。

###### ＜セル直接編集＞

- ■■□ R-22-07 Webview は表を表形式のまま、セルの通常クリック／ダブルクリック（または R-22-06 メニュー「セルを編集」）で当該セルのみをインライン `<input type="text"`（`aria-label="表セルを編集"`）で編集させること。通常クリックはブロックを生表示化せずウィジェットのまま `beginCellEditFromTarget` で当該セルの入力欄を開くこと（R-22-08）。確定（Enter/blur/別セル編集開始）は `updateTableCell` → 行・列操作と同一の本文変更経路（`computeRemotePatch` → `view.dispatch` ＋ `isolateHistory.of('full')`）で反映し、取消（Escape）は本文を変更しないこと。IME 変換中（`event.isComposing`）の Enter を確定と誤認しないこと。入力欄操作中のイベントを CodeMirror 本体へ誤伝播させず、1 文字ごとに Markdown へ反映しない（確定時のみ）こと。外部更新（host `update`）と競合したときはセル編集をキャンセルして host 更新を優先すること。

###### ＜通常クリック＝セル編集・生ソースはメニュー経由＞

- ■■□ R-22-08 表の通常クリック（プライマリボタン）は生 Markdown ソース表示へ切り替えず、クリックされたセル（`.cm-lp-table th/td`）の `readCellTarget` を読んで `beginCellEditFromTarget` でそのセルのインライン入力を開くこと。キャレットをブロック内へ移す処理（旧 R-22-02 のクリック→キャレット移動）は行わないこと。セカンダリボタン（右クリック）は握りつぶし、メニューは `contextmenu` 側（R-22-06/R-22-09）で扱うこと。ダブルクリックでもセル編集に入れる状態を維持すること（初回クリックで既に入力が開くため、二度目のクリックは入力欄内に落ちる）。
- ■■□ R-22-09 表の右クリックメニュー（R-22-06）に「Markdownコードを直接編集」項目を「セルを編集」の下へ追加すること。選択時、対象表ブロックの開始行（`startLine`）先頭へキャレットを移動（`view.dispatch({selection})`＋`view.focus()`）し、既存のカーソル駆動（R-22-02）で表を生行表示にして生 Markdown を直接編集可能にすること。キャレットがブロック外へ出れば従来どおりウィジェットへ復帰すること（追加の表示モード状態は持たない）。

---

## ＜編集体験の網羅＞

### R-23 リスト継続入力 #listcontinue

> **理由：** Enter での箇条書き継続という基本的な編集操作を提供するため。

> **説明：** 純粋関数 `continueList`（`src/core/editing.ts`）で次マーカーを算出し、Webview の Enter キーマップで適用する。

###### ＜継続＞

- ■■■ R-23-01 箇条書きを次のビュレットで継続すること。
- ■■■ R-23-02 順序リストは番号をインクリメントすること。
- ■■■ R-23-03 タスクは未完了チェックボックス `[ ]` で継続すること。
- ■■■ R-23-04 インデントを維持すること。
- ■■■ R-23-05 空項目で Enter したらマーカーを除去してリストを終了すること。

### R-24 インデント操作 #indent

> **理由：** Tab/Shift+Tab でリストの階層を調整できるようにするため。

###### ＜インデント＞

- ■■■ R-24-01 Tab で 2 スペースのインデントを追加すること（リスト行）。
- ■■■ R-24-02 Shift+Tab で先頭スペース（最大 2）またはタブ 1 つを除去すること。

### R-25 見出しトグル #headingtoggle

> **理由：** ショートカットで見出しレベルを切り替えられるようにするため。

###### ＜トグル＞

- ■■■ R-25-01 段落を指定レベルの見出しにすること（`Mod+Alt+1〜6`）。
- ■■■ R-25-02 同レベルの見出しは段落へ戻すこと。別レベルは変更すること。レベルは 1〜6 にクランプすること。

---

## ＜実挙動＞

### R-26 画像描画・リンク遷移 #render

> **理由：** プレビューで画像が実際に表示され、リンクが到達可能であることは編集体験の要であるため。

###### ＜描画・遷移＞

- ■■□ R-26-01 Webview の `localResourceRoots` と `asWebviewUri` による `resourceBase` で、相対パス画像（`![](img.png)`）を実描画すること。（リソース解決ロジック `resolveSrc` を実装。表示確認は手動）
- ■■■ R-26-02 標準リンク/オートリンクの左クリックで、外部 URL はブラウザ、相対パスはファイルを開くこと。リンク先が `.md` の場合は同一 URI を重複させない Live Preview ビューアで開き、それ以外は既定エディタで開くこと。右クリックでは `openLink` を送信せず、イベントを消費しないことで Webview のコンテキストメニューを表示すること。（マウスボタン判定を自動検証。UI 結線は手動確認）

---

## ＜Live エディターの操作・体裁＞

### R-27 HTML アコーディオン折りたたみ #fold

> **理由：** 補足情報を `<details>` アコーディオンで畳んで見通しを良くするため。見出しガター折りたたみは不要のため廃止し、HTML の `<details><summary>` 記法のレンダリングに置き換える。

> **説明：** HTML の `<details><summary>…</summary>…</details>` ブロックをプレビュー上でアコーディオンとしてレンダリングする。判定は純粋関数 `detectDetailsBlocks`（`src/core/model.ts`）が担い、**ビューア専用**としてカーソル位置に依らず常にブロック全体を 1 つの `details-block` ウィジェット（既定で折りたたんだ＝閉じた状態）へ置換する（生の HTML を表示する編集モードは持たない）。Webview 層（`src/webview/decorations.ts`）が実際の `<details>` 要素にマッピングし、`<summary>` クリックで開閉する。開閉状態は summary テキストをキーに `openDetails` 集合で記憶し、再描画後も保持する（同一サマリのアコーディオンは状態を共有する制限あり）。アコーディオン本文の編集は標準ソースエディタで行う。見出し（`#`）単位のガター折りたたみ（旧 `foldService`/`foldGutter`）は v1.7.0 で廃止したが、その後、廃止時の問題（常設ガター列がレイアウト幅を占有し左端整列 R-28-07 と衝突する）を回避した別方式として、`<details>` アコーディオンとは独立の見出し折りたたみを R-30 で再導入した。

###### ＜折りたたみ＞

- ■■■ R-27-01 `<details><summary>…</summary>…</details>` ブロックを検知し、ブロック全体を 1 つの `details-block` ウィジェットへ置換すること。フェンスコードブロック内の `<details>` はアコーディオンとみなさず、閉じタグの無い未終了ブロックは折りたたまない（文末まで畳まない）こと。
- ■■■ R-27-02 アコーディオンは既定で折りたたんだ（閉じた）状態で表示し、`<summary>` をクリックで開閉できること。開閉状態は再描画後も保持すること（summary テキストをキーに記憶）。
- ■■■ R-27-03 アコーディオンは**通常操作ではビューア専用**とし、ブロック内にカーソルがあってもウィジェットのまま（生の HTML 記法を表示しない）とすること。ただし R-27-07 の右クリックメニュー「Markdownコードを直接編集」を選び、かつキャレットがブロック内にある間だけは生ソース編集へ移行できる（オプトイン）。Webview 側ではウィジェット本体（サマリ以外）の**左**クリックを capture フェーズで握りつぶし（`preventDefault`/`stopImmediatePropagation`）、CodeMirror 既定の mousedown によるキャレット移動を防ぐこと。`<summary>` クリックはネイティブ開閉に通すこと。`computeDecorations` の既定挙動（`DecorationOptions.detailsDirectEditStartLines` を渡さない場合）はカーソル有無に依らず常にウィジェットとし、本要件を満たすこと。
- ■■□ R-27-04 サマリ行は背景バー・枠・余計な padding を持たず、`▶`（閉）/`▼`（開）の三角マーカー＋サマリテキストのみの軽量な 1 行表示とし、本文インライン要素と馴染ませること。マーカーは開閉状態に追従する（`<details open>` で `▼`、閉で `▶`）。サマリテキストは通常ウェイト（`font-weight: 400`、太字継承を防ぐ）で表示し、マーカーとサマリテキストの間に半角程度の余白（マーカーの `margin-right` 約 `0.4em`）を設けること（MAIO 参照画像準拠）。
- ■■■ R-27-05 純粋関数 `detailsTagRanges`（`src/core/model.ts`）は各行の構造 HTML タグ（`<details …>`・`<summary …>`・`</summary>`・`</details>` の山括弧を含むタグ文字列）の範囲を返すこと（サマリ本文は含まない）。ビューア専用化により `computeDecorations` 内ではこの範囲を使った行内 `hide` は行わない（ブロック全体がウィジェット置換されるため）が、関数自体の仕様は維持する。
- ■■■ R-27-06 アコーディオンを開いたとき**本文を描画**すること（ビューア専用）。`detectDetailsBlocks` が `</summary>` より後〜`</details>` 直前の各行から構造タグを除去した本文行群を `DetailsBlock.body` に格納し（前後の空行はトリム）、`details-block` ウィジェットの `attrs.body` に JSON で渡す。Webview 層は `<details>` 内（サマリの後）に各本文行を `.cm-lp-details-body-line` として最小限のインライン記法（太字・斜体・インラインコード、`appendInlineCell`）で描画すること。複数段落・リスト・ネストは簡易描画で割り切る。本文の一般的な編集は標準ソースエディタで行う（生ソース直接編集は R-27-07）。
- ■■□ R-27-07 アコーディオンの右クリック（`.cm-lp-details` 上）でカスタムコンテキストメニュー（`role="menu"`、項目「Markdownコードを直接編集」）を表示し、選択時に当該ブロック開始行を直接編集集合へ登録して生ソース編集へ移行できること。純粋関数側は `DecorationOptions.detailsDirectEditStartLines?: Set<number>`（0 始まり開始行）を受け取り、`detailsDirectEditStartLines?.has(block.start)` かつブロック内にカーソルがあるときのみ `details-block` ウィジェットを emit せず、ブロック内各行（開始行・内側行とも）を通常行として生描画へフォールスルーすること。既定（集合を渡さない）では従来どおり常にウィジェットとし R-27-03 を満たすこと。`details-block` ウィジェットの `attrs` に `startLine` を載せ、Webview は `.cm-lp-details` に `data-start-line` を付与してメニューが対象ブロックを識別できるようにすること。メニュー選択時は開始行先頭へキャレット移動（`view.dispatch({selection})`＋`view.focus()`）してデコレーション再計算をトリガし生行を表示すること。キャレットがブロック外へ出たら集合から該当エントリを除去してウィジェットへ復帰させること（`pruneDetailsDirectEdit`、表 R-22-09 と同じ体験）。`<summary>` の左クリック開閉・開閉状態記憶（R-27-02）、ブロック高さ会計（R-28-10/11）は維持すること。

### R-28 Live エディターの編集体裁 #editing-ui

> **理由：** 実編集に耐える基本的な見た目（余白・キャレット・チェックボックス操作）を確保するため。

###### ＜体裁＞

- ■■□ R-28-01 本文左側に十分な余白（左パディング）を設けること。見出しガター廃止で空いた領域は本文余白として活用すること。
- ■■□ R-28-02 編集時にキャレット（テキストカーソル）が視認できること（`drawSelection` を有効化し、カーソル要素 `.cm-cursor` の `border-left-color` を `var(--vscode-editorCursor-foreground)`（フォールバックで editor 前景色）で確実に描画する）。
- ■■□ R-28-03 タスクチェックボックスはクリックでフォーカス・選択移動を起こさず、ON/OFF が確実にトグルされること（ウィジェットを `span` 化し、クリックを capture フェーズで受け、`preventDefault`/`stopImmediatePropagation` で CodeMirror の mousedown より先に処理してキャレット移動・再描画を防ぐ）。
- ■■□ R-28-04 本文・見出し・各記法の文字色を VS Code 標準テーマの色変数（`var(--vscode-...)`）に追従させ、独自のハードコード色を用いないこと。
- ■■□ R-28-05 本文体裁を GitHub / VS Code 標準 Markdown プレビュー（github-markdown-css 風）に寄せること。具体的には次を満たすこと（描画エンジンと装飾ロジックは変更せず CSS の体裁のみで実現する）:
  - 本文フォントは UI/サンセリフ（`var(--vscode-markdown-font-family, var(--vscode-font-family, system-ui, sans-serif))`）とし、コード（`.cm-lp-code`/`.cm-lp-codeblock`）のみ monospace を維持。行間は 1.6 前後。
  - 見出し `.cm-lp-h1`〜`h6` を MPE（Markdown Preview Enhanced）/GitHub 風に強化したサイズ（h1≈2em / h2≈1.6em / h3≈1.3em / h4≈1.15em / h5≈1em / h6≈0.9em 目安）にし、太さは基本 `font-weight: 600`、h1/h2 は `font-weight: 700` とする。見出しと本文の間に十分な余白を設けるため、見出し行の上下余白は `padding-top: 1.2em`／`padding-bottom: 0.6em`（h1 は `padding-top: 1.4em`）とし、h1/h2 行に下境界線（`border-bottom: 1px solid var(--vscode-panel-border)`）を付与する。h1/h2 の境界線下の空きは締まった見た目にするため `padding-bottom: 0.3em`（境界線上の余白と合わせた合計値）とする。h5/h6 は `var(--vscode-descriptionForeground)` で減色し本文との差別化を強める。
  - インラインコードは淡背景＋角丸の小ピル、ブロックコード `.cm-lp-codeblock` は全幅背景＋十分なパディング（例 `12px 16px`）にする。ブロックコードは行ごとの `Decoration.line` にフェンス役割（開始行 `cm-lp-codeblock-open`／内部行 `cm-lp-codeblock-inside`／終了行 `cm-lp-codeblock-close`）別クラスを付与し、上下の角丸・境界線を開始/終了行だけに適用することで、行単位の枠が分裂せず 1 つの連続したブロックとして描画されること（純粋関数側は `computeDecorations` の codeblock line spec に role 別クラスを含めるのみで、フェンス検知ロジック自体は不変）。
  - 引用 `.cm-lp-quote`・表 `table.cm-lp-table`（ボーダー・ヘッダ背景・任意のゼブラ）・水平線 `.cm-lp-hr-line` を GitHub プレビュー風にする。水平線の上下余白は `padding: 0.05em 0` 目安まで詰め、区切り線単体の視覚的な間延びを抑えること（R-28-14 に従い margin ではなく padding で表現）。
  - すべての色は `var(--vscode-*)` 変数でテーマ追従を維持し（ハードコード色禁止・フォールバックのみ可）、`.cm-lp-table-row` の `font-variant-numeric: tabular-nums` を維持する。カーソル行で生記法が見えても体裁が崩れないこと（カーソル行表示ロジックは変更しない）。
- ■■□ R-28-06 「Markdown All in One」プレビューに体裁を寄せる追加の磨き込みを行うこと（CSS のみ／装飾ロジック不変、一部は line spec への role/indent 属性付与を伴う）: インラインコード `.cm-lp-code` は背景をやや濃く（`var(--vscode-textCodeBlock-background)` 目安）し `border: 1px solid var(--vscode-panel-border)` を追加して本文から視認しやすくすること。ブロックコードに淡いボーダー（`border: 1px solid var(--vscode-panel-border)`）、引用に淡い背景バンド（`var(--vscode-textBlockQuote-background)`）、`<details>` アコーディオンのマーカーを小さめ・控えめ（`▶`/`▼`、`font-size: 0.8em` 目安）にし、マーカーとサマリテキストの間に余白（`margin-right: 0.4em` 目安）を設け、サマリテキストを通常ウェイト（`font-weight: 400`）にすること。チェックボックスとタスク本文の間に十分な余白を設けること。見出し折りたたみガター（R-30）のシェブロンは視認性のため `font-size` を大きめ（`1.3em` 目安）にし、ガター幅・左端整列（R-28-07）は維持すること。リスト・タスクの階層インデントは、生の先頭空白だけに頼らず行装飾（`Decoration.line` の `attributes.style` に `padding-left`）で `Math.floor(indent/2)` 段あたり `1.5em` 目安を加算し、深い階層ほど視覚的な段差が明確になるようにすること（カーソル行でもレイアウトが崩れないこと）。
- ■■□ R-28-07 左右の読みやすい余白を「Markdown All in One」プレビューに寄せること（`.cm-content` のパディングを `20px 40px 24px 48px` 目安〔上 `20px`／右 `40px`／下 `24px`／左 `48px`〕とする。CodeMirror のインラインスタイル上書きを防ぐため `!important` を付与する）。見出しは行装飾のためインデントを増やさず、見出しと本文の左端が揃うこと。本文フォントは Markdown サンセリフスタックを明示指定（継承のみに頼らない）し、`font-weight: 400`（通常ウェイト）で等幅へフォールバックしないこと。
- ■■□ R-28-08 タスク行（`.cm-line.cm-lp-task`）内のインラインリンク（`.cm-lp-task .cm-lp-link`）は R-21-04 に従いリンク色（`.cm-lp-link` の `color` を継承）と下線（hover 含む）を表示すること。`color` の上書きは行わない（R-08-06 の補完）。
- ■■■ R-28-09 `<details>` アコーディオンは**ビューア専用**（R-27-03）のため、ブロック本文を生記法で表示する編集モードは持たない。本文・サマリのインライン記法（太字・斜体・インラインコード）は `details-block` ウィジェット側（`<summary>` は `appendInlineCell`）でのみ描画し、ブロック内カーソル時に生のマーカー（例 `**ワークパッケージ**`）が見えることはない。本文の編集は標準ソースエディタで行う。装飾は表示のみで入力文字列を変更しないこと。
- ■■□ R-28-10 ブロックウィジェット（`TableWidget`・`DetailsWidget`）は `block: true` で挿入されるため、ブロック高さ会計と実 DOM のズレを抑え、ウィジェットより**下の行**の `posAtCoords`（クリック位置と編集位置の不一致）を防ぐこと。高さ整合は **estimatedHeight 主導**とし（R-28-11 で再定義）、`toDOM` 内では `view.requestMeasure()` を**呼ばない**こと（`toDOM` は CodeMirror の measure サイクル内で実行されるため、ここで再 measure を要求すると高さ確定が次フレームへ遅れ、その間 `posAtCoords` が旧値のままクリックずれを生む）。更新パスの `updateDOM(_dom, view)` でのみ `view.requestMeasure()` を呼び（`return true` で既存 DOM を再利用）、初回描画は `estimatedHeight` で実態に近づける。`DetailsWidget` は開閉で高さが変わるため、`toggle` イベントリスナー内でも `view.requestMeasure()` を呼ぶこと（toggle は measure サイクル外・DOM がツリー内にあるタイミングのため有効）。
- ■■□ R-28-11 ブロックウィジェットの `get estimatedHeight()` は**現在のフォントサイズ**（ホストの `fontSize` 設定。既定 14px。`setFontSize` で webview の装飾層へ同期）と、アコーディオンの**開閉状態**を反映した値を返し、measure 確定前でもブロック直下のクリック位置が一致すること。具体的には、プレーン行高は `fontSize × 1.6`、テーブル行高は `fontSize × 0.95 × 1.6 + 13`（セル `padding: 6px 13px` の縦 12px＋border 1px）として、テーブル＝（ヘッダ 1＋本文行数）× テーブル行高＋`fontSize`（`margin: 0.5em 0`）、アコーディオン＝サマリ行（`fontSize × 1.4 + 2`）＋（開状態のみ）本文行数 ×（`fontSize × 1.4 + 2`）とすること（22/34px のハードコードは廃止）。あわせて、テーブルセルの行高を CSS で固定（`table.cm-lp-table th/td { line-height: 1.6; }`、インライン `<strong>`/`<code>`/`<em>` は `line-height/font-size: inherit`）し、セル内インライン記法（`**bold**`/`` `code` ``）や折返しで行高がブレないようにして推定と実測の乖離自体を縮めること。これによりフォントサイズ 14 以外・セル内インライン記法・details 開閉直後でもブロック直下クリックが正しい行に着地すること。
- ■■□ R-28-12 ブロックウィジェット（テーブル・`<details>`）は `block: true` で atomic 扱いのため、上下矢印（既定の `cursorLineUp/Down`）はブロック全体を 1 ストロークでスキップし、複数ソース行を飛び越えてしまう。これを防ぐため、上下矢印用のカスタムコマンド（`ArrowUp`/`ArrowDown`、既定キーマップより優先登録）を設け、キャレットが折りたたみブロックを越える場合は**1 ソース行ずつ**隣接行へ着地させること。判定は「CodeMirror の既定の縦移動（`moveVertically`）が現在行から 2 ソース行以上ジャンプするか」で行い（折返し段落の視覚行移動は同一/隣接ソース行に留まるため誤発火しない）、該当時のみ現在行 ±1 のソース行先頭へキャレットを移す。非該当（通常移動・折返し段落内の視覚行移動）は既定キーマップにフォールバックすること。
- ■■■ R-28-13 スクロール後にクリックしても、クリックした行に正確にカーソルが置かれること。`#editor { overflow: auto }` と CodeMirror の `.cm-scroller { overflow: auto }` が**二重スクロールコンテナ**を形成すると、`#editor.scrollTop` が増加する一方で `.cm-scroller.scrollTop` は 0 のままとなり、CodeMirror の `posAtCoords` がスクロール量ぶん座標変換をずらしてしまう（スクロールするほど同じクリック位置でもずれ量が増大する症状）。対策として `#editor` の `overflow` を `hidden` に変更し、スクロールを唯一のコンテナである `.cm-scroller` に完全委譲すること（`media/editor.css`）。
- ■■■ R-28-14 見出し行（`.cm-line.cm-lp-h1`〜`h6`）と HR 行（`.cm-lp-hr-line`）の上下余白が `margin` ではなく `padding` で表現されており、CodeMirror の height oracle が正確な行高さを計測できること。`getBoundingClientRect().height` は CSS `margin` を含まないため、見出し・HR 行の `margin-top`/`margin-bottom` が height oracle に計上されず、スクロール量に比例してクリック位置ずれが累積していた（R-28-10 でテーブルに対して同原則の修正を行ったが、見出し・HR に同問題が残存していた）。対策として `media/editor.css` の見出し `margin-top: 0.8em` → `padding-top: 0.8em`・`margin-bottom: 0.3em` → `padding-bottom: 0.3em`（h1/h2 は border-bottom 上の空きを統合し `padding-bottom: 0.55em`）、HR の `margin: 1em 0` → `padding: 0.15em 0`（余白縮小も兼ねる）へ変換すること。あわせて HR の `border-top` を 2px → 3px（`rgba(127,127,127,0.5)`）に変更し視認性を高めること。`applyFontSize` の末尾で `requestAnimationFrame(() => view.requestMeasure())` を呼び、フォントサイズ変更後に全行の実寸を再測定させること（`src/webview/main.ts`）。
- ■■■ R-28-15 ドラッグ選択範囲が左右余白にはみ出さず、かつ長文の上部・中盤・末尾やスクロール後でも確実に視認できること。`.cm-selectionLayer` は `contain:size` かつ子要素が absolute 配置のため、CSS 高さ未指定では used height が 0 となり選択矩形がすべてクリップされ、`height:100%` では viewport 高に固定され文書途中以降がクリップされる。対策として `src/webview/main.ts` の専用 `ViewPlugin` が CodeMirror の `requestMeasure` read/write フェーズを使い、read で `view.contentHeight` と対象レイヤーを取得し、write で inline `height: ${view.contentHeight}px` を同期すること。同一キーで重複 measure を集約し、初期生成、`docViewUpdate`（文書・装飾・viewport 由来の DOM 更新）、`geometryChanged` / `docChanged`、フォントサイズ変更、表・`<details>` の再測定後をカバーし、destroy 時は付与した inline height を除去すること。CSS は `width:100%` と `clip-path: inset(0 40px 0 48px)` を維持して左右余白を除外し、固定 height は指定しないこと。
- ■■□ R-28-16 Live エディター上で Ctrl（Windows/Linux）または Cmd（macOS）を押しながらマウスホイールを操作すると、ホイール上方向で 1px 拡大、下方向で 1px 縮小すること。ホイールの `deltaY` の大きさにかかわらず 1 回の gesture につき 1px のみ変更し、有効範囲は `livePreview.fontSize` と同じ 8〜40px にクランプする。計算は CodeMirror/DOM 非依存の純粋関数 `zoomFontSize`（`src/core/viewport.ts`）で行う。変更は現在の Webview タブ内の `fontSize` 状態だけに適用し、VS Code 設定、他タブ、再度開いたタブには保存・伝播しない。通常の修飾キーなしホイールは従来どおりスクロールし、キーボードショートカットによるズームは追加しない。ズーム時はポインタ直下の文書位置と行内 Y オフセットを変更前に記録し、既存 `applyFontSize` の再計測後に `.cm-scroller.scrollTop` を補正して表示アンカーを維持すること。
- ■■□ R-28-17 Live エディターの実際の描画フォントサイズは、設定値（`livePreview.fontSize`／ズーム基準値）の 1.1 倍を初期表示から適用すること。ズームの基準値・クランプ（8〜40px）は素の設定値側で維持し（`zoomFontSize` は不変）、`#editor` の実描画 `px` と `setFontSize`（ブロックウィジェットの高さ会計、R-28-11）にはスケール後の値を渡すこと。スケール計算は CodeMirror/DOM 非依存の純粋関数 `displayFontSize`（`src/core/viewport.ts`）で行うこと。

### R-29 画像・ファイルのペースト/ドロップ挿入 #paste-media

> **理由：** 標準 Markdown エディタと同様に、画像バイナリのペーストやファイルのドロップだけでワークスペースへ画像を保存し、Markdown リンクを自動挿入できることは編集体験の要であるため。v1.5.0 で削除した「画像ペースト保存」を、Obsidian 独自挙動ではなく標準 Markdown エディタ相当の挙動として v1.24.0 で再導入する。

> **説明：** 画像判定・山括弧エスケープ・スニペット生成・ファイル名衝突回避は VS Code 非依存の純粋関数（`src/core/pasteLink.ts`: `isImageFile`／`formatMarkdownLinkTarget`／`buildMediaSnippet`／`uniqueMediaName`）が担う。Webview（`src/webview/main.ts`）は `paste`/`drop` でファイル・`text/uri-list` を収集し、ファイルまたは URI があるときのみ `preventDefault` して `{ type: 'pasteMedia', binding, files: [{ name, data: Uint8Array }], uris? }` をホストへ送る（ファイルも URI も無い通常テキストは CodeMirror 既定に委ねる）。ホスト（`src/livePreviewCustomEditorProvider.ts` `handlePasteMedia`）はバイナリを document フォルダ相対の保存先（既定 `assets/`）へ `workspace.fs.writeFile` で保存し、同名衝突は `-N` 連番で回避する。ワークスペース内 URI（画像・非画像とも）は複製せず document フォルダ基準の相対パスへ変換し、元ファイルへ直接リンクする。`isCurrentBinding` 確認後、単一スニペットを `{ type: 'insertMedia', binding, text, placeholderFrom, placeholderTo }` として返信し、Webview が現在の選択範囲へ挿入してプレースホルダ（`alt text`／`text`）を選択状態にする。挿入後は既存 edit フローで保存まで確定する。往復は `enqueue` で直列化し、`resolveSrc`（R-26-01）で `assets/` 配下の画像が追加設定なしに描画される。

###### ＜ペースト/ドロップ＞

- ■■□ R-29-01 `formatMarkdownLinkTarget` は、パスにスペース・`(`・`)` を含む場合のみ `<...>` で囲むこと（例: `assets/新規 ビットマップ イメージ.bmp` → `<assets/新規 ビットマップ イメージ.bmp>`、`a(b).png` → `<a(b).png>`）。含まない場合は変化させず（例: `マークダウン.md` → `マークダウン.md`）、非 ASCII はエスケープしないこと。囲む場合に本文へ `<`/`>` が含まれれば `%3C`/`%3E` へエンコードすること。
- ■■□ R-29-02 `buildMediaSnippet` は、画像は `![alt text](<target>)`（プレースホルダ `alt text`）、非画像は `[text](target)` を生成し、プレースホルダ範囲（`placeholderFrom`/`placeholderTo`）が該当文字列を指すこと。非画像の表示名は貼り付け開始時の非空選択を優先し、なければ target basename の最終拡張子を除いた名前とする。`target` は `formatMarkdownLinkTarget` 適用済みを受け取る。
- ■■□ R-29-03 `isImageFile` は画像拡張子（png/jpg/jpeg/gif/bmp/webp/svg/ico/avif/tiff）を true、それ以外（`.md`/`.txt` 等）を false と判定すること。
- ■■□ R-29-04 `uniqueMediaName` は、保存先に同名ファイルがあるとき拡張子の前へ `-1`,`-2`… を付与して衝突を回避すること（例: `image.png` 有り → `image-1.png`、さらに有りで `image-2.png`）。
- ■■□ R-29-05 Webview の高優先度 DataTransfer handler は `files`、`items`、`text/uri-list`、`application/vnd.code.uri-list` を収集する。`text/plain` は、全行 file URI のとき、または（file URI fallback が該当しない場合に限り）全行が絶対ファイルパス（POSIX `/...`、Windows `X:\...`／`X:/...`、UNC `\\server\...`）のときだけ fallback とし、`file:` URI へ正規化して候補へ合流する（Windows パスはドライブレター小文字化・`\`→`/`変換・パーセントエンコードを行う）。通常テキスト・相対パス・HTTP URL、および行の混在（一部行のみ絶対パス）は既定 paste/drop を変えない。URI は同名 File より優先し、workspace 内 URI は画像・非画像とも複製せず document フォルダ基準の相対リンクとする。URI を持たない Markdown File は document フォルダへ、画像とその他 File は `assets/` へ同名回避保存する。外部・無効・読込失敗 URI（絶対パス fallback 由来を含む）は警告し snippet を挿入しない。host 応答は request ID を返し、開始時 selection を追従して応答時に挿入する。

### R-30 見出しセクション折りたたみ #headingfold

> **理由：** 長い文書を見出し単位で畳んで見通しを良くするため。見出し（`#`）単位のガター折りたたみは v1.7.0 で一度廃止した（R-27）が、廃止時の問題（常設ガター列がレイアウト幅を占有し、左余白設計・見出し/本文の左端整列 R-28-07 と衝突する）を回避した設計で、`<details>` アコーディオン（R-27）とは独立の機能として再導入する。

> **説明：** 折りたたみ範囲の算出は VS Code / CodeMirror 非依存の純粋関数（`src/core/model.ts`）が担う。`scanHeadings(doc)` は全見出しをレベル・テキスト・行番号・絶対オフセット付きで返し、`detectCodeBlocks` によりフェンスコードブロック内の `#` を除外する（全文走査。ビューポート限定の `computeDecorations` には依存しない）。`headingFoldRange(doc, line)` は指定行が見出しなら、その行末から次の同レベル以下（同じ以上の強さ、level ≤ 当該レベル）の見出し直前行の行末までを折りたたみ範囲として返し、配下が無ければ `null` を返す（コードブロックを跨いでも正しく範囲を返す）。Webview（`src/webview/main.ts`）は `@codemirror/language` の `codeFolding()`＋カスタム `foldService`（`headingFoldRange` 由来）＋`foldGutter`＋`foldKeymap` を組み合わせて見出し配下を折りたたみ／展開する。既定は全展開。折りたたみ UI は常設ガター幅でレイアウトを崩さないよう、`.cm-gutters` を透明・最小幅にし、`.cm-content` の左パディングをガター幅ぶん減らして総左余白と見出し/本文の左端整列（R-28-07）を維持する。ガターの下向き／右向き細線シェブロンと折りたたみプレースホルダは `var(--vscode-*)` 追従（R-28-04）。

###### ＜見出し折りたたみ＞

- ■■□ R-30-01 純粋関数 `scanHeadings` はフェンスコードブロック内の `#` を除外して全見出しを行番号・レベル・テキスト・オフセット付きで返すこと。
- ■■□ R-30-02 純粋関数 `headingFoldRange` は見出し行に対し、次の同レベル以下の見出し直前までを折りたたみ範囲として返し、配下が無い場合は `null` を返すこと。コードブロックを跨いでも正しく範囲を返すこと。
- ■■□ R-30-03 Webview は `codeFolding()`＋カスタム `foldService`（`headingFoldRange` 由来）＋`foldKeymap` で見出し配下を折りたたみ／展開できること。既定は全展開。
- ■■□ R-30-04 折りたたみ UI は常設ガター幅でレイアウトを崩さず、見出しと本文の左端整列（R-28-07）とテーマ色追従（R-28-04）を維持すること。開状態は下向き、閉状態は右向きの VS Code 標準風の細いシェブロンとし、塗りつぶし三角形を用いないこと。シェブロンは視認性のためさらに拡大する（`font-size: 1.5em` 目安）。ガター要素はガター要素自身の中央揃え（`align-items: center`）とすること（Issue #24：#21 で `align-items: flex-start` ＋大きな `translateY(0.55em)` に変更した結果シェブロンが下方向へずれ過ぎ、別の行に属するように見えてしまったため巻き戻し）。ガター要素の高さは対応する見出し行の（パディング込みの）ブロック高に一致するが、見出し行は `padding-top ≫ padding-bottom` の非対称パディングを持つため、`align-items: center` だけではシェブロンが見出しテキスト字面の視覚中心よりも下にずれる。この補正量は見出しレベルごとに固定値を個別に手調整するのではなく、`(padding-top − padding-bottom) / 2` を、見出し自身の font-size 倍率とガターの font-size 倍率（`--lp-fold-gutter-size`）で単位変換した `translateY` として、見出し 1〜6 全レベルについて `calc()` により導出すること。見出しの font-size・padding-top・padding-bottom・折りたたみガターの font-size 倍率は、見出しレベルごとに 1 か所の CSS カスタムプロパティ（`--lp-hN-size`／`--lp-hN-pt`／`--lp-hN-pb`／`--lp-fold-gutter-size`）で定義し、見出し本体のスタイルとガターのナッジの両方がこの同じ値を参照すること。これにより、見出しのサイズやパディング比率を変更しても、ガターの縦位置ナッジをレベルごとに個別に手調整することなく、シェブロンが見出しテキスト字面の中央に揃い続ける構造とする（旧方式は見出し 1〜3 にのみ独立した固定 `translateY` 値を追加適用しており、見出し 4〜6 には補正が無く、値もパディングとの算出根拠を共有しない手調整のマジックナンバーの積み増しだったため、フォントサイズやパディングを変えるたびにズレが生じていた）。ガターそのものには見出しレベル情報が無いため、見出しレベル別クラス（`cm-lp-fold-h1`〜`cm-lp-fold-h6`、見出し 1〜6 全レベルに付与）をガター要素へ付与する機構（`gutterLineClass` 等）を用いてよい。クリック領域、`foldKeymap`、fold placeholder は維持すること（#8）。fold placeholder の背景は地色に近い控えめな色（`color-mix` によるテーマ追従、白背景を強調しない）とし、`border` による差別化のみで通常表示と区別できること（Issue #26）。

### 廃止 R-31 未保存インジケータ #unsaved

> **廃止理由：** Issue #28 により、Custom Text Editor タブが提供する VS Code 標準 dirty マークを唯一の未保存表示とする。ビューア内オーバーレイと host↔Webview の `dirty` メッセージ経路は重複表示となるため廃止した。

> **旧仕様：** host の `TextDocument.isDirty` を `{ type: 'dirty', dirty, binding }` として Webview へ送信し、CodeMirror DOM 外の `cm-lp-unsaved-indicator` を切り替えていた。R-31-01〜03 はこの廃止に伴い無効となる。保存・同期・Undo/Redo の既存経路は変更しない。

### R-32 数式レンダリング #math

> **理由：** Markdown 中の数式（インライン `$…$`・ブロック `$$…$$`）を KaTeX で表示描画し、他の装飾と同様に「非カーソルはレンダリング／カーソル内は生記法」で編集できるようにする。

> **説明：** 装飾判定は CodeMirror 非依存の純粋関数（`src/core/model.ts`）で行う（ADR-0002 / 0003）。インラインは `parseInline` に `$…$` 検知を追加する（優先度はインラインコードの次。開き `$` の直後・閉じ `$` の直前が非空白、内部に `$`／改行を含まない、直前が `\` の `\$` はエスケープとして対象外、コードブロック内は既存 code 判定により対象外）。非カーソル行では `replaceWidget`（tag `math-inline`、`attrs.tex`）へ置換、カーソル行では生記法を表示する。ブロックは新設の純粋関数 `detectMathBlocks(lines, code)` が `$$…$$`（単一行 `$$ … $$` と、`$$` で始まり後続の `$$` 行で閉じる複数行の両形式。コードブロック除外・先頭 `\$$` エスケープ非対象・未終了非対象）を検知し、`computeDecorations` の table/details と同様の位置でキャレットがブロック外のときのみ `replaceWidget`（tag `math-block`、`block: true`）へ置換、ブロック内では生記法を表示する（table と同じ active 判定）。Webview（`src/webview/decorations.ts`）は `MathInlineWidget`／`MathBlockWidget` を追加し、`katex.render(tex, element, { throwOnError: false })` で DOM へ直接描画する（生ユーザー HTML は挿入しない）。KaTeX JS は `dist/webview.js` に IIFE バンドルされ、CSS/フォントは `esbuild.js` が `media/katex/`（`katex.min.css` と `fonts/`）へコピーし、`getHtml`（`src/livePreviewCustomEditorProvider.ts`）が `<link>` で配信する。`font-src ${cspSource}` で許可済み。`script-src` は nonce のみを維持し外部 script を追加しない（ADR-0006）。`MathBlockWidget` は `estimatedHeight` を実装し `toDOM` 内で `requestMeasure` を呼ばず `updateDOM` で呼ぶ（R-28-10 / R-28-11）。本文は書き換えない（R-01-02）。

###### ＜数式レンダリング＞

- ■■□ R-32-01 純粋関数はインライン `$…$` を検知し（開き直後／閉じ直前が非空白・内部に `$`／改行なし・`\$` エスケープ尊重・コードブロック除外）、非カーソル行で数式ウィジェットへ置換、カーソル行で生記法を表示すること。装飾は入力文字列を変更しないこと（R-01-02）。
- ■■□ R-32-02 純粋関数 `detectMathBlocks` は `$$…$$` ブロック（コードブロック除外・未終了は非対象）を検知し、カーソルがブロック外のとき block 数式ウィジェットへ置換、ブロック内では生記法を表示すること。
- ■■□ R-32-03 Webview は KaTeX を JS バンドル同梱・CSS/フォントを `media/katex/` から配信して数式を DOM 描画し、レンダリング失敗時も Webview を落とさず生 tex をフォールバック表示すること。CSP（nonce／font-src cspSource）を維持すること。
- ■■□ R-32-04 block 数式ウィジェットは `estimatedHeight` を実装し、`toDOM` 内で `requestMeasure` を呼ばず `updateDOM` で呼ぶこと（R-28-10 / R-28-11）。

### R-33 Undo/Redo 委譲 #undoredo

> **理由：** Live Preview を CustomTextEditor として再採用した（R-03-12、ADR-0020）ことで、Undo/Redo をエディタ内部で二重管理せず VS Code に委譲でき、ソースエディタと履歴を共有して整合を保てるため。CodeMirror 単独 Undo（旧 R-04-01／ADR-0017）は WebviewPanel 前提の設計であり、CustomTextEditor では VS Code のコマンド経路へ委譲するのが自然である。

> **説明：** Webview（CodeMirror）は history を持たず、Undo/Redo/Save のキー入力を純粋関数 `classifyUndoRedoKey`（`src/core/editing.ts`）で分類して host へ転送する。host（`src/livePreviewCustomEditorProvider.ts`）は pending edit を flush してから `vscode.commands.executeCommand('undo'|'redo')`／`document.save()` を実行する。undo/redo が TextDocument を書き換えた結果は `onDidChangeTextDocument` を通じて外部変更として Webview に一方向反映される（R-04）。

###### ＜キー分類・委譲＞

- ■■■ R-33-01 `classifyUndoRedoKey` は、`Ctrl/Cmd+Z`=undo、`Ctrl/Cmd+Shift+Z` および `Ctrl+Y`（非 Cmd）=redo、`Ctrl/Cmd+S`=save に分類し、IME 変換中（`isComposing`）・Alt 併用・修飾なしは `undefined` を返すこと。
- ■■■ R-33-02 host は undo/redo/save の実行前に必ず pending edit を `flushPendingEdit`（apply）で反映し、その後 `executeCommand('undo'|'redo')`／`document.save()`（dirty のときだけ）を実行すること。undo/redo は保存しないこと。
- ■■■ R-33-03 Webview（CodeMirror）は Undo/Redo history を持たず（`@codemirror/commands` の `history()`／`historyKeymap`／`isolateHistory` を import・登録しない）、Undo/Redo キーは host へ転送すること。
- ■■■ R-33-04 host は自己エコー（`consumeExpectedWorkspaceEditChange` が一致させた期待変更）を消費し Webview へ反映せず、外部変更（VS Code の Undo/Redo 結果・保存参加者・Git・他エディタ）は `reconcileExternalChange` で一度だけ一方向反映すること。dispose 時は pending edit を flush するが保存はしないこと。

### R-34 コードブロック言語別構文ハイライト #codehighlight

> **理由：** フェンスコードブロックの内容を標準 Markdown プレビュー相当に読みやすくするため、言語別のトークン色分けを適用する。

> **説明：** Webview（`src/webview/main.ts`）は `markdown({ codeLanguages })` に同期リゾルバ `codeLanguageFor`（`src/webview/highlight.ts`）を渡し、フェンス情報文字列（言語名）から対応する `Language` を返して埋め込みコードを言語解析させる。リゾルバは動的 `import()` を用いず個別 `@codemirror/lang-*` パッケージを同期に解決するため、Webview は単一 esbuild バンドルのまま保たれる。トークン色は `HighlightStyle`（`lpHighlightStyle`）＋`syntaxHighlighting()` で適用し、色は `--vscode-symbolIcon-*`（keyword/function/class/variable/number/string/constant/operator 等）＋フォールバックのみで VS Code テーマに追従する（ハードコード色禁止、R-28-04）。プログラミング言語向けタグのみを対象にし、Markdown 本文のタグ（見出し・強調・リンク・引用/リスト/コードのマーカー等）は写像しない（既存 `.cm-lp-*` 装飾が本文体裁を所有し、実質的に色分けはコードブロック内容にスコープされる）。CodeMirror の Undo/Redo 委譲（R-33-03、`history()` 不使用）を壊さないこと。方式・新規依存は ADR-0021 に記録。

- ■■□ R-34-01 フェンスコードブロックの内容を言語別に構文ハイライトすること。`markdown({ codeLanguages: codeLanguageFor })` で言語パーサを供給し、`syntaxHighlighting(lpHighlightStyle)` でトークンを色分けする。対応言語は主要言語（js/ts/jsx/tsx/python/html/css/json/c/cpp/rust/java/sql/xml/yaml/php 等）とし、未対応言語はハイライトせず素の等幅表示にフォールバックすること。
- ■■□ R-34-02 トークン色は `--vscode-symbolIcon-*` を中心とした `var(--vscode-*)` テーマ変数に追従させ、独自ハードコード色を用いない（フォールバックのみ可、R-28-04）。プログラミング言語タグのみを写像し、Markdown 本文の装飾（`.cm-lp-*`）と衝突させないこと。
- ■■□ R-34-03 言語リゾルバ `codeLanguageFor` は `Language`（`LanguageSupport.language`）を同期に返し、動的 `import()` を用いないこと（Webview 単一バンドル維持）。Undo/Redo 委譲（R-33、`@codemirror/commands` の `history()` を import・登録しない）を壊さないこと。
