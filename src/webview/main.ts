/**
 * Webview entry point. Boots a CodeMirror 6 editor, wires the live-preview
 * decoration plugin, and bridges document changes to/from the extension host
 * over `postMessage`.
 */
import { EditorState, Transaction, StateEffect, StateField } from '@codemirror/state';
import { EditorView, ViewUpdate, DecorationSet, ViewPlugin, keymap, drawSelection } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { buildDecorations, setResourceBase, setFontSize } from './decorations';
import { computeRemotePatch, shouldApplyRemoteUpdate, shouldEmitEdit, shouldFlushComposition } from '../core/sync';
import { dedupeUrisAgainstFiles, hasMediaPayload, parseUriList } from '../core/pasteLink';
import { toggleWrap, WrapResult } from '../core/format';
import { continueList, changeIndent, toggleHeading, shouldOpenLinkOnMouseDown } from '../core/editing';
import { LineWindow, viewportWindow, zoomFontSize } from '../core/viewport';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

let fontSize = 14;
let binding = 0;
/** True while we are applying an edit that came from the extension host, so we
 *  do not echo it straight back and create a feedback loop. */
let applyingRemote = false;
let editVersion = 0;
let pendingCompositionChange = false;
let pendingRemote: { text: string; baseVersion: number | undefined } | undefined;

// Decorations are provided via a StateField (not a ViewPlugin): CodeMirror
// forbids block decorations — used by the HTML table widget — from plugins.
let renderErrorReported = false;
function onRenderError(message: string) {
  // Warn once through the host. The editable viewer remains open.
  if (!renderErrorReported) {
    renderErrorReported = true;
    vscode.postMessage({ type: 'renderError', message, binding });
  }
}

const setViewport = StateEffect.define<LineWindow>();

interface LivePreviewFieldValue {
  decorations: DecorationSet;
  lineRange: LineWindow | undefined;
}

function includeSelectionLines(state: EditorState, lineRange: LineWindow | undefined): LineWindow | undefined {
  if (!lineRange) return undefined;

  let startLine = lineRange.startLine;
  let endLine = lineRange.endLine;
  for (const range of state.selection.ranges) {
    startLine = Math.min(startLine, state.doc.lineAt(range.from).number - 1);
    endLine = Math.max(endLine, state.doc.lineAt(range.to).number - 1);
  }
  return {
    startLine: Math.max(0, Math.min(startLine, state.doc.lines - 1)),
    endLine: Math.max(0, Math.min(endLine, state.doc.lines - 1)),
  };
}

function computeField(state: EditorState, lineRange: LineWindow | undefined): LivePreviewFieldValue {
  const rangeWithSelection = includeSelectionLines(state, lineRange);
  return {
    decorations: buildDecorations(state, { lineRange: rangeWithSelection }, onRenderError),
    lineRange,
  };
}

function livePreviewField() {
  return StateField.define<LivePreviewFieldValue>({
    create: (state) => computeField(state, undefined),
    update(value, tr) {
      let lineRange = value.lineRange;
      let viewportChanged = false;
      for (const effect of tr.effects) {
        if (effect.is(setViewport)) {
          lineRange = effect.value;
          viewportChanged = true;
        }
      }
      // Recompute on edits and cursor/selection moves (cursor line shows raw).
      if (tr.docChanged || tr.selection || viewportChanged) return computeField(tr.state, lineRange);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
  });
}

function sameWindow(a: LineWindow | undefined, b: LineWindow): boolean {
  return !!a && a.startLine === b.startLine && a.endLine === b.endLine;
}

class ViewportDecorationSync {
  private lineRange: LineWindow | undefined;
  private scheduled = false;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  private schedule() {
    if (this.scheduled || this.destroyed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.destroyed) return;

      const doc = this.view.state.doc;
      const firstLine = doc.lineAt(this.view.viewport.from).number - 1;
      const lastLine = doc.lineAt(this.view.viewport.to).number - 1;
      const next = viewportWindow(doc.lines, firstLine, lastLine, 50);
      if (sameWindow(this.lineRange, next)) return;

      this.lineRange = next;
      this.view.dispatch({ effects: setViewport.of(next) });
    });
  }

  update(update: ViewUpdate) {
    if (update.viewportChanged || update.docChanged) this.schedule();
  }

  destroy() {
    this.destroyed = true;
  }
}

const viewportDecorationPlugin = ViewPlugin.fromClass(ViewportDecorationSync);

const selectionLayerMeasureKey = {};

/**
 * Keep CodeMirror's absolutely positioned selection layer as tall as the
 * document. `.cm-layer` uses `contain:size`, so the layer cannot derive a used
 * height from its absolutely positioned selection rectangles (R-28-15).
 */
class SelectionLayerHeightSync {
  private layer: HTMLElement | null = null;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  schedule() {
    this.view.requestMeasure({
      key: selectionLayerMeasureKey,
      read: (view) => ({
        layer: view.dom.querySelector<HTMLElement>('.cm-selectionLayer'),
        contentHeight: view.contentHeight,
      }),
      write: ({ layer, contentHeight }) => {
        if (this.layer && this.layer !== layer) this.layer.style.removeProperty('height');
        this.layer = layer;
        if (layer) {
          const height = `${contentHeight}px`;
          if (layer.style.height !== height) layer.style.height = height;
        }
      },
    });
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.geometryChanged) this.schedule();
  }

  docViewUpdate() {
    // Covers document, decoration, and viewport-driven DOM replacement,
    // including table/details widget updates and their follow-up measurement.
    this.schedule();
  }

  destroy() {
    this.layer?.style.removeProperty('height');
    this.layer = null;
  }
}

const selectionLayerHeightPlugin = ViewPlugin.fromClass(SelectionLayerHeightSync);

function postEdit(text: string) {
  editVersion++;
  vscode.postMessage({ type: 'edit', text, version: editVersion, binding });
}

const syncPlugin = EditorView.updateListener.of((update: ViewUpdate) => {
  if (update.docChanged && update.view.composing) pendingCompositionChange = true;

  const flushedComposition = flushPendingComposition();
  // A normal local edit must be posted before any deferred remote is applied.
  // The composition path has already posted its final edit in flush above.
  if (flushedComposition || !update.docChanged) applyPendingRemote();

  if (flushedComposition) return;

  // Defer during IME composition / remote application to avoid flicker & loops.
  if (!shouldEmitEdit({ docChanged: update.docChanged, composing: update.view.composing, applyingRemote })) {
    return;
  }
  postEdit(update.state.doc.toString());
});

/** Apply a pure {@link WrapResult} to the editor as one transaction. */
function applyWrap(result: WrapResult) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: result.text },
    selection: { anchor: result.selFrom, head: result.selTo },
  });
}

const FORMAT_MARKERS: Record<string, string> = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  highlight: '==',
  code: '`',
};

/** Run a named format toggle on the current selection (keymap + host command). */
function runFormat(kind: string) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  if (FORMAT_MARKERS[kind]) {
    applyWrap(toggleWrap(doc, from, to, FORMAT_MARKERS[kind]));
  }
}

/** Build a keymap command that toggles a symmetric formatting marker. */
function wrapCommand(marker: string) {
  return (target: EditorView): boolean => {
    const { from, to } = target.state.selection.main;
    applyWrap(toggleWrap(target.state.doc.toString(), from, to, marker));
    return true;
  };
}

const formatKeymap = keymap.of([
  { key: 'Mod-b', run: wrapCommand('**') },
  { key: 'Mod-i', run: wrapCommand('*') },
  { key: 'Mod-Shift-x', run: wrapCommand('~~') },
  { key: 'Mod-Shift-h', run: wrapCommand('==') },
  { key: 'Mod-e', run: wrapCommand('`') },
]);

/** Enter: continue or terminate a Markdown list. */
function handleEnter(target: EditorView): boolean {
  const { from, to } = target.state.selection.main;
  if (from !== to) return false;
  const line = target.state.doc.lineAt(from);
  const cont = continueList(line.text);
  if (!cont.isList) return false;
  if (cont.removeMarker) {
    target.dispatch({
      changes: { from: line.from, to: line.from + cont.markerLength, insert: '' },
      selection: { anchor: line.from },
    });
    return true;
  }
  target.dispatch({
    changes: { from, to, insert: '\n' + cont.insert },
    selection: { anchor: from + 1 + cont.insert.length },
  });
  return true;
}

/** Tab / Shift-Tab: indent or outdent a list line. */
function indentCommand(delta: number) {
  return (target: EditorView): boolean => {
    const { from } = target.state.selection.main;
    const line = target.state.doc.lineAt(from);
    if (delta > 0 && !continueList(line.text).isList) return false; // default tab elsewhere
    const { text, shift } = changeIndent(line.text, delta);
    if (text === line.text) return delta < 0; // nothing to outdent
    target.dispatch({
      changes: { from: line.from, to: line.from + line.text.length, insert: text },
      selection: { anchor: Math.max(line.from, from + shift) },
    });
    return true;
  };
}

/** Mod-Alt-N: toggle ATX heading level N on the current line. */
function headingCommand(level: number) {
  return (target: EditorView): boolean => {
    const { from } = target.state.selection.main;
    const line = target.state.doc.lineAt(from);
    const text = toggleHeading(line.text, level);
    target.dispatch({
      changes: { from: line.from, to: line.from + line.text.length, insert: text },
      selection: { anchor: line.from + text.length },
    });
    return true;
  };
}

/**
 * Up/Down arrow that steps exactly one *source* line when the caret would
 * otherwise jump across a collapsed block widget (table / `<details>`).
 *
 * Block widgets (`block: true` replace decorations) are atomic: CodeMirror's
 * default `cursorLineUp/Down` skips the entire block in one keystroke, so a
 * table or accordion spanning N source lines made the arrow appear to "jump"
 * several lines at once (R-28-12). We detect that case by comparing the source
 * line CodeMirror would land on against the current one: if it jumped more than
 * one source line (only possible across a block widget — wrapped paragraphs move
 * by visual line and stay on the same/adjacent source line), we override and
 * land on the immediately adjacent source line instead. Normal moves (including
 * wrapped-paragraph visual-line moves) fall through to the default unchanged.
 */
function lineStepCommand(dir: -1 | 1) {
  return (target: EditorView): boolean => {
    const sel = target.state.selection.main;
    if (sel.from !== sel.to) return false; // only for a collapsed caret
    const doc = target.state.doc;
    const curLine = doc.lineAt(sel.head).number; // 1-based
    // Where would CodeMirror's default vertical move land?
    const movedPos = target.moveVertically(sel, dir > 0).head;
    const movedLine = doc.lineAt(movedPos).number;
    // Jumped more than one source line → it skipped over a block widget.
    if (Math.abs(movedLine - curLine) > 1) {
      const targetLine = curLine + dir;
      if (targetLine < 1 || targetLine > doc.lines) return false; // at the edge
      const anchor = doc.line(targetLine).from;
      target.dispatch({ selection: { anchor }, scrollIntoView: true });
      return true;
    }
    return false; // normal case: let the default keymap handle it
  };
}

const arrowKeymap = keymap.of([
  { key: 'ArrowUp', run: lineStepCommand(-1) },
  { key: 'ArrowDown', run: lineStepCommand(1) },
]);

const editingKeymap = keymap.of([
  { key: 'Enter', run: handleEnter },
  { key: 'Tab', run: indentCommand(1) },
  { key: 'Shift-Tab', run: indentCommand(-1) },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ key: `Mod-Alt-${n}`, run: headingCommand(n) })),
]);

function makeState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      history(),
      formatKeymap,
      arrowKeymap,
      editingKeymap,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      livePreviewField(),
      viewportDecorationPlugin,
      syncPlugin,
      EditorView.lineWrapping,
      // Draw CodeMirror's own cursor/selection elements so we can style the
      // caret with the VS Code cursor color (R-28-02).
      drawSelection(),
      selectionLayerHeightPlugin,
      EditorView.theme({}),
    ],
  });
}

const view = new EditorView({
  state: makeState(''),
  parent: document.getElementById('editor')!,
});

/** Send a composition's final full document exactly once, after it is settled. */
function flushPendingComposition(): boolean {
  if (!shouldFlushComposition({ composing: view.composing, pendingCompositionChange, applyingRemote })) {
    return false;
  }
  pendingCompositionChange = false;
  postEdit(view.state.doc.toString());
  return true;
}

/** Re-check a deferred host update only after any local IME acknowledgement. */
function applyPendingRemote(): void {
  if (view.composing || applyingRemote || pendingRemote === undefined) return;
  const remote = pendingRemote;
  pendingRemote = undefined;
  if (
    shouldApplyRemoteUpdate({
      baseVersion: remote.baseVersion,
      localVersion: editVersion,
      composing: false,
    }) &&
    remote.text !== view.state.doc.toString()
  ) {
    setText(remote.text);
  }
}

// CodeMirror need not dispatch another ViewUpdate after an IME confirmation.
// Read its final state in a microtask after the editor's own event handler.
view.dom.addEventListener('compositionend', () => {
  queueMicrotask(() => {
    flushPendingComposition();
    applyPendingRemote();
  });
});

function requestSelectionLayerHeightSync() {
  view.plugin(selectionLayerHeightPlugin)?.schedule();
}

// Click routing for interactive widgets (task checkboxes, links, tables).
//
// Registered on the CAPTURE phase so it runs *before* CodeMirror's own
// mousedown handler. Otherwise CodeMirror moves the selection onto the clicked
// line first, re-rendering the task line to its raw `- [ ]` form, which made the
// checkbox toggle feel like it did nothing (R-28-03). For the checkbox we
// `stopImmediatePropagation` so CodeMirror never sees the event at all.
view.dom.addEventListener(
  'mousedown',
  (event) => {
    const el = event.target as HTMLElement;
    // Task checkbox → toggle the source line via the host. Handle this BEFORE
    // any other widget branch (details/table) so a checkbox nested inside other
    // rendered content still toggles rather than moving the caret.
    const box = el.closest('.cm-lp-task-checkbox');
    if (box) {
      // Fully swallow the event: prevent the default text-selection behaviour
      // and keep CodeMirror's mousedown handler (same DOM node, capture phase)
      // from running so the caret does not jump onto this line.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      try {
        const pos = view.posAtDOM(box as HTMLElement);
        const line = view.state.doc.lineAt(pos).number - 1; // 0-based
        vscode.postMessage({ type: 'toggleTask', line, binding });
      } catch {
        /* widget not currently mapped (mid-render); ignore this click */
      }
      return;
    }
    // Standard link / autolink → open externally or as a workspace file.
    const href = el.closest('[data-href]') as HTMLElement | null;
    if (href) {
      // Only primary-button presses navigate. In particular, leave secondary
      // presses entirely untouched so the Webview context menu can open.
      if (!shouldOpenLinkOnMouseDown(event.button)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      vscode.postMessage({ type: 'openLink', href: href.getAttribute('data-href'), binding });
      return;
    }
    // Rendered <details> accordion (viewer-only). Clicking the summary toggles
    // open/close (native <details>); clicking elsewhere in the widget is
    // swallowed so CodeMirror's default mousedown does not move the caret to the
    // block start. The block is not editable in-place.
    const details = el.closest('.cm-lp-details');
    if (details) {
      if (el.closest('.cm-lp-details-summary')) return; // let native toggle run
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Rendered table → move the caret to the clicked row's source line so the
    // block becomes "active" on re-render and its cells turn into editable raw
    // `| a | b |` text (R-22-02). We read `data-line` (0-based) off the clicked
    // `<tr>`; the delimiter row has none. Without a data-line, swallow the click
    // (legacy behaviour) so the caret does not jump to the block start.
    const table = el.closest('.cm-lp-table');
    if (table) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const tr = el.closest('tr');
      const dl = tr?.getAttribute('data-line');
      if (dl != null) {
        try {
          const anchor = view.state.doc.line(Number(dl) + 1).from; // doc.line is 1-based
          view.dispatch({ selection: { anchor } });
          view.focus();
        } catch {
          /* line out of range mid-render; ignore */
        }
      }
    }
  },
  true, // capture phase
);

// --- Paste / drop of images and files ---------------------------------------
//
// Collect binary files (clipboard image paste, OS file drop) and dropped
// workspace URIs, then hand them to the host to save/relativize. Only prevent
// the default action when there is media to handle; plain text paste/drop is
// left entirely to CodeMirror (R-29).
async function collectAndSendMedia(dataTransfer: DataTransfer | null): Promise<boolean> {
  if (!dataTransfer) return false;

  const files: File[] = [];
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) files.push(dataTransfer.files[i]);
  } else if (dataTransfer.items) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }

  const uris = dedupeUrisAgainstFiles(
    parseUriList(dataTransfer.getData('text/uri-list')),
    files.map((file) => file.name),
  );

  if (files.length === 0 && uris.length === 0) return false;

  const payloadFiles = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
    })),
  );

  vscode.postMessage({
    type: 'pasteMedia',
    binding,
    files: payloadFiles,
    uris,
  });
  return true;
}

view.dom.addEventListener('paste', (event) => {
  const dt = (event as ClipboardEvent).clipboardData;
  const fileCount = !dt ? 0 : (dt.files?.length ?? 0) ||
    (dt.items ? Array.from(dt.items).filter((i) => i.kind === 'file').length : 0);
  const hasMedia = !!dt && hasMediaPayload({ fileCount, uris: parseUriList(dt.getData('text/uri-list')) });
  if (!hasMedia) return; // plain text paste → CodeMirror default
  event.preventDefault();
  void collectAndSendMedia(dt);
});

view.dom.addEventListener('drop', (event) => {
  const dt = (event as DragEvent).dataTransfer;
  const fileCount = !dt ? 0 : (dt.files?.length ?? 0) ||
    (dt.items ? Array.from(dt.items).filter((i) => i.kind === 'file').length : 0);
  const hasMedia = !!dt && hasMediaPayload({ fileCount, uris: parseUriList(dt.getData('text/uri-list')) });
  if (!hasMedia) return; // plain text drop → CodeMirror default
  event.preventDefault();
  // Move the caret to the drop position before inserting.
  try {
    const pos = view.posAtCoords({ x: (event as DragEvent).clientX, y: (event as DragEvent).clientY });
    if (pos != null) view.dispatch({ selection: { anchor: pos } });
  } catch {
    /* ignore unmapped coords */
  }
  void collectAndSendMedia(dt);
});

/** Insert a host-provided media snippet at the current selection (R-29). */
function insertMedia(text: string, placeholderFrom: number, placeholderTo: number) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + placeholderFrom, head: from + placeholderTo },
  });
  view.focus();
}

interface FontSizeScrollAnchor {
  pos: number;
  pointerY: number;
  offsetY: number;
}

function applyFontSize(size: number, scrollAnchor?: FontSizeScrollAnchor) {
  fontSize = size;
  (document.getElementById('editor') as HTMLElement).style.fontSize = `${size}px`;
  // Keep the decoration layer's block-height estimates in sync with the font
  // size so `posAtCoords` stays accurate below tables/accordions (R-28-11).
  setFontSize(size);
  // Font changes invalidate both CodeMirror's height oracle and the selection
  // layer's document-height synchronization (R-28-14 / R-28-15).
  requestAnimationFrame(() => {
    view.requestMeasure({
      read: (target) => {
        if (!scrollAnchor) return null;
        const coords = target.coordsAtPos(scrollAnchor.pos);
        return coords ? coords.top + scrollAnchor.offsetY - scrollAnchor.pointerY : null;
      },
      write: (scrollDelta) => {
        if (scrollDelta != null) view.scrollDOM.scrollTop += scrollDelta;
      },
    });
    requestSelectionLayerHeightSync();
  });
}

// Ctrl/Cmd + mouse wheel changes only this Webview tab's effective font size.
// The host setting is not mutated, and unmodified wheel events remain entirely
// under CodeMirror/browser control (R-28-16).
view.dom.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();

    const nextSize = zoomFontSize(fontSize, event.deltaY);
    if (nextSize === fontSize) return;

    let scrollAnchor: FontSizeScrollAnchor | undefined;
    try {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos != null) {
        const coords = view.coordsAtPos(pos);
        if (coords) {
          scrollAnchor = {
            pos,
            pointerY: event.clientY,
            offsetY: event.clientY - coords.top,
          };
        }
      }
    } catch {
      // A transient unmapped widget should not prevent the zoom itself.
    }

    applyFontSize(nextSize, scrollAnchor);
  },
  { passive: false },
);

function setText(text: string) {
  const doc = view.state.doc.toString();
  if (doc === text) return;

  // Apply only the minimal changed range (common prefix/suffix trimmed) so the
  // dispatch does not touch — and thus does not scroll to — unrelated lines
  // (R-08-07). The primary selection is remapped through the patch so that a
  // resync whose replaced range covers the typing line keeps the caret at its
  // equivalent logical position instead of collapsing it to the range start
  // (which would roll the caret back before the typing position).
  const sel = view.state.selection.main;
  const patch = computeRemotePatch(doc, text, { anchor: sel.anchor, head: sel.head });

  applyingRemote = true;
  try {
    view.dispatch({
      changes: { from: patch.from, to: patch.to, insert: patch.insert },
      selection: { anchor: patch.anchor, head: patch.head },
      annotations: Transaction.addToHistory.of(false),
    });
  } finally {
    applyingRemote = false;
  }
}

// --- Messages from the extension host ----------------------------------------
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      if (typeof msg.binding === 'number') binding = msg.binding;
      editVersion = 0;
      pendingCompositionChange = false;
      pendingRemote = undefined;
      renderErrorReported = false;
      applyFontSize(msg.fontSize ?? 14);
      if (typeof msg.resourceBase === 'string') setResourceBase(msg.resourceBase);
      // Blocks start expanded; the user folds/unfolds via the ▸/▾ gutter.
      view.setState(makeState(msg.text ?? ''));
      requestAnimationFrame(() => {
        view.requestMeasure();
        requestSelectionLayerHeightSync();
      });
      break;
    case 'update': // external / host-side document change
      if (msg.binding !== binding) break;
      if (
        !shouldApplyRemoteUpdate({
          baseVersion: msg.baseVersion,
          localVersion: editVersion,
          composing: view.composing,
        })
      ) {
        const blockedOnlyByComposition =
          view.composing &&
          shouldApplyRemoteUpdate({
            baseVersion: msg.baseVersion,
            localVersion: editVersion,
            composing: false,
          });
        if (blockedOnlyByComposition && typeof msg.text === 'string') {
          pendingRemote = { text: msg.text, baseVersion: msg.baseVersion };
        }
        break;
      }
      if (msg.text !== view.state.doc.toString()) setText(msg.text);
      break;
    case 'settings':
      if (typeof msg.fontSize === 'number') applyFontSize(msg.fontSize);
      break;
    case 'format':
      if (typeof msg.kind === 'string') runFormat(msg.kind);
      break;
    case 'insertMedia':
      if (msg.binding !== binding) break;
      if (
        typeof msg.text === 'string' &&
        typeof msg.placeholderFrom === 'number' &&
        typeof msg.placeholderTo === 'number'
      ) {
        insertMedia(msg.text, msg.placeholderFrom, msg.placeholderTo);
      }
      break;
  }
});

// Tell the host we are ready to receive the initial document.
vscode.postMessage({ type: 'ready' });

// The host uses the last-interacted viewer when active source editors change or
// formatting commands are invoked after focus has returned to the source.
window.addEventListener('focus', () => vscode.postMessage({ type: 'interacted' }));
view.dom.addEventListener('pointerdown', () => vscode.postMessage({ type: 'interacted' }), true);
