---
name: codemirror-history-and-ack-sync
description: CodeMirror owns Live Preview undo history while the host acknowledges accepted snapshots.
metadata:
  type: project
---

# ADR-0017: CodeMirror history and acknowledgement sync

> **一部 supersede（v1.36.0、ADR-0020）**: 「CodeMirror `history()` が Live Preview の Undo/Redo を単独所有する」という決定は、CustomTextEditorProvider の再採用に伴い撤回した。Undo/Redo は VS Code へ委譲し（`classifyUndoRedoKey` で host へ転送、host が `executeCommand('undo'|'redo')` を実行）、CodeMirror history と保存正規化の history 保持レコンサイル（`SelfSaveGuard`／`isSaveParticipantNormalization`／`preserveHistory`／`isTrailingNewlineOnlyDifference`）は撤去した。monotonic version の ack と self-echo ledger（`consumeExpectedWorkspaceEditChange`）で自己エコーを識別する考え方は維持する。以下は経緯として残す。

## Context

The Webview and the VS Code TextDocument update asynchronously. Treating a
document-change echo as a CodeMirror transaction leaves inverse history based
on obsolete text, which can resurrect prior content during Undo.

## Decision

- CodeMirror `history()` is the sole owner of Live Preview Undo/Redo. Local
  typing, IME completion, formatting, task toggles, and media insertion are
  normal CodeMirror transactions.
- Every Webview snapshot has a monotonically increasing version. The host
  acknowledges only an applied or no-op snapshot.
- Before `WorkspaceEdit` the host records expected LF text and TextDocument
  version in a version-keyed ledger. Only that pair is consumed as a self echo.
- Any other document change is classified by `classifyDocumentChange`. A
  self-save reconciliation — a save participant or format-on-save rewrite
  detected either by the `SelfSaveGuard` own-save window or by
  `isSaveParticipantNormalization` — is a *history-preserving* resync: the
  Webview applies the `computeRemotePatch` minimal diff under `applyingRemote`
  with `addToHistory.of(false)`, so an explicit save (Ctrl+S) or an on-blur
  flush save while the user is still typing keeps the undo stack intact.
- A save normalization that changed *only* the document's trailing final
  newline (`files.insertFinalNewline` / `files.trimFinalNewlines`, detected by
  `isTrailingNewlineOnlyDifference`) is the one history-preserving case that is
  *not* pushed into CodeMirror. Applying a boundary-newline insert out-of-history
  strands the newline when the user later undoes an earlier edit (the inverse
  change maps around it), inserting a blank line and making undo appear to add
  lines. The host reconciles only its own dirty state; the Webview keeps the
  user content it holds, and the final newline is re-applied on each save.
- Only a genuine external change (Git pull, another editor's real content edit)
  or an `applyEdit` failure rollback is authoritative: the Webview recreates its
  EditorState after mapping selection with `computeRemotePatch`, clearing its
  history.

## Consequences

VS Code source-editor Undo may retain its own WorkspaceEdit history. A source
Undo is external to Live Preview and therefore resets, rather than reuses, the
Webview history.

Because save participants and own-save format-on-save rewrites now reconcile
without discarding history, an explicit or lifecycle-flush save that runs while
the user is still typing no longer clears the user's undo stack; only true
external edits reset it.
