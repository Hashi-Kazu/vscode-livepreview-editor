/**
 * Pure text-formatting helpers for the editor's toggle commands (bold, italic,
 * strikethrough, highlight, inline code). No CodeMirror / VS Code dependency —
 * the webview keymap applies the result as a single transaction.
 */

export interface WrapResult {
  /** The new document text. */
  text: string;
  /** New selection start/end (so the wrapped content stays selected). */
  selFrom: number;
  selTo: number;
}

/**
 * Toggle a symmetric wrapping marker around `[from, to)` of `doc`.
 *
 * Behaviour (matching common editors / Obsidian):
 *  - If the marker already surrounds the selection (just outside, or as the
 *    selection's own edges), it is removed.
 *  - Otherwise the marker is added around the selection.
 *  - With an empty selection, an empty pair is inserted and the caret is placed
 *    between the markers.
 */
export function toggleWrap(doc: string, from: number, to: number, marker: string): WrapResult {
  const len = marker.length;
  const selected = doc.slice(from, to);

  // Empty selection → insert an empty pair and place the caret in the middle.
  if (from === to) {
    const text = doc.slice(0, from) + marker + marker + doc.slice(to);
    return { text, selFrom: from + len, selTo: from + len };
  }

  const outerBefore = doc.slice(Math.max(0, from - len), from);
  const outerAfter = doc.slice(to, to + len);

  // Marker just outside the selection → unwrap (remove the outer markers).
  if (outerBefore === marker && outerAfter === marker) {
    const text = doc.slice(0, from - len) + selected + doc.slice(to + len);
    return { text, selFrom: from - len, selTo: to - len };
  }

  // Marker is part of the selection edges → unwrap (strip inner markers).
  if (selected.length >= 2 * len && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(len, selected.length - len);
    const text = doc.slice(0, from) + inner + doc.slice(to);
    return { text, selFrom: from, selTo: to - 2 * len };
  }

  // Otherwise wrap the selection.
  const text = doc.slice(0, from) + marker + selected + marker + doc.slice(to);
  return { text, selFrom: from + len, selTo: to + len };
}
