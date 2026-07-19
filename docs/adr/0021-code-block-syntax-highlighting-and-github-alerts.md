---
name: code-block-syntax-highlighting-and-github-alerts
description: コードブロックの言語別構文ハイライトと GitHub Alerts 記法を追加する
metadata:
  type: project
---

# ADR-0021: コードブロック言語別構文ハイライトと GitHub Alerts 記法

- **ステータス**: 採択済み（v1.37.0）
- **確信度**: 高（src/webview/highlight.ts・src/webview/main.ts・src/core/model.ts・package.json から明示的に確認）

## コンテキスト

GitHub Issue #21 の表示改善 8 項目のうち、次の 2 つはアーキテクチャ変更（新規依存・新記法検知）を伴う。

- **#5 言語別構文ハイライト**: 従来 `markdown()` は `codeLanguages` 未指定で埋め込みコードを言語解析せず、`syntaxHighlighting(HighlightStyle)` も未登録だったため、コードブロック内はトークン色分けがゼロだった。
- **#7 GitHub Alerts**: `> [!NOTE]` などの admonition 記法を検知するロジックが無く、`[!NOTE]` が生ラベルのまま同一グレーボックスで表示されていた。

## 決定

### 言語別構文ハイライト（R-34）

- `markdown({ codeLanguages: codeLanguageFor })` を採用する。`codeLanguageFor`（`src/webview/highlight.ts`）はフェンス情報文字列（言語名）から対応する `Language`（`LanguageSupport.language`）を**同期に**返すリゾルバとする。
- 言語パーサは個別 `@codemirror/lang-*` パッケージ（javascript/python/html/css/json/cpp/rust/java/sql/xml/yaml/php）を静的 import して供給する。`@codemirror/language-data` の動的 `import()` 方式は**採らない**（後述）。
- トークン色は `HighlightStyle`（`lpHighlightStyle`）＋`syntaxHighlighting()` で適用する。色は `--vscode-symbolIcon-*`（keyword/function/class/variable/number/string/constant/operator 等）＋フォールバック値のみで VS Code テーマに追従する。
- 写像対象はプログラミング言語向けタグに限定し、Markdown 本文のタグ（見出し・強調・リンク・マーカー等）は写像しない。結果として色分けは実質コードブロック内容にスコープされ、既存 `.cm-lp-*` 装飾が本文体裁を所有し続ける。

### GitHub Alerts（R-02-08）

- 純粋関数 `detectAlertBlocks(lines, code)`（`src/core/model.ts`）で 5 種（NOTE/TIP/IMPORTANT/WARNING/CAUTION）を検知する。開始行は `[!TYPE]` のみを内容に持つ引用行、以降の連続引用行を本文とする。フェンスコードブロック内は素通し。
- レンダリングは**行装飾ベース**（`Decoration.line` の種別クラス＋`>` マーカー hide＋開始行 `[!TYPE]` ラベルの `alert-title` replaceWidget 置換）とし、block widget を用いない。種別別のアイコン・タイトル色・左ボーダー・背景バンドは CSS で `--vscode-*` 追従。

## 理由

- **同期リゾルバ＋個別 `lang-*` 静的 import**: Webview は単一 esbuild バンドル（`dist/webview.js`）で配布するため、`@codemirror/language-data` の動的 `import()`（言語ごとのコード分割）はチャンク読み込みが必要になり単一バンドル前提と噛み合わない。個別パッケージを静的 import し `Language` を同期に返すことで、バンドル構成を変えずに主要言語を色分けできる。
- **`--vscode-symbolIcon-*` への追従**: VS Code はトークン色を CSS 変数として Webview に公開しないが、`symbolIcon.*` 系のテーマ色は公開される。これを用いることでハードコード色を避けつつテーマ追従を保てる（R-28-04）。
- **Alerts を行装飾で実装**: block widget にすると高さ会計（R-28-10/11）の対象になるが、行装飾なら各行が通常のエディタ行のままで高さ会計に影響せず、カーソル行での生記法維持（R-01-01）も既存の引用処理と同じ枠組みで実現できる。

## 影響

- 新規依存: `@codemirror/lang-javascript`／`-python`／`-html`／`-css`／`-json`／`-cpp`／`-rust`／`-java`／`-sql`／`-xml`／`-yaml`／`-php`、`@lezer/highlight`。Webview バンドルサイズが増加する（コードブロック表示品質とのトレードオフとして許容）。
- `src/webview/main.ts` の拡張リストに `syntaxHighlighting(lpHighlightStyle)` を追加し、`markdown()` を `markdown({ codeLanguages })` へ変更。Undo/Redo 委譲（R-33-03、`history()` 不使用）は不変。
- `src/core/model.ts` に `detectAlertBlocks`／`ALERT_TITLES`／alert 系 spec を追加。フェンス検知ロジック（`detectCodeBlocks`）は不変。
- 検証は純粋関数 spec の単体テスト（`test/feature.issue21.decorations.test.ts`）＋`npm run compile` 通過＋Live Preview 上の手動確認で担保する。
