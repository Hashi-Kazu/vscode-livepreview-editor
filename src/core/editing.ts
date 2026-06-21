/**
 * Pure editing helpers for list continuation, indentation and heading toggling.
 * No CodeMirror dependency — the webview keymap consumes the results.
 */

const ULIST_LINE = /^(\s*)([-*+])(\s+)(\[[ xX]\]\s+)?(.*)$/;
const OLIST_LINE = /^(\s*)(\d+)([.)])(\s+)(.*)$/;

export interface ListContinuation {
  /** Whether the line is a list item at all. */
  isList: boolean;
  /** The marker text to insert after a newline to continue the list (empty when not a list). */
  insert: string;
  /** True when the current item is empty → the marker should be removed (exit list). */
  removeMarker: boolean;
  /** Length of the leading marker (indent + bullet/number + spaces [+ checkbox]) to remove. */
  markerLength: number;
}

/**
 * Given the current line, decide how Enter should behave inside a list:
 *  - a non-empty item → continue with the next marker
 *  - an empty item → remove the marker (terminate the list)
 */
export function continueList(lineText: string): ListContinuation {
  const ul = ULIST_LINE.exec(lineText);
  if (ul) {
    const [, indent, bullet, sp, task, content] = ul;
    const markerLength = indent.length + bullet.length + sp.length + (task ? task.length : 0);
    if (content.trim() === '' && !(task && false)) {
      // Empty item (possibly an empty task) → exit the list.
      return { isList: true, insert: '', removeMarker: true, markerLength };
    }
    const next = task ? `${indent}${bullet}${sp}[ ] ` : `${indent}${bullet}${sp}`;
    return { isList: true, insert: next, removeMarker: false, markerLength };
  }

  const ol = OLIST_LINE.exec(lineText);
  if (ol) {
    const [, indent, num, sep, sp, content] = ol;
    const markerLength = indent.length + num.length + sep.length + sp.length;
    if (content.trim() === '') {
      return { isList: true, insert: '', removeMarker: true, markerLength };
    }
    const nextNum = String(parseInt(num, 10) + 1);
    return { isList: true, insert: `${indent}${nextNum}${sep}${sp}`, removeMarker: false, markerLength };
  }

  return { isList: false, insert: '', removeMarker: false, markerLength: 0 };
}

/**
 * Add or remove one indentation unit at the start of a line.
 * @param delta +1 to indent, -1 to outdent
 */
export function changeIndent(lineText: string, delta: number, unit = '  '): { text: string; shift: number } {
  if (delta > 0) {
    return { text: unit + lineText, shift: unit.length };
  }
  // Outdent: remove up to `unit.length` leading spaces (or one leading tab).
  if (lineText.startsWith('\t')) return { text: lineText.slice(1), shift: -1 };
  let remove = 0;
  while (remove < unit.length && lineText[remove] === ' ') remove++;
  return { text: lineText.slice(remove), shift: remove === 0 ? 0 : -remove };
}

const HEADING_LINE = /^(#{1,6})(\s+)(.*)$/;

/**
 * Toggle an ATX heading at the given level:
 *  - already that level → demote to a paragraph
 *  - other level/none → set to that level
 */
export function toggleHeading(lineText: string, level: number): string {
  const lv = Math.max(1, Math.min(6, level));
  const m = HEADING_LINE.exec(lineText);
  if (m) {
    if (m[1].length === lv) return m[3]; // remove heading
    return `${'#'.repeat(lv)} ${m[3]}`; // change level
  }
  return `${'#'.repeat(lv)} ${lineText}`;
}
