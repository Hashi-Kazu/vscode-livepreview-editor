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

class TableWidget extends WidgetType {
  constructor(private readonly json: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.json === this.json;
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
    data.header.forEach((cell, idx) => {
      const th = document.createElement('th');
      appendInlineCell(th, cell);
      if (data.align[idx] && data.align[idx] !== 'none') th.style.textAlign = data.align[idx];
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of data.rows) {
      const tr = document.createElement('tr');
      for (let idx = 0; idx < data.header.length; idx++) {
        const td = document.createElement('td');
        appendInlineCell(td, row[idx] ?? '');
        if (data.align[idx] && data.align[idx] !== 'none') td.style.textAlign = data.align[idx];
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }
  ignoreEvent() {
    return false;
  }
}

/** Collapsed `<details>` accordion. Rendered as a real, interactive
 *  `<details>` element so the browser handles open/close natively; it starts
 *  closed (collapsed by default per R-27). The inner content is intentionally a
 *  short placeholder — full inner editing happens when the caret enters the
 *  block (the host shows the raw lines then). */
class DetailsWidget extends WidgetType {
  constructor(private readonly summary: string) {
    super();
  }
  eq(other: DetailsWidget) {
    return other.summary === this.summary;
  }
  toDOM() {
    const details = document.createElement('details');
    details.className = 'cm-lp-details';
    // closed by default (no `open` attribute)
    const summary = document.createElement('summary');
    summary.className = 'cm-lp-details-summary';
    // Our own marker span (the native triangle is hidden in CSS) so the open /
    // closed glyph follows the theme and reads as plain inline text (R-27).
    const marker = document.createElement('span');
    marker.className = 'cm-lp-details-marker';
    marker.textContent = '▶'; // ▶ closed
    summary.appendChild(marker);
    const label = document.createElement('span');
    label.className = 'cm-lp-details-label';
    // Render minimal inline Markdown (bold / italic / code) in the summary so
    // `**...**` shows as bold rather than literal asterisks (MAIO look).
    appendInlineCell(label, this.summary || '詳細');
    summary.appendChild(label);
    // Keep the marker in sync with the native open state on toggle.
    details.addEventListener('toggle', () => {
      marker.textContent = details.open ? '▼' : '▶'; // ▼ / ▶
    });
    details.appendChild(summary);
    const hint = document.createElement('div');
    hint.className = 'cm-lp-details-hint';
    hint.textContent = '（クリックして編集するにはこの行にカーソルを移動）';
    details.appendChild(hint);
    return details;
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
        return Decoration.replace({ widget: new TableWidget(s.attrs?.table ?? '{}'), block: true });
      }
      if (s.tag === 'hr-widget') {
        return Decoration.replace({ widget: new HrWidget() });
      }
      if (s.tag === 'details-block') {
        return Decoration.replace({ widget: new DetailsWidget(s.attrs?.summary ?? ''), block: true });
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
