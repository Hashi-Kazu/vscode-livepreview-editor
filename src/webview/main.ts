/**
 * Webview entry point. Boots a CodeMirror 6 editor, wires the live-preview
 * decoration plugin, and bridges document changes to/from the extension host
 * over `postMessage`.
 */
import { EditorState, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { EditorView, ViewUpdate, DecorationSet, ViewPlugin, keymap, drawSelection } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, isolateHistory } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { codeFolding, foldGutter, foldKeymap, foldService } from '@codemirror/language';
import { buildDecorations, setResourceBase, setFontSize } from './decorations';
import {
  computeRemotePatch,
  shouldApplyRemoteUpdate,
  shouldEmitEdit,
  shouldFlushComposition,
  toggleTaskAt,
} from '../core/sync';
import { hasMediaPayload, parseDataTransferUris } from '../core/pasteLink';
import { insertTableRow, deleteTableRow, insertTableColumn, deleteTableColumn } from '../core/tableEdit';
import { toggleWrap, WrapResult } from '../core/format';
import { continueList, changeIndent, toggleHeading, shouldOpenLinkOnMouseDown } from '../core/editing';
import { headingFoldRange, scanHeadings, HeadingInfo } from '../core/model';
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
let ackVersion = 0;
let pendingCompositionChange = false;
let pendingRemote:
  | { text: string; baseVersion: number | undefined; rollback?: boolean; preserveHistory?: boolean }
  | undefined;
let nextMediaRequestId = 1;

interface PendingMediaRequest {
  binding: number;
  from: number;
  to: number;
  selectedText: string;
}

// Positions are mapped through every transaction while the host persists the
// dropped data. This prevents a late response from being inserted at whatever
// cursor position the user reached in the meantime.
const pendingMediaRequests = new Map<number, PendingMediaRequest>();

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

/**
 * Recompute the floating outline panel (R-33) whenever the document changes.
 * `scanHeadings` is a full-document pure scanner (not viewport-limited, unlike
 * `computeDecorations` — R-05-05), so the outline stays complete regardless of
 * scroll position. Recomputation is deferred to a microtask so a burst of
 * keystrokes collapses into a single re-render (lightweight debounce).
 */
class OutlineSync {
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
      renderOutline(scanHeadings(this.view.state.doc.toString()));
    });
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.schedule();
  }

  destroy() {
    this.destroyed = true;
  }
}

const outlinePlugin = ViewPlugin.fromClass(OutlineSync);

function postEdit(text: string) {
  editVersion++;
  vscode.postMessage({ type: 'edit', text, version: editVersion, binding });
}

const syncPlugin = EditorView.updateListener.of((update: ViewUpdate) => {
  if (update.docChanged) {
    for (const request of pendingMediaRequests.values()) {
      request.from = update.changes.mapPos(request.from, -1);
      request.to = update.changes.mapPos(request.to, 1);
    }
  }
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

// Defined before the state is created so Prec.highest places these handlers in
// front of CodeMirror's own paste/drop implementation. The helper functions
// are declarations and are hoisted below with the rest of the media bridge.
const mediaDomHandlers = Prec.highest(
  EditorView.domEventHandlers({
    paste(event) {
      const dataTransfer = (event as ClipboardEvent).clipboardData;
      if (!dataTransferHasMedia(dataTransfer)) return false;
      event.preventDefault();
      beginMediaRequest(dataTransfer!);
      return true;
    },
    drop(event, target) {
      const dataTransfer = (event as DragEvent).dataTransfer;
      if (!dataTransferHasMedia(dataTransfer)) return false;
      event.preventDefault();
      try {
        const pos = target.posAtCoords({ x: (event as DragEvent).clientX, y: (event as DragEvent).clientY });
        if (pos != null) target.dispatch({ selection: { anchor: pos } });
      } catch {
        // A transient widget coordinate must not reject an otherwise valid drop.
      }
      beginMediaRequest(dataTransfer!);
      return true;
    },
    dragover(event) {
      const dataTransfer = (event as DragEvent).dataTransfer;
      if (!dataTransferHasMedia(dataTransfer)) return false;
      event.preventDefault();
      return true;
    },
  }),
);

// R-30: fold whole heading sections. The fold range is computed by the pure
// full-document scanner `headingFoldRange` (not the viewport-limited decoration
// pass), so a section is folded correctly even when it spans a code block or
// lies outside the current viewport.
const headingFoldService = foldService.of((state, lineStart) =>
  headingFoldRange(state.doc.toString(), state.doc.lineAt(lineStart).number - 1),
);

function makeState(text: string, selection?: { anchor: number; head: number }): EditorState {
  return EditorState.create({
    doc: text,
    selection,
    extensions: [
      history(),
      formatKeymap,
      arrowKeymap,
      editingKeymap,
      mediaDomHandlers,
      keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
      markdown(),
      // R-30 heading-section folding. `codeFolding()` supplies fold state +
      // placeholder; `headingFoldService` provides heading ranges; `foldGutter`
      // renders the ▼/▶ toggles. The gutter is width-compensated in CSS so the
      // heading/body left edge stays aligned (R-28-07). Sections start expanded.
      codeFolding(),
      headingFoldService,
      foldGutter({ openText: '▼', closedText: '▶' }),
      livePreviewField(),
      viewportDecorationPlugin,
      outlinePlugin,
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

// --- R-31: unsaved indicator --------------------------------------------------
// A fixed overlay outside the CodeMirror DOM so it never interferes with
// decorations, height measurement, or click-position handling. Its visibility
// reflects the host's authoritative `TextDocument.isDirty` only (the Webview
// never estimates dirty state itself).
const unsavedIndicator = document.createElement('div');
unsavedIndicator.className = 'cm-lp-unsaved-indicator';
unsavedIndicator.title = '未保存の変更があります';
document.body.appendChild(unsavedIndicator);

// --- R-33: outline / table-of-contents panel ---------------------------------
// A floating overlay outside the CodeMirror DOM (like the R-31 unsaved
// indicator) so it never interferes with decoration/measure/click-position
// handling inside `.cm-editor` (R-28-13 / R-28-15). Content is display-only;
// the user's Markdown source is never modified by this panel (R-01-02).
const outlinePanel = document.createElement('div');
outlinePanel.className = 'cm-lp-outline-panel';

const outlineToggle = document.createElement('button');
outlineToggle.type = 'button';
outlineToggle.className = 'cm-lp-outline-toggle';
outlineToggle.title = '目次を表示/非表示';
outlineToggle.textContent = '目次';
outlinePanel.appendChild(outlineToggle);

const outlineList = document.createElement('div');
outlineList.className = 'cm-lp-outline-list';
outlinePanel.appendChild(outlineList);

let outlineExpanded = false;
function setOutlineExpanded(expanded: boolean) {
  outlineExpanded = expanded;
  outlinePanel.classList.toggle('is-expanded', expanded);
}
outlineToggle.addEventListener('click', () => setOutlineExpanded(!outlineExpanded));
setOutlineExpanded(false);

document.body.appendChild(outlinePanel);

/** Re-render the outline list from a freshly scanned heading array. */
function renderOutline(headings: HeadingInfo[]) {
  outlineList.textContent = '';
  for (const heading of headings) {
    const item = document.createElement('div');
    item.className = 'cm-lp-outline-item';
    item.style.paddingLeft = `${(heading.level - 1) * 12}px`;
    item.textContent = heading.text || '(見出し)';
    item.dataset.line = String(heading.line);
    outlineList.appendChild(item);
  }
}

// Clicking an outline item moves the caret to the heading line and scrolls it
// into view, without editing the document (R-01-02 / R-33-03).
outlineList.addEventListener('click', (event) => {
  const item = (event.target as HTMLElement).closest<HTMLElement>('.cm-lp-outline-item');
  if (!item?.dataset.line) return;
  const line = Number(item.dataset.line);
  try {
    const anchor = view.state.doc.line(line + 1).from; // doc.line is 1-based
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    view.focus();
  } catch {
    /* stale line number if the document changed just before the click */
  }
});

/** Send a composition's final full document exactly once, after it is settled. */
function flushPendingComposition(): boolean {
  if (!shouldFlushComposition({ composing: view.composing, pendingCompositionChange, applyingRemote })) {
    return false;
  }
  pendingCompositionChange = false;
  postEdit(view.state.doc.toString());
  // A completed composition is one deliberate editing operation. Isolate it
  // from the next composition so repeated IME lines undo monotonically.
  view.dispatch({ annotations: isolateHistory.of('after') });
  return true;
}

/** Re-check a deferred host update only after any local IME acknowledgement. */
function applyPendingRemote(): void {
  if (view.composing || applyingRemote || pendingRemote === undefined) return;
  const remote = pendingRemote;
  pendingRemote = undefined;
  if (shouldApplyRemoteUpdate({
    baseVersion: remote.baseVersion,
    editVersion,
    ackVersion,
    composing: false,
    pendingLocalChange: pendingCompositionChange,
    rollback: remote.rollback,
  })) {
    if (remote.text !== view.state.doc.toString()) setText(remote.text, remote.rollback, remote.preserveHistory);
    else if (remote.rollback) ackVersion = editVersion;
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
    // Task checkbox -- change CodeMirror first, then synchronize through the
    // ordinary local-edit path. This keeps CodeMirror as the only Live Preview
    // undo owner.
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
        const current = view.state.doc.toString();
        const result = toggleTaskAt(current, line);
        if (!result.changed) return;
        const selection = view.state.selection.main;
        const patch = computeRemotePatch(current, result.text, {
          anchor: selection.anchor,
          head: selection.head,
        });
        view.dispatch({
          changes: { from: patch.from, to: patch.to, insert: patch.insert },
          annotations: isolateHistory.of('full'),
        });
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
      // Only the primary button moves the caret into the block (R-22-02). A
      // secondary press is still swallowed above (so CodeMirror does not move
      // the caret either) but leaves the selection untouched, so the R-22-06
      // right-click menu never activates the block (R-22-06).
      const tr = el.closest('tr');
      const dl = tr?.getAttribute('data-line');
      if (dl != null && shouldOpenLinkOnMouseDown(event.button)) {
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

// --- R-22-06: table row/column context menu ----------------------------------
//
// Right-clicking a rendered table cell opens a custom overlay menu (built in
// plain DOM outside the CodeMirror tree) to add/remove rows and columns. The
// body change goes through the SAME path as the checkbox toggle
// (`computeRemotePatch` → `view.dispatch` with `isolateHistory.of('full')`), so
// the existing `syncPlugin` → host `applyEdit` pipeline reflects it as a minimal
// `WorkspaceEdit`. Right-click never moves the caret or activates the block.
let tableMenuEl: HTMLElement | null = null;

function closeTableMenu(): void {
  if (!tableMenuEl) return;
  tableMenuEl.remove();
  tableMenuEl = null;
  document.removeEventListener('mousedown', onDocMouseDownForTableMenu, true);
  document.removeEventListener('keydown', onKeyDownForTableMenu, true);
}

function onDocMouseDownForTableMenu(event: MouseEvent): void {
  if (tableMenuEl && !tableMenuEl.contains(event.target as Node)) closeTableMenu();
}

function onKeyDownForTableMenu(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeTableMenu();
}

/**
 * Locate the table block that starts at `startLine`, run `transform` on its raw
 * source lines, and apply the result as a minimal patch (checkbox toggle path).
 * The block range is the run of consecutive non-empty `|`-bearing lines from the
 * header down (mirrors `detectTableBlocks`).
 */
function applyTableEdit(startLine: number, transform: (lines: string[]) => string[]): void {
  const current = view.state.doc.toString();
  const docLines = current.split('\n');
  if (startLine < 0 || startLine >= docLines.length) return;
  let end = startLine;
  for (let j = startLine + 1; j < docLines.length; j++) {
    if (docLines[j].includes('|') && docLines[j].trim() !== '') end = j;
    else break;
  }
  const block = docLines.slice(startLine, end + 1);
  const next = transform(block);
  if (next.join('\n') === block.join('\n')) return; // guard / no-op
  const nextDoc = docLines.slice(0, startLine).concat(next, docLines.slice(end + 1)).join('\n');
  const sel = view.state.selection.main;
  const patch = computeRemotePatch(current, nextDoc, { anchor: sel.anchor, head: sel.head });
  view.dispatch({
    changes: { from: patch.from, to: patch.to, insert: patch.insert },
    annotations: isolateHistory.of('full'),
  });
}

function showTableMenu(
  x: number,
  y: number,
  startLine: number,
  bodyRowIndex: number,
  col: number,
  isHeader: boolean,
): void {
  closeTableMenu();
  const menu = document.createElement('div');
  menu.className = 'cm-lp-table-menu';
  menu.setAttribute('role', 'menu');

  const addItem = (label: string, enabled: boolean, run: () => void) => {
    const item = document.createElement('div');
    item.className = 'cm-lp-table-menu-item' + (enabled ? '' : ' is-disabled');
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    if (enabled) {
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        run();
        closeTableMenu();
      });
    }
    menu.appendChild(item);
  };
  const addSeparator = () => {
    const sep = document.createElement('div');
    sep.className = 'cm-lp-table-menu-separator';
    menu.appendChild(sep);
  };

  addItem('行を上に挿入', !isHeader, () =>
    applyTableEdit(startLine, (l) => insertTableRow(l, bodyRowIndex === 0 ? 'top' : bodyRowIndex - 1)),
  );
  addItem('行を下に挿入', true, () =>
    applyTableEdit(startLine, (l) => insertTableRow(l, isHeader ? 'top' : bodyRowIndex)),
  );
  addItem('行を削除', !isHeader, () => applyTableEdit(startLine, (l) => deleteTableRow(l, bodyRowIndex)));
  addSeparator();
  addItem('列を左に挿入', true, () => applyTableEdit(startLine, (l) => insertTableColumn(l, col, 'left')));
  addItem('列を右に挿入', true, () => applyTableEdit(startLine, (l) => insertTableColumn(l, col, 'right')));
  addItem('列を削除', true, () => applyTableEdit(startLine, (l) => deleteTableColumn(l, col)));

  // Position within the viewport; append hidden first so we can measure size.
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 4);
  const top = Math.min(y, window.innerHeight - rect.height - 4);
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${Math.max(0, top)}px`;

  tableMenuEl = menu;
  document.addEventListener('mousedown', onDocMouseDownForTableMenu, true);
  document.addEventListener('keydown', onKeyDownForTableMenu, true);
}

view.dom.addEventListener(
  'contextmenu',
  (event) => {
    const el = event.target as HTMLElement;
    const cell = el.closest('.cm-lp-table th, .cm-lp-table td') as HTMLElement | null;
    if (!cell) return; // not a rendered table cell: leave the default menu alone
    // Suppress the default menu and keep CodeMirror from moving the caret.
    event.preventDefault();
    event.stopImmediatePropagation();
    const table = cell.closest('.cm-lp-table');
    const headerTr = table?.querySelector('thead tr');
    const startLine = Number(headerTr?.getAttribute('data-line'));
    if (!Number.isFinite(startLine)) return;
    const col = Number(cell.getAttribute('data-col')) || 0;
    const tr = cell.closest('tr');
    const isHeader = tr?.parentElement?.tagName === 'THEAD';
    const bodyRowIndex = isHeader ? -1 : Number(tr?.getAttribute('data-line')) - startLine - 2;
    showTableMenu(event.clientX, event.clientY, startLine, bodyRowIndex, col, isHeader);
  },
  true, // capture phase
);

// --- Paste / drop of images and files ---------------------------------------
//
// Collect binary files (clipboard image paste, OS file drop) and dropped
// workspace URIs, then hand them to the host to save/relativize. Only prevent
// the default action when there is media to handle; plain text paste/drop is
// left entirely to CodeMirror (R-29).
function filesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let index = 0; index < dataTransfer.files.length; index++) files.push(dataTransfer.files[index]);
  if (files.length > 0) return files;
  for (let index = 0; index < dataTransfer.items.length; index++) {
    const item = dataTransfer.items[index];
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

function uriCandidatesFromDataTransfer(dataTransfer: DataTransfer): string[] {
  return parseDataTransferUris({
    uriList: dataTransfer.getData('text/uri-list'),
    codeUriList: dataTransfer.getData('application/vnd.code.uri-list'),
    plainText: dataTransfer.getData('text/plain'),
  });
}

function dataTransferHasMedia(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return hasMediaPayload({
    fileCount: filesFromDataTransfer(dataTransfer).length,
    uris: uriCandidatesFromDataTransfer(dataTransfer),
  });
}

async function collectAndSendMedia(dataTransfer: DataTransfer, requestId: number): Promise<void> {
  const request = pendingMediaRequests.get(requestId);
  if (!request || request.binding !== binding) return;
  const files = filesFromDataTransfer(dataTransfer);
  const uris = uriCandidatesFromDataTransfer(dataTransfer);
  const payloadFiles = await Promise.all(
    files.map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) })),
  );
  // An authoritative reset/binding switch can occur while File.arrayBuffer()
  // resolves. In that case this request no longer has a valid insertion point.
  if (!pendingMediaRequests.has(requestId) || request.binding !== binding) return;
  vscode.postMessage({
    type: 'pasteMedia',
    binding,
    requestId,
    selectedText: request.selectedText,
    files: payloadFiles,
    uris,
  });
}

function beginMediaRequest(dataTransfer: DataTransfer): void {
  const selection = view.state.selection.main;
  const requestId = nextMediaRequestId++;
  pendingMediaRequests.set(requestId, {
    binding,
    from: selection.from,
    to: selection.to,
    selectedText: selection.from === selection.to ? '' : view.state.sliceDoc(selection.from, selection.to),
  });
  void collectAndSendMedia(dataTransfer, requestId);
}

/** Insert a host-provided media snippet at the request's mapped selection. */
function insertMedia(text: string, placeholderFrom: number, placeholderTo: number, request: PendingMediaRequest) {
  const { from, to } = request;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + placeholderFrom, head: from + placeholderTo },
    annotations: isolateHistory.of('full'),
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

function setText(text: string, rollback = false, preserveHistory = false) {
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
    pendingMediaRequests.clear();
    if (preserveHistory) {
      // A self-save echo (save participant / format-on-save inside our own save
      // window) must reconcile the document without destroying the undo stack
      // the user is still typing against. Apply the minimal patch and keep it
      // out of the history so the just-typed edits remain undoable, while the
      // `applyingRemote` guard prevents echoing it back as a local edit.
      view.dispatch({
        changes: { from: patch.from, to: patch.to, insert: patch.insert },
        selection: { anchor: patch.anchor, head: patch.head },
        annotations: Transaction.addToHistory.of(false),
      });
    } else {
      // An authoritative external document state invalidates every inverse
      // transaction based on the previous text. Replacing EditorState (rather
      // than merely annotating a transaction out of history) makes CodeMirror
      // history the sole owner and prevents old text from reappearing through
      // Undo.
      view.setState(makeState(text, { anchor: patch.anchor, head: patch.head }));
    }
    if (rollback) ackVersion = editVersion;
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
      ackVersion = 0;
      pendingCompositionChange = false;
      pendingRemote = undefined;
      pendingMediaRequests.clear();
      renderErrorReported = false;
      unsavedIndicator.classList.remove('is-visible');
      applyFontSize(msg.fontSize ?? 14);
      if (typeof msg.resourceBase === 'string') setResourceBase(msg.resourceBase);
      // Blocks start expanded; the user folds/unfolds via the ▸/▾ gutter.
      view.setState(makeState(msg.text ?? ''));
      requestAnimationFrame(() => {
        view.requestMeasure();
        requestSelectionLayerHeightSync();
      });
      break;
    case 'ack':
      if (msg.binding !== binding || typeof msg.version !== 'number') break;
      if (Number.isSafeInteger(msg.version) && msg.version > ackVersion && msg.version <= editVersion) {
        ackVersion = msg.version;
      }
      applyPendingRemote();
      break;
    case 'update': // external / host-side document change
      if (msg.binding !== binding) break;
      if (typeof msg.text !== 'string') break;
      if (!shouldApplyRemoteUpdate({
        baseVersion: msg.baseVersion,
        editVersion,
        ackVersion,
        composing: view.composing,
        pendingLocalChange: pendingCompositionChange,
        rollback: msg.rollback === true,
      })) {
        // Keep exactly the latest authoritative update. Once the relevant ack
        // arrives, its base version is checked again before it can affect CM.
        pendingRemote = {
          text: msg.text,
          baseVersion: msg.baseVersion,
          rollback: msg.rollback === true,
          preserveHistory: msg.preserveHistory === true,
        };
        break;
      }
      if (msg.text !== view.state.doc.toString()) setText(msg.text, msg.rollback === true, msg.preserveHistory === true);
      else if (msg.rollback === true) ackVersion = editVersion;
      break;
    case 'settings':
      if (typeof msg.fontSize === 'number') applyFontSize(msg.fontSize);
      break;
    case 'format':
      if (typeof msg.kind === 'string') runFormat(msg.kind);
      break;
    case 'dirty':
      if (msg.binding !== binding) break;
      unsavedIndicator.classList.toggle('is-visible', msg.dirty === true);
      break;
    case 'insertMedia':
      if (msg.binding !== binding) break;
      if (
        typeof msg.requestId === 'number' &&
        typeof msg.text === 'string' &&
        typeof msg.placeholderFrom === 'number' &&
        typeof msg.placeholderTo === 'number'
      ) {
        const request = pendingMediaRequests.get(msg.requestId);
        if (!request || request.binding !== binding) break;
        pendingMediaRequests.delete(msg.requestId);
        insertMedia(msg.text, msg.placeholderFrom, msg.placeholderTo, request);
      }
      break;
  }
});

// Explicit save (Ctrl+S / Cmd+S). A WebviewPanel is not a CustomTextEditor, so
// VS Code's own Ctrl+S never reaches the bound TextDocument. Capture the
// keystroke, suppress the browser "save page" default, and ask the host to
// persist the document (R-03-08).
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S')) {
    event.preventDefault();
    vscode.postMessage({ type: 'save', binding });
  }
});

// Tell the host we are ready to receive the initial document.
vscode.postMessage({ type: 'ready' });

// The host uses the last-interacted viewer when active source editors change or
// formatting commands are invoked after focus has returned to the source.
window.addEventListener('focus', () => vscode.postMessage({ type: 'interacted' }));
view.dom.addEventListener('pointerdown', () => vscode.postMessage({ type: 'interacted' }), true);
