---
name: editable-webview-panel-viewers
description: ソース横の editable WebviewPanel、URI 単一所有、active editor follow を採用
metadata:
  type: project
---

# ADR-0015: editable WebviewPanel ビューア

- **ステータス**: 採択済み
- **確信度**: 高

## コンテキスト

CustomTextEditorProvider と `vscode.openWith` による同一タブ切り替えは、標準ソースとの同時表示、複数文書の Live Preview、active editor follow に適さず、EditorInput の差によるタブ処理にも依存していた。一方で Webview 側の CodeMirror 編集、最小差分同期、Undo、IME、CRLF は維持する必要がある。

## 決定

Live Preview を `livePreview.viewer` の editable `WebviewPanel` として標準ソースの横に開く。

- URI は 1 ビューアだけが所有し、異なる URI は複数ビューアを許可する。
- `livePreview.followActiveEditor`（既定 `true`）は最後に操作したビューアを active Markdown editor へ追従させる。
- Webview 編集と切り替えを viewer ごとの queue で直列化する。
- binding generation により切り替え前の遅延メッセージを拒否する。
- 編集時は `workspace.openTextDocument(uri)` で TextDocument を再取得し、ソースタブを reveal しない。
- 切り替え時は title、resource roots/base、document listener を再バインドする。
- `customEditors` contribution と `livePreview.toggleSource` を削除する。

## 理由

- ソースと Live Preview を同時に確認できる。
- 異なる文書を並行表示しつつ、同一 URI の競合を防止できる。
- TextDocument の再取得と既存の `WorkspaceEdit` により、ソースタブ終了後も VS Code の undo/EOL/sync モデルを維持できる。
- queue と generation の併用で、保留編集と遅延 message が文書境界を越える競合を防げる。

## 影響

- CustomTextEditorProvider が自動提供していた document binding を extension host が明示的に管理する。
- Viewer lifecycle の UI 結線は VS Code 上の手動受け入れ確認が必要。
- ADR-0005 と ADR-0012 は廃止となる。

## 追記（2026-07-18）

「ソースタブを reveal しない」という決定に反し、`workspace.applyEdit`／`document.save()` の呼び出しが VS Code コア側の副作用として対象 URI のソースタブを自動的に再表示するケースが確認された。この副作用自体は本 ADR の決定範囲外（VS Code コアの挙動）であり抑制できないため、呼び出し直前・直後の可視タブ URI 集合を比較し、新規に出現したタブのみを `vscode.window.tabGroups.close()` で閉じることで補完する（R-03-11、`livePreview.suppressSourceAutoOpen`、既定 `true`）。呼び出し前から可視だったタブ（ユーザーが自発的に開いた可能性がある）は対象外とし、誤って閉じない。
