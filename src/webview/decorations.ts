/**
 * Bridge between the pure {@link DecoSpec} model and CodeMirror 6 decorations.
 * This file DOES import CodeMirror, so it lives in the Webview bundle and is not
 * exercised by the Node-based Vitest suite (which tests `src/core` directly).
 */
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import katex from 'katex';
import { computeDecorationsSafe, DecoSpec, DecorationOptions } from '../core/model';
import { cursorLinesFromSelections } from '../core/sync';

class TextWidget extends WidgetType {
  constructor(private readonly text: string, private readonly cls: string) {
    super();
  }
  eq(other: TextWidget) {
    return other.text === this.text && other.cls === this.cls;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.cls;
    span.textContent = this.text;
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    // A styled <span> rather than a native <input>: the input stole focus and
    // moved the editor selection on click, which made toggles intermittently
    // fail. The span routes cleanly to the editor's mousedown handler.
    const box = document.createElement('span');
    box.className = 'cm-lp-task-checkbox' + (this.checked ? ' cm-lp-task-checkbox-checked' : '');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.setAttribute('aria-label', 'task');
    // Keep the `checked` attribute as the state carrier (per R-08-01).
    if (this.checked) box.setAttribute('checked', 'true');
    return box;
  }
  ignoreEvent() {
    return false; // allow click events to reach the editor DOM handler
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement('span');
    hr.className = 'cm-lp-hr-line';
    return hr;
  }
}

interface ParsedTable {
  header: string[];
  align: ('left' | 'center' | 'right' | 'none')[];
  rows: string[][];
}

/**
 * Render a table cell's text with minimal inline Markdown (bold / italic /
 * inline code) into the given element. Table cells were previously inserted as
 * raw `textContent`, so `**CPM**` showed literal asterisks; MAIO renders the
 * bold. We keep this intentionally small (cells rarely carry rich syntax) and
 * escape everything else so it stays safe from raw-HTML injection. */
function appendInlineCell(parent: HTMLElement, text: string): void {
  // Tokenise into [marker, content] runs. Order: code → bold → italic.
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    let el: HTMLElement;
    if (m[1] !== undefined) {
      el = document.createElement('code');
      el.className = 'cm-lp-code';
      el.textContent = m[1];
    } else if (m[2] !== undefined || m[3] !== undefined) {
      el = document.createElement('strong');
      el.className = 'cm-lp-strong';
      el.textContent = m[2] ?? m[3] ?? '';
    } else {
      el = document.createElement('em');
      el.className = 'cm-lp-em';
      el.textContent = m[4] ?? m[5] ?? '';
    }
    parent.appendChild(el);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

/** Current editor font size (px), mirrored from the host `fontSize` setting via
 *  {@link setFontSize}. Block-widget height estimates scale with this so that
 *  `posAtCoords` (click → document position) stays accurate at non-default font
 *  sizes, not just at 14px (R-28-11). Defaults to 14 to match the host default. */
let currentFontSize = 14;
export function setFontSize(size: number) {
  if (size > 0) currentFontSize = size;
}

/** Plain editor line height (px) at the current font size. The editor body uses
 *  `line-height: 1.6` (media/editor.css). Deriving this from `currentFontSize`
 *  (rather than a hard-coded 22) keeps block-height estimates correct when the
 *  user changes the font size, which is the dominant cause of click-position
 *  drift below a block widget (R-28-11). */
function linePx(): number {
  return Math.round(currentFontSize * 1.6);
}

/** Real per-row height of a rendered table row at the current font size. Cells
 *  use `padding: 6px 13px` (12px vertical) and `line-height: 1.6` at
 *  `font-size: 0.95em`, plus 1px border-collapse, so a row paints at
 *  ≈ fontSize·0.95·1.6 + 13. Scaling with `currentFontSize` (instead of a fixed
 *  34) keeps the pre-measure block height close to reality at any font size,
 *  removing the click-position drift that `requestMeasure` alone could not fully
 *  fix mid-frame (R-28-11). */
function tableRowPx(): number {
  return Math.ceil(currentFontSize * 0.95 * 1.6) + 13;
}

class TableWidget extends WidgetType {
  constructor(private readonly json: string, private readonly startLine: number) {
    super();
  }
  eq(other: TableWidget) {
    return other.json === this.json && other.startLine === this.startLine;
  }
  /** header + body rows × real row height + margin chrome (`margin: 0.5em 0`
   *  ≈ font-size) + 1px for the border-collapse thead/tbody boundary.
   *  Uses the font-size-aware `tableRowPx()` (padded table cells paint taller
   *  than a plain line) so the pre-measure estimate is close to reality at any
   *  font size; `updateDOM` `requestMeasure()` corrects the residual (R-28-11). */
  get estimatedHeight() {
    let rows = 1; // header
    try {
      rows += (JSON.parse(this.json) as ParsedTable).rows.length;
    } catch {
      /* fall back to header-only */
    }
    return rows * tableRowPx() + currentFontSize + 1;
  }
  toDOM() {
    let data: ParsedTable;
    try {
      data = JSON.parse(this.json);
    } catch {
      const span = document.createElement('span');
      span.textContent = this.json;
      return span;
    }
    const table = document.createElement('table');
    table.className = 'cm-lp-table';
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    // data-line lets the click handler move the caret into the block (R-22-02).
    htr.setAttribute('data-line', String(this.startLine));
    data.header.forEach((cell, idx) => {
      const th = document.createElement('th');
      // data-col lets the right-click table menu target a specific column (R-22-06).
      th.setAttribute('data-col', String(idx));
      // Cell-edit metadata (double-click / "セルを編集"): row kind + table origin.
      th.setAttribute('data-row-type', 'header');
      th.setAttribute('data-table-start-line', String(this.startLine));
      appendInlineCell(th, cell);
      if (data.align[idx] && data.align[idx] !== 'none') th.style.textAlign = data.align[idx];
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    data.rows.forEach((row, k) => {
      const tr = document.createElement('tr');
      // Delimiter row (startLine+1) is skipped; body rows start at startLine+2.
      tr.setAttribute('data-line', String(this.startLine + 2 + k));
      for (let idx = 0; idx < data.header.length; idx++) {
        const td = document.createElement('td');
        // data-col lets the right-click table menu target a specific column (R-22-06).
        td.setAttribute('data-col', String(idx));
        // Cell-edit metadata (double-click / "セルを編集"): row kind, 0-based body
        // row index, and the table's source start line.
        td.setAttribute('data-row-type', 'body');
        td.setAttribute('data-row-index', String(k));
        td.setAttribute('data-table-start-line', String(this.startLine));
        appendInlineCell(td, row[idx] ?? '');
        if (data.align[idx] && data.align[idx] !== 'none') td.style.textAlign = data.align[idx];
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    // Do NOT requestMeasure here: toDOM runs *inside* CodeMirror's measure
    // cycle, so re-requesting a measure pushes height reconciliation to the next
    // frame and leaves `posAtCoords` stale for that frame (the click-drift bug).
    // The font-size-aware estimatedHeight gets us close on first paint; the
    // residual is reconciled by updateDOM on the next update (R-28-11).

    // Wrap the table in a div so that spacing is applied as padding (not margin).
    // `getBoundingClientRect()` excludes CSS margin but includes padding, so the
    // wrapper's padding lets CodeMirror measure the full painted height — margin
    // on the table itself was silently dropped from the measurement and caused
    // clicks below the table to land one row too low (R-28-10).
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-lp-table-wrapper';
    wrapper.appendChild(table);
    return wrapper;
  }
  /** Called when this widget replaces an existing, non-equal widget of the same
   *  type (row/column edit or cell edit → the parsed `json` changed). Returning
   *  `false` makes CodeMirror discard the stale DOM and call `toDOM()` to rebuild
   *  the table from the new data — reusing the old DOM (returning `true`) left the
   *  previous table painted until the next unrelated update. We still schedule a
   *  re-measure (outside `toDOM`, honouring R-28-10/R-28-11) so block heights are
   *  reconciled against the freshly painted DOM. */
  updateDOM(_dom: HTMLElement, view: EditorView): boolean {
    view.requestMeasure();
    return false;
  }
  ignoreEvent() {
    return false;
  }
}

/** Per-summary open/closed memory so the accordion keeps its expanded state
 *  across re-renders (the widget DOM is rebuilt on every doc change). Keyed by
 *  the raw summary text. Limitation: two accordions with an identical summary
 *  share one open/closed state. */
const openDetails = new Set<string>();

/** Collapsed `<details>` accordion (viewer-only). Rendered as a real,
 *  interactive `<details>` element so the browser handles open/close natively;
 *  it starts closed (collapsed by default per R-27) unless the user previously
 *  opened an accordion with the same summary. The block is not editable
 *  in-place — editing happens via the standard source editor. */
class DetailsWidget extends WidgetType {
  constructor(private readonly summary: string, private readonly body: string[], private readonly startLine: number) {
    super();
  }
  eq(other: DetailsWidget) {
    return (
      other.summary === this.summary &&
      other.startLine === this.startLine &&
      JSON.stringify(other.body) === JSON.stringify(this.body)
    );
  }
  /** Closed ≈ 1 summary line; open ≈ summary + every body line. Body lines paint
   *  at `line-height: 1.4` plus 2px vertical padding (media/editor.css), the
   *  summary at `line-height: 1.4`. Scaling with `currentFontSize` keeps the
   *  estimate accurate at any font size *and* reflects the real open-state body
   *  height — the previous hard-coded LINE_PX(22) under-counted open accordions
   *  and drifted clicks below them (R-28-11). The `toggle` listener requests a
   *  re-measure when the user opens/closes it at runtime. */
  get estimatedHeight() {
    const summaryPx = Math.round(currentFontSize * 1.4) + 2;
    if (!openDetails.has(this.summary)) return summaryPx + 2;
    const bodyLinePx = Math.round(currentFontSize * 1.4) + 2; // line-height 1.4 + 2px padding
    return summaryPx + this.body.length * bodyLinePx + 2;
  }
  toDOM(view: EditorView) {
    const details = document.createElement('details');
    details.className = 'cm-lp-details';
    // data-start-line lets the right-click accordion menu identify which block to
    // route "Markdownコードを直接編集" to (R-27-07).
    details.setAttribute('data-start-line', String(this.startLine));
    // Restore the previously-remembered open state for this summary; closed by
    // default otherwise.
    if (openDetails.has(this.summary)) details.open = true;
    const summary = document.createElement('summary');
    summary.className = 'cm-lp-details-summary';
    // Our own marker span (the native triangle is hidden in CSS) so the open /
    // closed glyph follows the theme and reads as plain inline text (R-27).
    const marker = document.createElement('span');
    marker.className = 'cm-lp-details-marker';
    marker.textContent = details.open ? '▼' : '▶'; // ▼ open / ▶ closed
    summary.appendChild(marker);
    const label = document.createElement('span');
    label.className = 'cm-lp-details-label';
    // Render minimal inline Markdown (bold / italic / code) in the summary so
    // `**...**` shows as bold rather than literal asterisks (MAIO look).
    appendInlineCell(label, this.summary || '詳細');
    summary.appendChild(label);
    details.appendChild(summary);
    // Render the body (viewer-only) so opening the accordion reveals content.
    // Each line gets minimal inline Markdown (bold / italic / code); richer
    // structure (lists, nested blocks, multiple paragraphs) is simplified.
    for (const lineText of this.body) {
      const div = document.createElement('div');
      div.className = 'cm-lp-details-body-line';
      appendInlineCell(div, lineText);
      details.appendChild(div);
    }
    // Keep the marker in sync with the native open state on toggle and remember
    // the open/closed state per summary so it survives re-renders. Opening or
    // closing changes the widget height, so ask CodeMirror to re-measure block
    // heights (otherwise `posAtCoords` for lines below drifts — R-28-10).
    // This requestMeasure call is valid: toggle fires while the DOM is in the
    // tree, so the measurement will capture the real post-toggle height.
    details.addEventListener('toggle', () => {
      marker.textContent = details.open ? '▼' : '▶'; // ▼ / ▶
      if (details.open) openDetails.add(this.summary);
      else openDetails.delete(this.summary);
      view.requestMeasure();
    });
    // Do NOT requestMeasure here: toDOM runs inside CodeMirror's measure cycle,
    // so re-requesting defers reconciliation a frame and leaves `posAtCoords`
    // stale (click-drift). The font-size-aware, open-state-aware estimatedHeight
    // gets the first paint close; updateDOM reconciles the residual, and the
    // `toggle` listener above handles runtime open/close (R-28-11).
    return details;
  }
  /** Called when the widget DOM already exists in the tree (update path).
   *  Reuse existing DOM (return true) and schedule a re-measure so CodeMirror
   *  reconciles block heights against the real painted DOM, keeping
   *  `posAtCoords` accurate for lines below the accordion (R-28-10). */
  updateDOM(_dom: HTMLElement, view: EditorView): boolean {
    view.requestMeasure();
    return true;
  }
  ignoreEvent() {
    return false;
  }
}

/** SVG path data for each alert kind's leading icon (GitHub-style octicons,
 *  simplified). Rendered via an inline <svg> so the glyph follows `currentColor`
 *  and therefore the theme-driven per-kind color set in CSS (R-28-04). */
const ALERT_ICON_PATHS: Record<string, string> = {
  note: 'M0 8a8 8 0 1116 0A8 8 0 010 8zm8-6.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM6.5 7.75A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 100-2 1 1 0 000 2z',
  tip: 'M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 01-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 00-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.75.75 0 01-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75zM5.75 12h4.5a.75.75 0 010 1.5h-4.5a.75.75 0 010-1.5zM6 15.25a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75z',
  important: 'M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0114.25 13H8.06l-2.573 2.573A1.457 1.457 0 013 14.543V13H1.75A1.75 1.75 0 010 11.25zM9 9a1 1 0 10-2 0 1 1 0 002 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0z',
  warning: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575zM9 11a1 1 0 10-2 0 1 1 0 002 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0z',
  caution: 'M4.47.22A.749.749 0 015 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 01-.22.53l-4.25 4.25A.749.749 0 0111 16H5a.749.749 0 01-.53-.22L.22 11.53A.749.749 0 010 11V5c0-.199.079-.389.22-.53zM8 4a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 008 4zm0 8a1 1 0 100-2 1 1 0 000 2z',
};

/** Leading title of a GitHub alert (icon + kind name), replacing the raw
 *  `[!TYPE]` label off-cursor. The per-kind color is applied in CSS via the
 *  `cm-lp-alert-title-<kind>` class; the icon inherits `currentColor` (R-28-04). */
class AlertTitleWidget extends WidgetType {
  constructor(private readonly kind: string, private readonly title: string) {
    super();
  }
  eq(other: AlertTitleWidget) {
    return other.kind === this.kind && other.title === this.title;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-lp-alert-title cm-lp-alert-title-${this.kind}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('cm-lp-alert-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ALERT_ICON_PATHS[this.kind] ?? ALERT_ICON_PATHS.note);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    span.appendChild(svg);
    const label = document.createElement('span');
    label.className = 'cm-lp-alert-title-text';
    label.textContent = this.title;
    span.appendChild(label);
    return span;
  }
}

/** Webview-side base URI (set by the host) used to resolve relative image paths. */
let resourceBase = '';
export function setResourceBase(base: string) {
  resourceBase = base.replace(/\/+$/, '');
}

/** Resolve an image src: absolute/data URLs as-is, relative paths via the base.
 *  `src` may still carry the CommonMark angle-bracket destination wrapper
 *  (`<path with spaces>`) — the model keeps it verbatim by design (see
 *  `livePreviewCustomEditorProvider.openLink`, which strips it the same way for link
 *  hrefs) — so unwrap the outer pair here before resolving. */
function resolveSrc(src: string): string {
  const unwrapped = src.replace(/^<([\s\S]*)>$/, '$1');
  if (/^(https?:|data:|vscode-webview-resource:|vscode-resource:)/i.test(unwrapped)) return unwrapped;
  if (!resourceBase) return unwrapped;
  const clean = unwrapped.replace(/^\.\//, '').replace(/^\//, '');
  return `${resourceBase}/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

class ImageWidget extends WidgetType {
  constructor(private readonly src: string, private readonly alt: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-lp-image';
    img.src = resolveSrc(this.src);
    img.alt = this.alt;
    img.onerror = () => {
      const fallback = document.createElement('span');
      fallback.className = 'cm-lp-image-fallback';
      fallback.textContent = this.alt || this.src;
      img.replaceWith(fallback);
    };
    return img;
  }
}

/** Inline math `$…$` rendered with KaTeX (R-32). Rendering directly into the DOM
 *  (never `innerHTML` from a raw string) keeps us clear of raw-HTML injection;
 *  `throwOnError:false` makes KaTeX paint its own error node for bad TeX, and any
 *  thrown exception falls back to the raw `$tex$` so the Webview never crashes. */
class MathInlineWidget extends WidgetType {
  constructor(private readonly tex: string) {
    super();
  }
  eq(other: MathInlineWidget) {
    return other.tex === this.tex;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-lp-math-inline';
    try {
      katex.render(this.tex, span, { throwOnError: false, displayMode: false });
    } catch {
      span.textContent = `$${this.tex}$`;
    }
    return span;
  }
}

/** Block math `$$…$$` rendered with KaTeX in display mode (R-32). A `block: true`
 *  replace widget, so it implements `estimatedHeight` (scaled with the current
 *  font size) and defers `requestMeasure()` to `updateDOM` — never calling it in
 *  `toDOM`, which runs inside CodeMirror's measure cycle (R-28-10 / R-28-11). */
class MathBlockWidget extends WidgetType {
  constructor(private readonly tex: string) {
    super();
  }
  eq(other: MathBlockWidget) {
    return other.tex === this.tex;
  }
  /** Display math paints roughly one editor line per TeX line plus vertical
   *  chrome (`margin: 0.5em 0` ≈ font-size). Scaling with `currentFontSize`
   *  keeps the pre-measure estimate close so clicks below the block land right;
   *  the residual is reconciled by `updateDOM`'s `requestMeasure` (R-28-11). */
  get estimatedHeight() {
    const rows = this.tex.split('\n').length;
    return rows * linePx() + currentFontSize;
  }
  toDOM() {
    const div = document.createElement('div');
    div.className = 'cm-lp-math-block';
    try {
      katex.render(this.tex, div, { throwOnError: false, displayMode: true });
    } catch {
      div.textContent = `$$${this.tex}$$`;
    }
    // Do NOT requestMeasure here (toDOM runs inside the measure cycle — see
    // TableWidget). The font-size-aware estimatedHeight gets first paint close;
    // updateDOM reconciles the residual (R-28-11).
    return div;
  }
  updateDOM(_dom: HTMLElement, view: EditorView): boolean {
    view.requestMeasure();
    return true;
  }
  ignoreEvent() {
    return false;
  }
}

/** Build a CodeMirror DecorationSet from the pure model for the given state.
 *  On a computation error, invokes `onError` (Webview falls back to source) and
 *  returns an empty set rather than crashing. */
export function buildDecorations(
  state: EditorState,
  options: DecorationOptions = {},
  onError?: (message: string) => void,
): DecorationSet {
  const doc = state.doc.toString();
  const selections = state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));
  const cursorLines = cursorLinesFromSelections(doc, selections);
  const result = computeDecorationsSafe(doc, cursorLines, options);
  if (!result.ok) {
    onError?.(result.error ?? 'decoration error');
    return Decoration.none;
  }
  const specs = result.specs;

  // CodeMirror requires decorations sorted by (from, startSide). Line decorations
  // must come before other decorations that start at the same position.
  const sorted = specs
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => a.s.from - b.s.from || sideOf(a.s) - sideOf(b.s) || a.idx - b.idx);

  const builder = new RangeSetBuilder<Decoration>();
  try {
    for (const { s } of sorted) {
      const deco = toDecoration(s);
      if (!deco) continue;
      builder.add(s.from, s.type === 'line' ? s.from : s.to, deco);
    }
    return builder.finish();
  } catch (err) {
    onError?.(err instanceof Error ? err.message : String(err));
    return Decoration.none;
  }
}

function sideOf(s: DecoSpec): number {
  if (s.type === 'line') return -2;
  if (s.type === 'mark') return 0;
  return -1; // hide / replaceWidget: startSide=499999999 < mark's startSide=500000000
}

function toDecoration(s: DecoSpec): Decoration | null {
  switch (s.type) {
    case 'line': {
      // List/task lines: widen the hierarchy indent beyond the raw leading
      // whitespace so nested levels read clearly, matching standard Markdown
      // preview spacing (R-28-06). Additive to the existing whitespace — never
      // mutates the source text (R-01-02).
      let attributes: Record<string, string> | undefined;
      if (s.tag === 'list' || s.tag === 'task') {
        const indent = Number(s.attrs?.indent ?? '0') || 0;
        const level = Math.floor(indent / 2);
        if (level > 0) attributes = { style: `padding-left: ${level * 2}em;` };
      }
      // Fenced code opener: expose the language name as `data-lang` so CSS can
      // paint a clean language label on the block frame (the raw info string is
      // hidden by the model off-cursor — #4/#5).
      if (s.tag === 'codeblock' && s.attrs?.lang) {
        attributes = { ...(attributes ?? {}), 'data-lang': s.attrs.lang };
      }
      return Decoration.line({ class: s.className ?? '', attributes });
    }
    case 'mark':
      return Decoration.mark({ class: s.className ?? '', attributes: markAttrs(s) });
    case 'hide':
      return Decoration.replace({});
    case 'replaceWidget':
      if (s.tag === 'image') {
        return Decoration.replace({ widget: new ImageWidget(s.attrs?.src ?? '', s.attrs?.alt ?? '') });
      }
      if (s.tag === 'task-checkbox') {
        return Decoration.replace({ widget: new CheckboxWidget(s.attrs?.checked === 'true') });
      }
      if (s.tag === 'table-block') {
        return Decoration.replace({
          widget: new TableWidget(s.attrs?.table ?? '{}', Number(s.attrs?.startLine ?? '0')),
          block: true,
        });
      }
      if (s.tag === 'hr-widget') {
        return Decoration.replace({ widget: new HrWidget() });
      }
      if (s.tag === 'alert-title') {
        return Decoration.replace({
          widget: new AlertTitleWidget(s.attrs?.kind ?? 'note', s.attrs?.widget ?? ''),
        });
      }
      if (s.tag === 'math-inline') {
        return Decoration.replace({ widget: new MathInlineWidget(s.attrs?.tex ?? '') });
      }
      if (s.tag === 'math-block') {
        return Decoration.replace({ widget: new MathBlockWidget(s.attrs?.tex ?? ''), block: true });
      }
      if (s.tag === 'details-block') {
        return Decoration.replace({
          widget: new DetailsWidget(
            s.attrs?.summary ?? '',
            JSON.parse(s.attrs?.body ?? '[]'),
            Number(s.attrs?.startLine ?? '0'),
          ),
          block: true,
        });
      }
      if (s.tag === 'list-bullet') {
        const glyph = s.attrs?.widget ?? '';
        const cls = glyph === '○' ? 'cm-lp-list-bullet cm-lp-list-bullet-hollow' : 'cm-lp-list-bullet';
        return Decoration.replace({ widget: new TextWidget(glyph, cls) });
      }
      return Decoration.replace({ widget: new TextWidget(s.attrs?.widget ?? '', `cm-lp-${s.tag}`) });
    default:
      return null;
  }
}

function markAttrs(s: DecoSpec): Record<string, string> | undefined {
  if (s.tag === 'link' && s.attrs?.href) {
    return { title: s.attrs.href, 'data-href': s.attrs.href };
  }
  return undefined;
}

export type { DecorationOptions };
export { EditorView };
