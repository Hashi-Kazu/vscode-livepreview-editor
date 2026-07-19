---
name: explicit-save-over-idle-autosave
description: Drop per-keystroke idle autosave in favor of explicit save plus lifecycle flush.
metadata:
  type: project
---

# ADR-0018: Explicit save plus lifecycle flush over idle autosave

> **前提の更新（v1.36.0、ADR-0020）**: 本 ADR の「WebviewPanel は `CustomTextEditor` ではないため VS Code の Ctrl+S が下層 TextDocument に届かない」という前提は、CustomTextEditorProvider の再採用で変わった。ただし Webview が `Ctrl+S`/`Cmd+S` を横取り（`classifyUndoRedoKey`）して host へ `save` を転送し、host が `flushPendingEdit`→`document.save()` を実行する点は不変。VS Code 標準の autoSave も TextDocument に対して通常どおり動作する。

> **ステータス**: ADR-0019（2026-07-18）により supersede。v1.29.0 で反映モデルを「タイピング停止後のデバウンスでのバッチ apply＋apply 直後の即時保存」へ変更し、TextDocument が dirty のまま滞留しないようにした。本 ADR が確立した「明示保存＋ライフサイクル flush」および Undo 安全機構は ADR-0019 に引き継がれる（明示保存・flush 点はいずれも即時保存を伴う `flushPendingEdit` 経由に統一）。本文は経緯として残す。

## Context

Until v1.25.x every Webview edit re-armed a 400ms idle timer (`SaveDebouncer`)
that persisted the bound TextDocument once the edit stream went quiet. The
debouncer existed to keep save participants / format-on-save from running per
keystroke, whose asynchronous echoes could be misdetected as external changes
and roll the caret back.

Since v1.25.2 that echo hazard is already handled independently: the
`SelfSaveGuard` own-save window, `isSaveParticipantNormalization`, and the
`preserveHistory` reconcile in `classifyDocumentChange` keep the CodeMirror
undo stack (and the caret) intact across save-participant rewrites regardless of
what triggered the save. With that safety net in place, the idle timer added
complexity (dirty tracking, a scheduler, flush plumbing) without a distinct
purpose, and it diverged from how a standard VS Code editor behaves (save on
Ctrl+S, not on every pause in typing).

## Decision

- Remove `SaveDebouncer` entirely (class, binding field, per-keystroke
  `request()` trigger). Edits still apply immediately as minimal
  `WorkspaceEdit`s (R-04-01); persistence is simply no longer triggered per
  keystroke.
- Persist on **explicit save**: a WebviewPanel is not a `CustomTextEditor`, so
  VS Code's own Ctrl+S never reaches the bound TextDocument. The Webview
  captures `Ctrl+S` / `Cmd+S`, calls `preventDefault`, and posts a `save`
  message; the host runs `performSave` (which no-ops when the document is not
  dirty) on the serial operation queue.
- Persist on **lifecycle flush**: blur (panel loses active focus), disposal, and
  binding switch each call `performSave` directly (replacing the former
  `SaveDebouncer.flush()`), still queued behind already-received edits so no
  typed text is lost (durability, R-03-08).
- Keep the Undo-safety machinery unchanged: `SelfSaveGuard`,
  `isSaveParticipantNormalization`, and the `preserveHistory` reconcile stay,
  because save-participant / format-on-save echoes still occur under explicit
  and on-blur saves.

## Consequences

The save model now matches a standard editor and the code is simpler (no timer,
no dirty flag). Because a WebviewPanel cannot show a dirty badge on the panel
itself, unsaved state is only visible as VS Code's standard dirty dot on the
source tab when that tab is open. A dedicated panel dirty indicator is out of
scope and left as a known limitation.
