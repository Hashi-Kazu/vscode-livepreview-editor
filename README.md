# Live Preview Editor (vscode-livepreview-editor)

Obsidian の Live Preview に近い、Markdown ファイル用の **1 枚ビュー編集エディタ** を提供する VS Code 拡張です。記法を保持したまま見た目を装飾し、カーソルがある行では生の Markdown 記法を表示します。

> ▶️ **v1.22.0 開発版** — ソース横の editable Live Preview ビューアと active editor follow に対応。

## スクリーンショット

## 特徴

- CodeMirror 6 を editable `WebviewPanel` に埋め込んだ実装
- カーソル行は生記法、それ以外の行は装飾表示（Obsidian ライク）
- VS Code 標準エディタ（ソース）横の編集可能な Live Preview ビューア
- 異なる Markdown 文書の複数ビューア、同一 URI の重複防止、アクティブソース追従
- `<details>` アコーディオンのビューアレンダリング（`<summary>` クリックで開閉）
- 外部ファイル変更（Git pull・他エディタ編集）を検知して再同期
- 装飾判定ロジックを CodeMirror から分離した純粋関数として実装し、Vitest でユニットテスト

## ライブ編集ポリシー

本拡張のライブ編集対象は **標準 Markdown 記法（CommonMark + GFM）** のみです。

| カテゴリ | 動作 |
| --- | --- |
| 標準 Markdown 記法（見出し・太字・リンク・表・タスクなど） | **ライブ編集**（カーソル行で生記法、他行で装飾表示） |
| HTML タグ（`<details>`・`<summary>` など） | **ビューア専用**（ウィジェット描画のみ。ライブ編集は不要。編集は標準ソースエディタで） |

HTML タグについては「ビューアとして正しく成立すること」を目標とし、カーソルがブロック内にあっても生の HTML を表示する編集モードは持ちません。

## インストール

VS Code Marketplace から直接インストールできます。

1. VS Code の拡張機能パネル（`Ctrl+Shift+X`）を開く
2. `Markdown ライブプレビューエディタ` で検索
3. **インストール** をクリック

または、コマンドパレット（`Ctrl+Shift+P`）で `ext install Hashi-Kazu.vscode-livepreview-editor` を実行。

## 対応記法

| 記法 | 例 | 備考 |
| --- | --- | --- |
| 見出し | `# 〜 ######` | |
| 太字 / 斜体 | `**text**` / `*text*` | |
| 取り消し線 / ハイライト | `~~text~~` / `==text==` | |
| インラインコード | `` `code` `` | |
| コードブロック | ` ```lang … ``` ` | |
| リスト | `- item` / `1. item` | |
| タスク | `- [ ]` / `- [x]`（クリックで完了トグル） | |
| 引用 | `> quote` | |
| 水平線 | `---` / `***` / `___` | |
| リンク | `[text](url)`（クリックで遷移） | |
| オートリンク | `<https://…>` / `<a@b.com>` | |
| 画像 | `![alt](url)`（実描画） | |
| 表 | `\| a \| b \|`（HTML テーブル描画） | |
| エスケープ | `\*` `\#` 等 | |
| `<details>` アコーディオン | `<details><summary>…</summary>…</details>` | ビューア専用（編集は標準エディタ） |

### 編集機能

- **フォーマットショートカット** — Ctrl+B（太字）/ Ctrl+I（斜体）/ Ctrl+Shift+X（取消線）/ Ctrl+Shift+H（ハイライト）/ Ctrl+E（インラインコード）。選択範囲へ装飾をトグル。コマンドパレットの `Live Preview: …` からも実行可能。
- **リスト継続入力** — Enter で次のビュレット/番号/タスクを継続、空項目で終了。
- **インデント** — Tab / Shift+Tab でリストの階層を調整。
- **見出しトグル** — `Ctrl+Alt+1〜6` で見出しレベルを切替。

## 設定項目（settings.json）

| 設定キー | 既定値 | 説明 |
| --- | --- | --- |
| `livePreview.fontSize` | `14` | エディタのフォントサイズ (px, 8〜40 にクランプ) |
| `livePreview.followActiveEditor` | `true` | 最後に操作した Live Preview ビューアをアクティブな Markdown ソースへ追従 |

設定変更は開いているエディタへ即時反映されます。

## エッジケース対応

- ネストしたリスト（リスト内リスト、リスト内コードブロック）
- コードブロック内の `#` / `**` / `` ` `` などを誤装飾しない
- 未終了フェンスの安全な扱い
- IME 入力中（日本語変換中）は同期を遅延し装飾ちらつきを防止
- 大きいファイル（数千行）では装飾範囲をビューポート内に限定
- Webview レンダリング失敗時は警告を表示し、安全な無装飾表示を維持
- Webview の編集は最小差分で適用し、VS Code 標準の Undo/Redo 粒度を維持
- CRLF 行末のファイルでも正しく動作し、保存時に EOL を維持

## 使い方

1. 拡張をインストール
2. `*.md` は VS Code 標準テキストエディタ（ソース）で開きます。標準エディタのタイトルバーの **目アイコン**（`Live Preview エディタで開く`）で、編集可能な Live Preview ビューアを横に開きます。
3. `livePreview.followActiveEditor`（既定 `true`）が有効な場合、最後に操作した Live Preview ビューアがアクティブな Markdown ソースへ追従します。同じ URI のビューアは重複作成されません。
4. `<details>` アコーディオンは `<summary>` をクリックして開閉します（本文の編集は標準エディタで行ってください）。
5. Live Preview 表示中にリンク先（`.md`）を開くと、その文書の Live Preview ビューアを開きます。既に開いている場合は既存ビューアを再利用します。

Live Preview は custom editor として登録せず、標準テキストエディタ（ソース表示）を置き換えません。

## 開発

```bash
npm install
npm run compile   # 型チェック + esbuild バンドル
npm test          # Vitest
npm run package    # VSIX 生成
```

## ライセンス

MIT
