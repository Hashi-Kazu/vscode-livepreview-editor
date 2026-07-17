---
name: codemirror-history-and-ack-sync
description: CodeMirror owns Live Preview undo history while the host acknowledges accepted snapshots.
metadata:
  type: project
---

# ADR-0017: CodeMirror history and acknowledgement sync

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
- Any other document change is authoritative. The Webview recreates its
  EditorState after mapping selection with `computeRemotePatch`, clearing its
  history.

## Consequences

VS Code source-editor Undo may retain its own WorkspaceEdit history. A source
Undo is external to Live Preview and therefore resets, rather than reuses, the
Webview history.
