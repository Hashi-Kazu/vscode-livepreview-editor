/**
 * Webview entry point. Boots a CodeMirror 6 editor, wires the live-preview
 * decoration plugin, and bridges document changes to/from the extension host
 * over `postMessage`.
 */
import { EditorState, Prec, RangeSet, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  EditorView,
  ViewUpdate,
  DecorationSet,
  ViewPlugin,
  keymap,
  drawSelection,
  gutterLineClass,
  GutterMarker,
} from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { codeFolding, foldGutter, foldKeymap, foldService, syntaxHighlighting } from '@codemirror/language';
import { codeLanguageFor, lpHighlightStyle } from './highlight';
import { buildDecorations, setResourceBase, setFontSize } from './decorations';
import {
  computeRemotePatch,
  cursorLinesFromSelections,
  shouldApplyRemoteUpdate,
  shouldEmitEdit,
  shouldFlushComposition,
  toggleTaskAt,
} from '../core/sync';
import { hasMediaPayload, parseDataTransferUris } from '../core/pasteLink';
import { insertTableRow, deleteTableRow, insertTableColumn, deleteTableColumn, updateTableCell } from '../core/tableEdit';
import { toggleWrap, WrapResult } from '../core/format';
import { continueList, changeIndent, toggleHeading, shouldOpenLinkOnMouseDown, classifyUndoRedoKey } from '../core/editing';
import { headingFoldRange, parseTableRow, scanHeadings } from '../core/model';
import { LineWindow, viewportWindow, zoomFontSize, displayFontSize } from '../core/viewport';

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
  | { text: string; baseVersion: number | undefined; rollback?: boolean }
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

// R-27-07: 0-based start lines of `<details>` accordions the user has opted into
// raw-source ("Markdownコードを直接編集") editing for. The model suppresses the
// accordion widget for these blocks while the caret is inside them, showing the
// raw `<details><summary>…` HTML as editable lines. Pruned automatically once the
// caret leaves the block (see `pruneDetailsDirectEdit`), so the accordion re-forms
// like an active table (R-22-02). Empty by default → accordions are viewer-only
// widgets (R-27-03).
const detailsDirectEditStartLines = new Set<number>();

const DETAILS_OPEN_LINE_RE = /^\s*<details(\s[^>]*)?>/i;
const DETAILS_CLOSE_LINE_RE = /^\s*<\/details>\s*$/i;

/** Inclusive [start,end] line range of the `<details>` block opening at
 *  `start0` (0-based), or null when `start0` is not a `<details>` opener or the
 *  block is unterminated. Mirrors `detectDetailsBlocks`'s open/close scan. */
function detailsBlockRange(docLines: string[], start0: number): { start: number; end: number } | null {
  if (start0 < 0 || start0 >= docLines.length) return null;
  if (!DETAILS_OPEN_LINE_RE.test(docLines[start0])) return null;
  for (let j = start0; j < docLines.length; j++) {
    if (DETAILS_CLOSE_LINE_RE.test(docLines[j])) return { start: start0, end: j };
  }
  return null;
}

/** Drop any direct-edit opt-in whose accordion no longer contains the caret so
 *  the widget re-forms (R-27-07). Runs on every recompute (doc/selection change). */
function pruneDetailsDirectEdit(state: EditorState): void {
  if (detailsDirectEditStartLines.size === 0) return;
  const doc = state.doc.toString();
  const selections = state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));
  const cursorLines = cursorLinesFromSelections(doc, selections);
  const docLines = doc.split('\n');
  for (const start of [...detailsDirectEditStartLines]) {
    const range = detailsBlockRange(docLines, start);
    let inside = false;
    if (range) {
      for (let l = range.start; l <= range.end; l++) {
        if (cursorLines.has(l)) {
          inside = true;
          break;
        }
      }
    }
    if (!inside) detailsDirectEditStartLines.delete(start);
  }
}

function computeField(state: EditorState, lineRange: LineWindow | undefined): LivePreviewFieldValue {
  pruneDetailsDirectEdit(state);
  const rangeWithSelection = includeSelectionLines(state, lineRange);
  return {
    decorations: buildDecorations(state, { lineRange: rangeWithSelection, detailsDirectEditStartLines }, onRenderError),
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

// R-30-04: the fold gutter chevron's vertical nudge differs only for H1–H3 (see
// `.cm-lp-fold-h1/-h2/-h3` in editor.css). The gutter element itself carries no
// heading-level information, so `gutterLineClass` attaches a level-specific CSS
// class (via a marker-only `GutterMarker`, no `toDOM`) to every heading line's
// gutter cell, computed from the same pure `scanHeadings` scanner used for
// folding. H4–H6 intentionally get no marker (their nudge stays at the base
// value defined on `.cm-gutterElement`).
class HeadingLevelGutterMarker extends GutterMarker {
  constructor(readonly level: number) {
    super();
  }
  eq(other: GutterMarker) {
    return other instanceof HeadingLevelGutterMarker && other.level === this.level;
  }
  elementClass = `cm-lp-fold-h${this.level}`;
}

function headingGutterMarks(state: EditorState): RangeSet<GutterMarker> {
  const headings = scanHeadings(state.doc.toString());
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const h of headings) {
    if (h.level >= 1 && h.level <= 3) {
      builder.add(h.from, h.from, new HeadingLevelGutterMarker(h.level));
    }
  }
  return builder.finish();
}

const headingFoldGutterClass = gutterLineClass.compute(['doc'], (state) => headingGutterMarks(state));

function makeState(text: string, selection?: { anchor: number; head: number }): EditorState {
  return EditorState.create({
    doc: text,
    selection,
    extensions: [
      // Undo/Redo is delegated to VS Code via the Custom Text Editor host, so
      // CodeMirror keeps no undo stack of its own and no undo keymap is bound.
      formatKeymap,
      arrowKeymap,
      editingKeymap,
      mediaDomHandlers,
      keymap.of([...defaultKeymap, ...foldKeymap]),
      // R-34: parse embedded fenced code blocks with per-language parsers so the
      // syntax-highlight style below can colour keywords/strings/etc. inside code
      // blocks. `codeLanguageFor` returns a `Language` synchronously (no dynamic
      // import → single Webview bundle stays intact).
      markdown({ codeLanguages: codeLanguageFor }),
      // R-34: token colours follow VS Code `--vscode-symbolIcon-*` theme
      // variables (fallbacks only, R-28-04). Only programming-language tags are
      // mapped, so Markdown prose markers keep their existing decoration styling.
      syntaxHighlighting(lpHighlightStyle),
      // R-30 heading-section folding. `codeFolding()` supplies fold state +
      // placeholder; `headingFoldService` provides heading ranges; `foldGutter`
      // renders VS Code-style chevron toggles. The gutter is width-compensated in CSS so the
      // heading/body left edge stays aligned (R-28-07). Sections start expanded.
      codeFolding(),
      headingFoldService,
      headingFoldGutterClass,
      foldGutter({ openText: '▾', closedText: '▸' }),
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

// --- R-31: unsaved indicator --------------------------------------------------
// A fixed overlay outside the CodeMirror DOM so it never interferes with
// decorations, height measurement, or click-position handling. Its visibility
// reflects the host's authoritative `TextDocument.isDirty` only (the Webview
// never estimates dirty state itself).
const unsavedIndicator = document.createElement('div');
unsavedIndicator.className = 'cm-lp-unsaved-indicator';
unsavedIndicator.title = '未保存の変更があります';
document.body.appendChild(unsavedIndicator);

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
  if (shouldApplyRemoteUpdate({
    baseVersion: remote.baseVersion,
    editVersion,
    ackVersion,
    composing: false,
    pendingLocalChange: pendingCompositionChange,
    rollback: remote.rollback,
  })) {
    // An external host update wins over an in-progress cell edit: cancel it so a
    // stale input/closure cannot fight the incoming document (R-08 sync).
    finishActiveCellEdit(false);
    if (remote.text !== view.state.doc.toString()) setText(remote.text, remote.rollback);
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
    // Rendered table → a normal (primary-button) click edits the clicked cell in
    // place; it never moves the caret into the block, so a plain click no longer
    // switches the table to raw `| a | b |` source (R-22-08). Raw-source editing
    // is reachable only via the "Markdownコードを直接編集" context-menu item
    // (R-22-09). A secondary press is swallowed here (so CodeMirror does not move
    // the caret) and handled by the `contextmenu` listener.
    const table = el.closest('.cm-lp-table');
    if (table) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (shouldOpenLinkOnMouseDown(event.button)) {
        const cell = el.closest('.cm-lp-table th, .cm-lp-table td') as HTMLElement | null;
        const target = cell ? readCellTarget(cell) : null;
        if (target) beginCellEditFromTarget(target);
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
// (`computeRemotePatch` → `view.dispatch`), so the existing `syncPlugin` → host
// `applyEdit` pipeline reflects it as a minimal `WorkspaceEdit`. Right-click
// never moves the caret or activates the block.
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
/**
 * Locate the run of consecutive `|`-bearing, non-empty lines that make up the
 * table block starting at `startLine` (mirrors `detectTableBlocks`). Returns the
 * whole document split into lines together with the block's inclusive end index,
 * or null when `startLine` is out of range.
 */
function tableBlockAt(startLine: number): { docLines: string[]; end: number } | null {
  const docLines = view.state.doc.toString().split('\n');
  if (startLine < 0 || startLine >= docLines.length) return null;
  let end = startLine;
  for (let j = startLine + 1; j < docLines.length; j++) {
    if (docLines[j].includes('|') && docLines[j].trim() !== '') end = j;
    else break;
  }
  return { docLines, end };
}

function applyTableEdit(startLine: number, transform: (lines: string[]) => string[]): void {
  const located = tableBlockAt(startLine);
  if (!located) return;
  const { docLines, end } = located;
  const current = docLines.join('\n');
  const block = docLines.slice(startLine, end + 1);
  const next = transform(block);
  if (next.join('\n') === block.join('\n')) return; // guard / no-op
  const nextDoc = docLines.slice(0, startLine).concat(next, docLines.slice(end + 1)).join('\n');
  const sel = view.state.selection.main;
  const patch = computeRemotePatch(current, nextDoc, { anchor: sel.anchor, head: sel.head });
  view.dispatch({
    changes: { from: patch.from, to: patch.to, insert: patch.insert },
  });
}

// --- Direct table-cell editing (double-click / "セルを編集") ------------------
//
// Double-clicking a rendered table cell (or choosing "セルを編集" from the R-22-06
// menu) opens a one-line <input> inside that cell so its raw Markdown text can be
// edited in place while the table stays rendered. Enter / blur / starting another
// cell edit commit the change through the SAME path as the row/column menu
// (`updateTableCell` → `applyTableEdit` → `computeRemotePatch` → `view.dispatch`);
// Escape cancels without touching the doc.
// A literal `|` typed into a cell is escaped (`\|`) by `updateTableCell`/`buildRow`
// so it never breaks the table structure.

interface CellTarget {
  startLine: number;
  rowType: 'header' | 'body';
  rowIndex: number; // 0-based body index; -1 for the header
  col: number;
}

/** Read the cell-edit metadata attached to a rendered th/td (added in
 *  `decorations.ts` `TableWidget.toDOM`). Returns null when the attributes are
 *  missing or malformed (e.g. clicking chrome outside a real cell). */
function readCellTarget(cell: HTMLElement): CellTarget | null {
  const startLine = Number(cell.getAttribute('data-table-start-line'));
  const col = Number(cell.getAttribute('data-col'));
  const rowType = cell.getAttribute('data-row-type');
  if (!Number.isInteger(startLine) || startLine < 0 || !Number.isInteger(col) || col < 0) return null;
  if (rowType !== 'header' && rowType !== 'body') return null;
  const rowIndex = rowType === 'body' ? Number(cell.getAttribute('data-row-index')) : -1;
  if (rowType === 'body' && (!Number.isInteger(rowIndex) || rowIndex < 0)) return null;
  return { startLine, rowType, rowIndex, col };
}

// Commit callback of the cell edit currently in progress (null when idle). Kept
// at module scope so starting a new edit (or an external host update) can finish
// the previous one first.
let activeCellCommit: ((apply: boolean) => void) | null = null;

/** Finish any in-progress cell edit (used before starting a new one or when an
 *  external host update arrives — the host update then wins). */
function finishActiveCellEdit(apply: boolean): void {
  if (activeCellCommit) activeCellCommit(apply);
}

/**
 * Begin editing the cell described by `target`. The table may currently be shown
 * as raw text (a prior single click moved the caret into the block), so first
 * move the selection to a line *outside* the block, which re-renders the table as
 * a widget; then find the freshly rendered cell and open its input. When the
 * table is already a widget (right-click menu path) the selection move is a
 * harmless no-op that keeps the block inactive.
 */
function beginCellEditFromTarget(target: CellTarget): void {
  const located = tableBlockAt(target.startLine);
  if (!located) return;
  const outLine0 = target.startLine > 0 ? target.startLine - 1 : located.end + 1;
  const clamped = Math.max(0, Math.min(outLine0, view.state.doc.lines - 1));
  try {
    const anchor = view.state.doc.line(clamped + 1).from; // doc.line is 1-based
    view.dispatch({ selection: { anchor } });
  } catch {
    return; // line out of range mid-render; abort quietly
  }
  const sel =
    target.rowType === 'header'
      ? `.cm-lp-table th[data-table-start-line="${target.startLine}"][data-col="${target.col}"]`
      : `.cm-lp-table td[data-table-start-line="${target.startLine}"]` +
        `[data-row-index="${target.rowIndex}"][data-col="${target.col}"]`;
  const cell = view.dom.querySelector(sel) as HTMLElement | null;
  if (cell) startCellEdit(cell, target);
}

/** Open the inline <input> for `cell` and wire commit/cancel + event isolation. */
function startCellEdit(cell: HTMLElement, target: CellTarget): void {
  finishActiveCellEdit(true); // commit any other cell edit first

  const located = tableBlockAt(target.startLine);
  if (!located) return;
  const srcLineIdx = target.rowType === 'header' ? 0 : target.rowIndex + 2;
  if (srcLineIdx < 0 || target.startLine + srcLineIdx > located.end) return;
  const cells = parseTableRow(located.docLines[target.startLine + srcLineIdx]);
  if (target.col < 0 || target.col >= cells.length) return;
  const original = cells[target.col] ?? '';

  const originalHTML = cell.innerHTML;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cm-lp-table-cell-input';
  input.setAttribute('aria-label', '表セルを編集');
  input.value = original;

  cell.classList.add('cm-lp-table-cell-editing');
  cell.textContent = '';
  cell.appendChild(input);

  const rowDesc: { type: 'header' } | { type: 'body'; index: number } =
    target.rowType === 'header' ? { type: 'header' } : { type: 'body', index: target.rowIndex };

  let composing = false;
  const commit = (apply: boolean) => {
    if (activeCellCommit !== commit) return; // already finished
    activeCellCommit = null;
    const value = input.value;
    if (apply && value !== original) {
      // Same body-change path as the row/column menu; the dispatch rebuilds the
      // whole table widget (updateDOM → false → toDOM), replacing this cell node.
      applyTableEdit(target.startLine, (l) => updateTableCell(l, rowDesc, target.col, value));
    } else {
      // Cancel / no change: drop the input and restore the rendered cell content.
      cell.classList.remove('cm-lp-table-cell-editing');
      cell.innerHTML = originalHTML;
    }
  };
  activeCellCommit = commit;

  const stop = (ev: Event) => ev.stopPropagation();
  for (const type of ['mousedown', 'click', 'dblclick', 'input', 'contextmenu'] as const) {
    input.addEventListener(type, stop);
  }
  input.addEventListener('compositionstart', (ev) => {
    ev.stopPropagation();
    composing = true;
  });
  input.addEventListener('compositionend', (ev) => {
    ev.stopPropagation();
    composing = false;
  });
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      if (ev.isComposing || composing) return; // IME confirmation, not a cell commit
      ev.preventDefault();
      commit(true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      commit(false);
    } else if (ev.key === 'Tab') {
      // Do not let focus leave the Webview or insert a tab character; just commit.
      ev.preventDefault();
      commit(true);
    }
  });
  input.addEventListener('blur', () => commit(true));

  input.focus();
  input.select();
}

/** Move the caret to the start of the given 0-based line (and focus the editor).
 *  Used to activate a block's cursor-driven raw view (tables R-22-09; the same
 *  primitive backs the accordion direct-edit entry). */
function moveCaretToLineStart(line0: number): void {
  try {
    const anchor = view.state.doc.line(line0 + 1).from; // doc.line is 1-based
    view.dispatch({ selection: { anchor } });
    view.focus();
  } catch {
    /* line out of range mid-render; ignore */
  }
}

/**
 * R-27-07: right-click menu for a rendered `<details>` accordion. Its single item
 * opts the block into raw-source editing (adds its start line to
 * `detailsDirectEditStartLines`) and moves the caret inside so the model shows the
 * raw `<details><summary>…` HTML. Reuses the table-menu overlay chrome/lifecycle.
 */
function showDetailsMenu(x: number, y: number, startLine: number): void {
  closeTableMenu();
  const menu = document.createElement('div');
  menu.className = 'cm-lp-table-menu';
  menu.setAttribute('role', 'menu');

  const item = document.createElement('div');
  item.className = 'cm-lp-table-menu-item';
  item.setAttribute('role', 'menuitem');
  item.textContent = 'Markdownコードを直接編集';
  item.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    detailsDirectEditStartLines.add(startLine);
    moveCaretToLineStart(startLine);
    closeTableMenu();
  });
  menu.appendChild(item);

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
    if (!enabled) item.setAttribute('aria-disabled', 'true');
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

  addItem('セルを編集', true, () =>
    beginCellEditFromTarget({
      startLine,
      rowType: isHeader ? 'header' : 'body',
      rowIndex: isHeader ? -1 : bodyRowIndex,
      col,
    }),
  );
  // R-22-09: move the caret to the table's first source line so the cursor-driven
  // raw view (R-22-02) kicks in and the block's `| a | b |` Markdown becomes
  // directly editable text. The widget re-forms once the caret leaves the block.
  addItem('Markdownコードを直接編集', true, () => moveCaretToLineStart(startLine));
  addSeparator();
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
    // Rendered <details> accordion → offer raw-source editing (R-27-07).
    const details = el.closest('.cm-lp-details') as HTMLElement | null;
    if (details) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const startLine = Number(details.getAttribute('data-start-line'));
      if (Number.isInteger(startLine) && startLine >= 0) showDetailsMenu(event.clientX, event.clientY, startLine);
      return;
    }
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
  // The zoom/settings baseline (`fontSize`) stays the raw configured value;
  // only the rendered px is scaled up (R-28-17) so the preview reads closer to
  // a standard Markdown preview's default size.
  const rendered = displayFontSize(size);
  (document.getElementById('editor') as HTMLElement).style.fontSize = `${rendered}px`;
  // Keep the decoration layer's block-height estimates in sync with the actual
  // rendered font size so `posAtCoords` stays accurate below tables/accordions
  // (R-28-11).
  setFontSize(rendered);
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

function setText(text: string, rollback = false) {
  const doc = view.state.doc.toString();
  if (doc === text) return;

  // Apply only the minimal changed range (common prefix/suffix trimmed) so the
  // dispatch does not touch — and thus does not scroll to — unrelated lines
  // (R-08-07). The primary selection is remapped through the patch so a resync
  // whose replaced range covers the typing line keeps the caret at its
  // equivalent logical position instead of collapsing it to the range start.
  //
  // CodeMirror holds no undo history of its own (Undo/Redo is VS Code's, driven
  // through the Custom Text Editor host), so every host update — whether a
  // failed-edit rollback or a genuine external change — is reflected as one
  // minimal patch under the `applyingRemote` guard. The guard keeps the
  // `syncPlugin` from echoing this change back to the host as a local edit.
  const sel = view.state.selection.main;
  const patch = computeRemotePatch(doc, text, { anchor: sel.anchor, head: sel.head });

  applyingRemote = true;
  try {
    pendingMediaRequests.clear();
    view.dispatch({
      changes: { from: patch.from, to: patch.to, insert: patch.insert },
      selection: { anchor: patch.anchor, head: patch.head },
    });
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
        };
        break;
      }
      if (msg.text !== view.state.doc.toString()) setText(msg.text, msg.rollback === true);
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

// Undo / Redo / Save are forwarded to the extension host, which delegates
// Undo/Redo to VS Code (`executeCommand('undo'|'redo')`, so history is unified
// with the standard editor) and persists on save. Registered on the capture
// phase so it runs before CodeMirror and any table-cell <input> handler, and
// works regardless of which element holds focus. IME conversion (`isComposing`)
// is never intercepted. (R-04 / R-17 / R-18 / R-19)
window.addEventListener(
  'keydown',
  (event) => {
    const action = classifyUndoRedoKey({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      isComposing: event.isComposing,
    });
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    vscode.postMessage({ type: action, binding });
  },
  true,
);

// Tell the host we are ready to receive the initial document.
vscode.postMessage({ type: 'ready' });

// The host uses the last-interacted viewer when active source editors change or
// formatting commands are invoked after focus has returned to the source.
window.addEventListener('focus', () => vscode.postMessage({ type: 'interacted' }));
view.dom.addEventListener('pointerdown', () => vscode.postMessage({ type: 'interacted' }), true);
