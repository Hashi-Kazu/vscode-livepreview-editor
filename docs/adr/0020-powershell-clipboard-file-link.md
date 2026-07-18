---
name: powershell-clipboard-file-link
description: Host-only Windows PowerShell process reads the OS file clipboard; insertion reuses the Webview insertMedia path.
metadata:
  type: project
---

# ADR-0020: PowerShell によるクリップボードファイルリンク挿入

- **ステータス**: 採択済み
- **確信度**: 中〜高

## コンテキスト

Explorer で Ctrl+C したファイル/フォルダーを、Live Preview ビューアへ Markdown
リンクとして挿入したい（R-29-06）。しかし D&D/paste（R-29-05）と異なり、この
ケースには次の 2 つの構造的制約がある。

- **Webview は OS のファイルクリップボードを読めない。** Explorer の Ctrl+C は
  `text/uri-list` を伴わず、Webview の `paste` イベントからはファイル一覧を取得
  できない。Web 標準の Clipboard API もファイルパス一覧を返さない。
- **WebviewPanel は CustomTextEditor ではない。** `activeTextEditor` /
  `TextEditor.edit()` / `TextEditor.selection` を持たないため、ホストから直接
  ドキュメントの選択位置へテキストを挿入できない。

一方、既存 R-29 には「host が snippet を生成し、request ID と追従選択範囲で
Webview の `insertMedia` が挿入する」経路が既にある。

## 決定

- 明示コマンド `livePreview.pasteFileAsMarkdownLink`（既定キー `ctrl+alt+v` /
  mac `cmd+alt+v`、`when: activeWebviewPanelId == livePreview.viewer`）を追加し、
  Web 標準の Ctrl+V（テキスト貼り付け）は上書きしない。
- OS ファイルクリップボードの読み取りは **Windows 限定**とし、ホスト側で
  **Windows PowerShell 外部プロセス**（`src/clipboard/readClipboardFiles.ts`、
  `powershell.exe -NoProfile -STA -EncodedCommand <UTF-16LE Base64>`、
  `windowsHide`・`timeout 5000`・UTF-8 出力）を `execFile` で起動し、
  `System.Windows.Forms.Clipboard.GetFileDropList()` を compact JSON で得る。
  `-STA` はクリップボード COM API に必須、`-EncodedCommand` と UTF-8 出力は
  日本語・空白・クオートの破損を防ぐ。`pwsh` ではなく `powershell.exe` を使う。
- 外部プロセス依存は本コマンド以外に広げない。JSON 解釈（`parseClipboardFileListJson`）
  と全リンク生成ロジック（`linkLabel` / `folderLinkTarget` / `buildMediaSnippet`
  の `label` / `combineLinks`）は VS Code / node 非依存の純粋関数として
  `src/core/pasteLink.ts` に置き、`child_process` を **Webview バンドルへ絶対に
  混入させない**（host 専用ファイルへ隔離）。
- 挿入は D&D/paste と同じ `insertMedia` 経路を再利用する。ホストは解決済み
  ターゲットを token で退避し `requestClipboardLinkInsertion` を送る→Webview が
  現在 selection を `pendingMediaRequests` へ登録し `clipboardLinkInsertionContext`
  を返す→ホストがスニペットを生成し `insertMedia` で返信する（1 往復、`enqueue`
  で直列化）。`activeTextEditor` 系 API は使わない。
- 相対化は `relativizeUri`（ファイル限定）を破壊せず、ディレクトリ許容の
  `resolveClipboardPath` を別途追加する。挙動は設定 3 種
  （`pasteFileLink.linkText` / `.multipleFilesFormat` / `.outsideWorkspace`）で
  制御する。D&D/paste の出力（複数はスペース結合）は変更しない。

## 理由

- Webview からファイルクリップボードを読めない以上、ホスト側の OS 依存読み取りが
  唯一の実現手段。PowerShell + `System.Windows.Forms.Clipboard` は追加ネイティブ
  依存なしで Windows のファイルドロップリストを読める。
- 純粋関数への隔離により、リンク生成の全分岐（ラベル・フォルダー・結合・別ドライブ）
  を VS Code 非依存で単体テストでき、Webview バンドルの純粋性も保てる。
- 既存 `insertMedia` 経路の再利用で、選択追従・binding 世代・直列化といった既存の
  整合保証をそのまま享受できる。

## 影響

- 本拡張で唯一の外部プロセス依存が加わる（Windows 限定・host 専用ファイル）。
  非 Windows では外部プロセスを起動せず情報メッセージで no-op する。
- PowerShell の起動レイテンシ（数百 ms）を許容する。PowerShell 不在・タイムアウト・
  非ゼロ終了・空クリップボードはすべて空配列＋メッセージで安全に no-op する。
- 実挙動（クリップボード読み取り・キーバインド）の確認は Windows 実機での手動受け
  入れが必要。純粋ロジックの単体テストと compile 通過で機械的部分を担保する。
- キーバインド `ctrl+alt+v` は VS Code 既定・既存拡張キー（`ctrl+b/i/e`、
  `ctrl+shift+x/h`）と非衝突。将来衝突が判明すれば `ctrl+alt+l` 等へ変更可。
