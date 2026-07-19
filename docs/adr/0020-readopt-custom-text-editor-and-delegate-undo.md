---
name: readopt-custom-text-editor-and-delegate-undo
description: CustomTextEditorProvider を再採用し、Undo/Redo を VS Code へ委譲する
metadata:
  type: project
---

# ADR-0020: CustomTextEditorProvider の再採用と Undo/Redo の VS Code 委譲

- **ステータス**: 採択済み（v1.36.0）
- **確信度**: 高（src/extension.ts・src/livePreviewCustomEditorProvider.ts・src/core/editing.ts・package.json から明示的に確認）

## コンテキスト

ADR-0015（editable WebviewPanel ビューア）は、ソース横表示・複数文書ビューア・active editor follow を実現するために CustomTextEditorProvider（ADR-0005）を廃止して WebviewPanel 方式へ移行した。しかし WebviewPanel 方式には次の課題が蓄積した。

- WebviewPanel は `CustomTextEditor` ではないため、パネル自体に dirty バッジが出ず、未保存状態の可視化を独自インジケータ（R-31）で補う必要があった。
- Ctrl+S が下層 TextDocument に届かないため保存経路を自前で組み、`workspace.openTextDocument` の再取得・binding generation・URI 所有者マップ・active editor follow・文書切り替え・リネーム/削除の再バインドなど、VS Code が本来管理する責務を extension host が肩代わりしていた。
- Undo/Redo を CodeMirror history が単独所有していた（ADR-0017）ため、保存参加者・format-on-save のエコーが Undo を壊さないよう `SelfSaveGuard`／`isSaveParticipantNormalization`／`preserveHistory`／`isTrailingNewlineOnlyDifference` など複雑な保存正規化レコンサイルを保守する必要があった。
- パネルとタブの二重管理、ソースタブ自動再表示への backstop など、周辺の複雑さが増していた。

## 決定

Live Preview を再び `CustomTextEditorProvider`（viewType `livePreview.editor`、`priority: option`、`filenamePattern: *.md`）として登録する。

- 各エディタ（`LivePreviewEditorSession`）は `resolveCustomTextEditor` が渡す**単一 TextDocument に生涯バインド**する。active editor follow・URI 所有者マップ・`workspace.openTextDocument` 再取得・binding generation・文書切り替え・リネーム/削除の再バインドは持たない（VS Code が管理する）。
- `livePreview.openWith` は `vscode.openWith` でソース横（`ViewColumn.Beside`）に開く。`supportsMultipleEditorsPerDocument: false` により同一リソースは複製せず既存エディタを reveal する。`retainContextWhenHidden: true`。
- **Undo/Redo は VS Code へ委譲する**。Webview（CodeMirror）は history を持たず、`classifyUndoRedoKey`（`src/core/editing.ts`）で `Ctrl/Cmd+Z`=undo・`Ctrl/Cmd+Shift+Z`／`Ctrl+Y`(非Cmd)=redo・`Ctrl/Cmd+S`=save を分類して host へ転送する。host は pending edit を flush してから `executeCommand('undo'|'redo')`／`document.save()` を実行する。
- 保存は デバウンスバッチ apply＋即時保存（ADR-0019、`EDIT_APPLY_DEBOUNCE_MS`=200ms）と明示保存（Webview の Ctrl+S 転送）を維持し、per-editor の serial operation queue で直列化する。
- 同期は最小差分 `WorkspaceEdit`（`diffRange`＋`fromLFPreserving`）、self-echo ledger（`consumeExpectedWorkspaceEditChange`）、外部変更の一方向反映（`reconcileExternalChange`）に単純化する。CodeMirror が history を持たないため、外部反映は EditorState の単純置換で足りる。

## 理由

- TextDocument の管理・保存・dirty 表示・Undo/Redo・リネーム/削除追随を VS Code に委譲でき、extension host の責務が大幅に減る。
- Undo/Redo をソースエディタと共有でき、履歴の二重管理と保存正規化レコンサイルの複雑さを排除できる。
- `priority: option` により標準テキストエディタを既定として維持しつつ、「Live Preview エディタで開く」を選択肢として提供できる。

## 影響

- **ADR-0005（CustomTextEditorProvider の採用）を復活**させる（本 ADR で再採用）。
- **ADR-0015（editable WebviewPanel ビューア）を廃止**する（本 ADR で置換）。active editor follow・URI 単一所有・queued rebinding は撤去。
- **ADR-0017 の「CodeMirror 単独 Undo」を supersede** する（Undo/Redo は VS Code へ委譲、CodeMirror history は撤去）。ack・self-echo ledger の考え方は維持。
- **ADR-0018/0019** の保存経路の根拠（「WebviewPanel は CustomTextEditor ではないため Ctrl+S が届かない」等）は変わる。Webview がキーを横取りして host へ転送する点、デバウンス apply＋即時保存、flush 点の統一は不変。
- 旧設計のデッドコード（`src/livePreviewViewerManager.ts`・`src/core/viewer.ts`・`SelfSaveGuard`）を除去。
- 実挙動（Undo/Redo・保存・リネーム追随）の確認は VS Code 上の手動受け入れが必要。純粋ロジック・host sync 契約テスト（`test/customEditor.provider.test.ts`）の非回帰と compile 通過で担保する。
</content>
