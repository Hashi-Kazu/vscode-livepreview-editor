/**
 * Webview entry point. Boots a CodeMirror 6 editor, wires the live-preview
 * decoration plugin, and bridges document changes to/from the extension host
 * over `postMessage`.
 */
import { EditorState, Transaction, StateField } from '@codemirror/state';
import { EditorView, ViewUpdate, DecorationSet, ViewPlugin, keymap, drawSelection } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { buildDecorations, setResourceBase, setFontSize } from './decorations';
import { shouldEmitEdit } from '../core/sync';
import { toggleWrap, WrapResult } from '../core/format';
import { continueList, changeIndent, toggleHeading, shouldOpenLinkOnMouseDown } from '../core/editing';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

let fontSize = 14;
/** True while we are applying an edit that came from the extension host, so we
 *  do not echo it straight back and create a feedback loop. */
let applyingRemote = false;

// Decorations are provided via a StateField (not a ViewPlugin): CodeMirror
// forbids block decorations — used by the HTML table widget — from plugins.
let renderErrorReported = false;
function onRenderError(message: string) {
  // Ask the host to switch to VS Code's standard text editor (we no longer ship
  // an in-webview source view). Report once to avoid a warning storm.
  if (!renderErrorReported) {
    renderErrorReported = true;
    vscode.postMessage({ type: 'renderError', message });
  }
}

function computeField(state: EditorState): DecorationSet {
  return buildDecorations(state, {}, onRenderError);
}

function livePreviewField() {
  return StateField.define<DecorationSet>({
    create: (state) => computeField(state),
    update(value, tr) {
      // Recompute on edits and cursor/selection moves (cursor line shows raw).
      if (tr.docChanged || tr.selection) return computeField(tr.state);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

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

const syncPlugin = EditorView.updateListener.of((update: ViewUpdate) => {
  // Defer during IME composition / remote application to avoid flicker & loops.
  if (!shouldEmitEdit({ docChanged: update.docChanged, composing: update.view.composing, applyingRemote })) {
    return;
  }
  vscode.postMessage({ type: 'edit', text: update.state.doc.toString() });
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
        vscode.postMessage({ type: 'toggleTask', line });
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
      vscode.postMessage({ type: 'openLink', href: href.getAttribute('data-href') });
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

function applyFontSize(size: number) {
  fontSize = size;
  (document.getElementById('editor') as HTMLElement).style.fontSize = `${size}px`;
  // Keep the decoration layer's block-height estimates in sync with the font
  // size so `posAtCoords` stays accurate below tables/accordions (R-28-11).
  setFontSize(size);
  // Font changes invalidate both CodeMirror's height oracle and the selection
  // layer's document-height synchronization (R-28-14 / R-28-15).
  requestAnimationFrame(() => {
    view.requestMeasure();
    requestSelectionLayerHeightSync();
  });
}

function setText(text: string) {
  const doc = view.state.doc.toString();
  if (doc === text) return;

  // Find the minimal changed range by trimming the common prefix and suffix.
  // Dispatching only the changed slice keeps the selection stable (CodeMirror
  // auto-maps it through the change) so the cursor does not jump and
  // scrollIntoView is not triggered — eliminating the scroll-to-top on
  // checkbox toggle (R-08-07).
  let from = 0;
  const minLen = Math.min(doc.length, text.length);
  while (from < minLen && doc[from] === text[from]) from++;
  let toOld = doc.length;
  let toNew = text.length;
  while (toOld > from && toNew > from && doc[toOld - 1] === text[toNew - 1]) {
    toOld--;
    toNew--;
  }

  applyingRemote = true;
  try {
    view.dispatch({
      changes: { from, to: toOld, insert: text.slice(from, toNew) },
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
      if (msg.text !== view.state.doc.toString()) setText(msg.text);
      break;
    case 'settings':
      if (typeof msg.fontSize === 'number') applyFontSize(msg.fontSize);
      break;
    case 'format':
      if (typeof msg.kind === 'string') runFormat(msg.kind);
      break;
  }
});

// Tell the host we are ready to receive the initial document.
vscode.postMessage({ type: 'ready' });
