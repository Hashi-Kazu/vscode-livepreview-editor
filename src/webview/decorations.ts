/**
 * Bridge between the pure {@link DecoSpec} model and CodeMirror 6 decorations.
 * This file DOES import CodeMirror, so it lives in the Webview bundle and is not
 * exercised by the Node-based Vitest suite (which tests `src/core` directly).
 */
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
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

/** Approximate rendered line height (px). Block widgets must report an
 *  `estimatedHeight` close to their real height or CodeMirror's block-height
 *  accounting drifts from the painted DOM, which throws off `posAtCoords` for
 *  lines *below* the widget (clicks land on the wrong line). 22px matches a
 *  plain editor line at the default font size; tables render taller (see
 *  TABLE_ROW_PX). The initial estimate narrows the gap before the `updateDOM`
 *  `requestMeasure()` correction lands (R-28-10). */
const LINE_PX = 22;

/** Real per-row height of a rendered table row. Cells use `padding: 6px 13px`
 *  and `line-height: 1.6` at `font-size: 0.95em`, so a row paints at ≈ 34px —
 *  noticeably taller than a plain line. Using this for the table estimate
 *  (instead of LINE_PX) keeps the pre-measure block height close to reality,
 *  reducing click-position drift before the `requestMeasure` correction lands
 *  (R-28-10). */
const TABLE_ROW_PX = 34;

class TableWidget extends WidgetType {
  constructor(private readonly json: string, private readonly startLine: number) {
    super();
  }
  eq(other: TableWidget) {
    return other.json === this.json && other.startLine === this.startLine;
  }
  /** header + body rows × real row height + margin chrome (≈15px for
   *  `margin: 0.5em 0` plus 1px border-collapse). Uses TABLE_ROW_PX (≈34px,
   *  not LINE_PX) because padded table cells paint taller than a plain line;
   *  the `updateDOM` `requestMeasure()` corrects any residual (R-28-10). */
  get estimatedHeight() {
    let rows = 1; // header
    try {
      rows += (JSON.parse(this.json) as ParsedTable).rows.length;
    } catch {
      /* fall back to header-only */
    }
    return rows * TABLE_ROW_PX + 15;
  }
  toDOM(view: EditorView) {
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
        appendInlineCell(td, row[idx] ?? '');
        if (data.align[idx] && data.align[idx] !== 'none') td.style.textAlign = data.align[idx];
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    // Request a re-measure immediately after the initial mount so CodeMirror
    // reconciles block heights against the real painted DOM on the next frame
    // (R-28-10). The measure runs after the DOM is inserted into the tree.
    view.requestMeasure();
    return table;
  }
  /** Called when the widget DOM already exists in the tree (update path).
   *  Reuse existing DOM (return true) and schedule a re-measure so CodeMirror
   *  reconciles block heights against the real painted DOM, keeping
   *  `posAtCoords` accurate for lines below the table (R-28-10). */
  updateDOM(_dom: HTMLElement, view: EditorView): boolean {
    view.requestMeasure();
    return true;
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
  constructor(private readonly summary: string, private readonly body: string[]) {
    super();
  }
  eq(other: DetailsWidget) {
    return other.summary === this.summary && JSON.stringify(other.body) === JSON.stringify(this.body);
  }
  /** Closed ≈ 1 line; open ≈ summary + body lines. The accordion can change
   *  height at runtime (toggle) — `toDOM` requests a re-measure so CodeMirror
   *  re-reconciles block heights after the user opens/closes it. */
  get estimatedHeight() {
    const open = openDetails.has(this.summary);
    const lines = open ? 1 + this.body.length : 1;
    return lines * LINE_PX + 4;
  }
  toDOM(view: EditorView) {
    const details = document.createElement('details');
    details.className = 'cm-lp-details';
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
    // Request a re-measure immediately after the initial mount so CodeMirror
    // reconciles block heights against the real painted DOM on the next frame
    // (R-28-10). The measure runs after the DOM is inserted into the tree.
    view.requestMeasure();
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

/** Webview-side base URI (set by the host) used to resolve relative image paths. */
let resourceBase = '';
export function setResourceBase(base: string) {
  resourceBase = base.replace(/\/+$/, '');
}

/** Resolve an image src: absolute/data URLs as-is, relative paths via the base. */
function resolveSrc(src: string): string {
  if (/^(https?:|data:|vscode-webview-resource:|vscode-resource:)/i.test(src)) return src;
  if (!resourceBase) return src;
  const clean = src.replace(/^\.\//, '').replace(/^\//, '');
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
  for (const { s } of sorted) {
    const deco = toDecoration(s);
    if (!deco) continue;
    builder.add(s.from, s.type === 'line' ? s.from : s.to, deco);
  }
  return builder.finish();
}

function sideOf(s: DecoSpec): number {
  if (s.type === 'line') return -2;
  if (s.type === 'mark') return -1;
  return 0; // hide / replaceWidget
}

function toDecoration(s: DecoSpec): Decoration | null {
  switch (s.type) {
    case 'line':
      return Decoration.line({ class: s.className ?? '' });
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
      if (s.tag === 'details-block') {
        return Decoration.replace({
          widget: new DetailsWidget(s.attrs?.summary ?? '', JSON.parse(s.attrs?.body ?? '[]')),
          block: true,
        });
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
