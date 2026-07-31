# Live Preview Editor (vscode-livepreview-editor)

見た目のまま Markdown を編集できるライブプレビューエディタです。カーソル行だけ生の記法を表示し、それ以外は装飾・描画された見た目で表示します。数式・Mermaid 図・GitHub Alerts・コードのシンタックスハイライトもその場で描画します。

## インストール

VS Code Marketplace から直接インストールできます。

1. VS Code の拡張機能パネル（`Ctrl+Shift+X`）を開く
2. `Markdown ライブプレビューエディタ` で検索
3. **インストール** をクリック

または、コマンドパレット（`Ctrl+Shift+P`）で `ext install Hashi-Kazu.vscode-livepreview-editor` を実行。

## 使い方（最短手順）

1. `.md` ファイルを開く（既定では VS Code 標準テキストエディタで開きます）
2. 次のいずれかで Live Preview エディタを開く
   - タイトルバーの **Live Preview アイコン**（`Live Preview エディタで開く`）
   - エクスプローラーでファイルを右クリック → `Live Preview エディタで開く`
   - コマンドパレット（`Ctrl+Shift+P`）で `Live Preview: Live Preview エディタで開く`
3. ソースエディタの横（`ViewColumn.Beside`）に Live Preview エディタが開きます

## 主な機能

- カーソル行は生記法、それ以外の行は装飾表示（Obsidian ライク）
- **数式レンダリング** — インライン `$…$` / ブロック `$$…$$` を KaTeX で描画
- **Mermaid ダイアグラム** — ` ```mermaid ` ブロックを SVG 描画。編集は右クリックメニューの「Mermaid を編集」でオプトイン
- **GitHub Alerts** — `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` を種別ごとのアイコン付きカードで表示
- **コードブロック** — 言語別のシンタックスハイライトと、ブロック枠上の言語ラベル表示
- **見出しセクションの折りたたみ** — `#` 見出し単位で、ガターのシェブロンから折りたたみ／展開
- **表の編集** — セルのダブルクリック（または右クリック「セルを編集」）でインライン編集。右クリックメニューから行／列の挿入・削除。「Markdownコードを直接編集」で生ソースへ切り替え
- **画像・ファイルのペースト/ドロップ** — 画像バイナリは `assets/` へ保存してリンクを自動挿入。ワークスペース内ファイルは相対リンクとして挿入
- **URL の自動リンク化** — 単体の HTTP/HTTPS URL をペーストすると、選択ありなら `[選択テキスト](URL)`、選択なしなら `[text](URL)` に自動変換
- **ソースエディタとの縦スクロール同期**
- 入れ子引用（最大6段）・ネストしたリストの階層表示
- `<details>` アコーディオンの描画（`<summary>` クリックで開閉）。右クリックメニュー「Markdownコードを直接編集」でキャレットがブロック内にある間だけ生ソース編集に切り替え可能
- 外部ファイル変更（Git pull・他エディタでの編集）を検知して再同期
- Undo/Redo は VS Code へ委譲し、ソースエディタと履歴を共有

## キーボードショートカット

| 操作 | Windows/Linux | mac |
| --- | --- | --- |
| 太字 | `Ctrl+B` | `Cmd+B` |
| 斜体 | `Ctrl+I` | `Cmd+I` |
| 取り消し線 | `Ctrl+Shift+X` | `Cmd+Shift+X` |
| ハイライト | `Ctrl+Shift+H` | `Cmd+Shift+H` |
| インラインコード | `Ctrl+E` | `Cmd+E` |
| 見出しレベル切替（1〜6） | `Ctrl+Alt+1`〜`6` | `Cmd+Alt+1`〜`6` |
| インデント / アウトデント | `Tab` / `Shift+Tab` | `Tab` / `Shift+Tab` |
| リスト項目の継続 | `Enter` | `Enter` |
| 保存 | `Ctrl+S` | `Cmd+S` |
| Undo | `Ctrl+Z` | `Cmd+Z` |
| Redo | `Ctrl+Shift+Z` / `Ctrl+Y` | `Cmd+Shift+Z` |

フォーマットショートカットはコマンドパレットの `Live Preview: …` からも実行できます。

## 対応記法

| 記法 | 例 | 備考 |
| --- | --- | --- |
| 見出し | `# 〜 ######` | 折りたたみ対応 |
| 太字 / 斜体 | `**text**` / `*text*` | |
| 取り消し線 / ハイライト | `~~text~~` / `==text==` | |
| インラインコード | `` `code` `` | |
| コードブロック | ` ```lang … ``` ` | 言語別シンタックスハイライト |
| リスト | `- item` / `1. item` | ネスト表示対応 |
| タスク | `- [ ]` / `- [x]`（クリックで完了トグル） | |
| 引用 | `> quote` | 入れ子（最大6段）対応 |
| 水平線 | `---` / `***` / `___` | |
| リンク | `[text](url)`（クリックで遷移） | |
| オートリンク | `<https://…>` / `<a@b.com>` | |
| 画像 | `![alt](url)`（実描画） | ペースト/ドロップで自動挿入 |
| 表 | `\| a \| b \|`（HTML テーブル描画） | セル編集・行列操作対応 |
| 数式 | `$inline$` / `$$block$$` | KaTeX 描画 |
| Mermaid | ` ```mermaid … ``` ` | SVG 描画、右クリックで編集 |
| GitHub Alerts | `> [!NOTE]` など | 種別カード表示 |
| エスケープ | `\*` `\#` 等 | |
| `<details>` アコーディオン | `<details><summary>…</summary>…</details>` | 通常はウィジェット描画。右クリックで生ソース編集可 |

## 右クリックメニューでできること

- **表のセル** — セルの編集、行／列の挿入・削除、Markdown コードを直接編集
- **`<details>` アコーディオン** — Markdown コードを直接編集（キャレットがブロック内にある間だけ生ソース編集に切り替え）
- **Mermaid ブロック** — Mermaid を編集（生の Mermaid 記法を編集するモードへ切り替え）

## 設定項目（settings.json）

| 設定キー | 既定値 | 説明 |
| --- | --- | --- |
| `livePreview.fontSize` | `14` | エディタのフォントサイズ (px, 8〜40 にクランプ) |

設定変更は開いているエディタへ即時反映されます。

## 制限事項・注意

- Live Preview は `priority: option` の Custom Text Editor として登録され、`*.md` の既定エディタは引き続き標準テキストエディタ（ソース表示）です。明示的に「Live Preview エディタで開く」を選んだときだけ使われます。
- ライブ編集の対象は標準 Markdown 記法（CommonMark + GFM）です。HTML タグは基本的にビューア（描画）扱いで、生ソース編集は右クリックメニューから明示的に切り替えたときだけ行えます。
- Undo/Redo は VS Code へ委譲し、標準ソースエディタと履歴を共有します。
- CRLF 行末のファイルでも正しく動作し、保存時に EOL を維持します。
- IME 入力中（日本語変換中）は同期を遅延し、装飾のちらつきを防止します。
- 大きいファイル（数千行）では装飾範囲をビューポート内に限定して描画します。

## 開発

```bash
npm install
npm run compile   # 型チェック + esbuild バンドル
npm test          # Vitest
npm run package    # VSIX 生成
```

## ライセンス

MIT
