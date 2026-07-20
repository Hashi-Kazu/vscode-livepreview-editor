---
name: line-anchored-bidirectional-scroll-sync
description: 標準ソースエディタと Live Preview の縦スクロールを行番号アンカーで双方向同期し、3 層でループを防止する
metadata:
  type: project
---

# ADR-0022: 行番号アンカー双方向スクロール同期とループ防止

- **ステータス**: 採択済み（v1.39.0）
- **確信度**: 高（src/core/viewport.ts・src/webview/main.ts・src/livePreviewCustomEditorProvider.ts から明示的に確認）

## コンテキスト

GitHub Issue #37 は「エディターとプレビューの縦スクロールが連動しない」という指摘だった。本拡張は 2 ペイン「エディタ＋プレビュー」構成ではなく **CustomTextEditorProvider**（`livePreview.editor`）であり、Live Preview 実体は単一 CodeMirror を持つ Webview（ADR-0020）。`livePreview.openWith` は標準ソースを閉じず `ViewColumn.Beside` に Live Preview を開く（`docs/architecture.md`）ため、Issue の「エディター」は標準 Markdown ソース `TextEditor`、「プレビュー」は Live Preview Webview を指す。両者は同一 `TextDocument` にバインドされ、行番号は 1:1 対応する。

カスタムエディタの Webview は `vscode.window.visibleTextEditors` に含まれない。したがって対象 URI に一致する `visibleTextEditors` は常に標準ソースエディタだけであり、これを同期相手として使える（Live Preview 自身を誤って対象にする心配がない）。

## 決定

- 同期アンカーは **0 始まり行番号**（最上部可視行）。両側が同一本文なので行番号でマップできる。標準ソースエディタ側にはサブ行位置を指定する手段が無いため行精度とする。Webview→host メッセージには行内フラクション（0〜1）も含めるが、host はこれを参照しない（Webview ローカルの復元用途にのみ意味を持つ余地を残す）。
- Webview → host: `.cm-scroller`（唯一のスクロールコンテナ、R-28-13／ADR は変更なし）の `scroll` を rAF スロットルで拾い、CodeMirror geometry（`view.lineBlockAtHeight`）で最上部可視行を求めて `{ type: 'scroll', binding, line, fraction }` を送る。host は対象 URI の各 `visibleTextEditors` に `revealRange(new vscode.Range(line,0,line,0), TextEditorRevealType.AtTop)` を適用する。
- host → Webview: `vscode.window.onDidChangeTextEditorVisibleRanges` を購読し、対象 URI 一致イベントの `visibleRanges[0].start.line` を `{ type: 'scrollTo', binding, line }` として送る。Webview は `EditorView.scrollIntoView(pos, { y: 'start' })` でその行を最上部へスクロールする。
- 相互ループ防止を 3 層で行う。
  1. **Webview 側 1 フレームガード**（`applyingRemoteScroll`、DOM 依存につき `src/webview/main.ts` に実装）: `scrollTo` 適用中〜適用直後の 1 フレーム（rAF）は自前 scroll ハンドラの送信を抑止する。
  2. **host 側の時刻ベース抑止窓**: Webview 起点の `revealRange` は `onDidChangeTextEditorVisibleRanges` を発火させるため、reveal 実行時に `nextScrollSuppressUntil(now, windowMs)` で抑止窓を開き、`isEchoScroll(now, suppressUntil)` が true の間は Webview へ中継しない。
  3. **行一致デデュープ**: `shouldRelayScrollLine(line, lastSyncedLine)` により、直近に同期した行と同じ行への同期要求は方向を問わず無視する。
- 抑止窓・デデュープ・行クランプ（`clampScrollLine`）は `src/core/viewport.ts` の **純粋関数**として実装し、DOM/vscode に依存しない（ADR-0002 の踏襲）。単体テストは `test/feature.issue37.scrollSync.test.ts` に置く。

## 理由

- **行番号アンカー**: 標準ソースエディタは `revealRange` 以上の精度（サブ行スクロール位置）を外部から指定する API を持たないため、行精度を同期の共通言語とするのが最も単純で双方に無理がない。
- **`visibleTextEditors` が Webview を含まないことの利用**: CustomTextEditorProvider 方式ではカスタムエディタの WebviewPanel は `visibleTextEditors` に現れない。これにより「対象 URI の `visibleTextEditors`」というフィルタだけで安全に「標準ソースエディタだけ」を宛先にでき、自分自身（Live Preview）を誤って `revealRange` してしまう心配がない。
- **3 層防止**: 単一のガードだけでは不十分になりうる。Webview 側 1 フレームガードは同一プロセス内の即時エコーを止めるが、host 側の `revealRange`→`onDidChangeTextEditorVisibleRanges` は非同期でタイミングが読みづらいため時刻ベースの抑止窓を追加し、さらに稀な取りこぼし（窓境界のレース等）に備えて行一致デデュープを最終防波堤として加える。3 層とも「一致したら中継しない」という単純な判定に留め、状態機械を複雑化させない。
- **純粋関数分離**: 抑止窓・デデュープ・クランプの正しさ（境界値・NaN 等）を DOM/vscode なしで Vitest 検証できるようにする（ADR-0002 と同じ方針）。CodeMirror geometry・`revealRange`・`postMessage` を伴う実配線自体は Vitest で単体化できないため、こちらは手動確認とする。

## 影響

- `src/core/viewport.ts` に `clampScrollLine`／`isEchoScroll`／`nextScrollSuppressUntil`／`shouldRelayScrollLine`／定数 `SCROLL_SUPPRESS_WINDOW_MS` を追加。既存の `viewportWindow`／`resolveSettings`／`zoomFontSize`／`displayFontSize` は不変。
- `src/webview/main.ts` に `.cm-scroller` の `scroll` リスナ（rAF スロットル）、`scrollTo` メッセージハンドラ、`applyingRemoteScroll` ガードを追加。既存の `edit`/`update`/`ack` 経路・IME 合成・Undo/Redo 委譲（R-33、`history()` 不使用）は不変。
- `src/livePreviewCustomEditorProvider.ts` に `scroll` メッセージ受信ハンドラ（`revealRange`）と `onDidChangeTextEditorVisibleRanges` 購読（`scrollTo` 送信）を追加。既存の `operationQueue`・デバウンス apply・self-echo ledger（ADR-0019）は不変。
- ユーザーの Markdown 本文は書き換えない（R-01-02）。スクロール同期は表示のみ。
- 検証は純粋関数 spec の単体テスト（`test/feature.issue37.scrollSync.test.ts`）＋`npm run check-types`／`node esbuild.js`／`npx vitest run` 通過＋長文を含む手動確認で担保する。
