/**
 * Pure editing helpers for list continuation, indentation, heading toggling,
 * and pointer-button routing.
 * No CodeMirror dependency — the webview keymap consumes the results.
 */

const ULIST_LINE = /^(\s*)([-*+])(\s+)(\[[ xX]\]\s+)?(.*)$/;
const OLIST_LINE = /^(\s*)(\d+)([.)])(\s+)(.*)$/;

/**
 * Links open only for the primary mouse button. Secondary-button presses must
 * remain untouched so the Webview/browser context menu can be shown.
 */
export function shouldOpenLinkOnMouseDown(button: number): boolean {
  return button === 0;
}

/** The minimal, DOM-independent view of a KeyboardEvent this module needs. */
export interface UndoRedoKeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** True while an IME composition is in progress. */
  isComposing: boolean;
}

/**
 * Classify a keyboard event into the host command it should trigger inside the
 * Custom Text Editor's Webview: `undo` / `redo` / `save`, or `undefined` when it
 * is an ordinary keystroke the editor should keep handling itself.
 *
 * The Webview forwards these to the extension host, which delegates Undo/Redo to
 * VS Code (`vscode.commands.executeCommand('undo'|'redo')`) so history stays
 * unified with the standard editor, and persists on save. Keys are only claimed
 * for a Ctrl/Cmd combination without Alt, and never while an IME composition is
 * active (`isComposing`), so Japanese conversion is not disturbed.
 *
 * - Ctrl/Cmd + Z            → undo
 * - Ctrl/Cmd + Shift + Z    → redo
 * - Ctrl + Y (not Cmd+Y)    → redo   (Windows/Linux redo)
 * - Ctrl/Cmd + S            → save
 */
export function classifyUndoRedoKey(
  event: UndoRedoKeyEventLike,
): 'undo' | 'redo' | 'save' | undefined {
  if (event.isComposing) return undefined;
  if (event.altKey) return undefined;
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier) return undefined;
  const key = event.key.toLowerCase();
  if (key === 's') return 'save';
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  // Ctrl+Y is redo on Windows/Linux; Cmd+Y is not a macOS redo shortcut.
  if (key === 'y' && !event.metaKey) return 'redo';
  return undefined;
}

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

/** A CodeMirror-independent transaction spec describing how Enter should edit a
 *  list line: the text change plus the resulting collapsed selection anchor. */
export interface ListEnterEdit {
  changes: { from: number; to: number; insert: string };
  selection: { anchor: number };
}

/**
 * Pure counterpart of the Webview `handleEnter` keymap (R-23). Given the caret's
 * line text, the document offset of that line's start, and the current
 * selection range, decide the exact edit Enter should apply — or `null` when the
 * caret is not a collapsed caret inside a continuable list, so the default Enter
 * behaviour should run. Extracting this lets the end-to-end continuation
 * behaviour be regression-tested against an `EditorState` without importing the
 * DOM-bound webview entry point.
 */
export function computeListEnterEdit(
  lineText: string,
  lineFrom: number,
  from: number,
  to: number,
): ListEnterEdit | null {
  if (from !== to) return null;
  const cont = continueList(lineText);
  if (!cont.isList) return null;
  if (cont.removeMarker) {
    return {
      changes: { from: lineFrom, to: lineFrom + cont.markerLength, insert: '' },
      selection: { anchor: lineFrom },
    };
  }
  return {
    changes: { from, to, insert: '\n' + cont.insert },
    selection: { anchor: from + 1 + cont.insert.length },
  };
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

/** A list line's leading indent width and the column where its content starts. */
interface ListLineIndent {
  isList: boolean;
  /** Width of the leading whitespace. */
  indent: number;
  /** Column where the item's content begins: indent + marker + spacing (+ checkbox). */
  contentCol: number;
}

function listLineIndent(lineText: string): ListLineIndent {
  const ul = ULIST_LINE.exec(lineText);
  if (ul) {
    const [, indent, bullet, sp, task] = ul;
    return {
      isList: true,
      indent: indent.length,
      contentCol: indent.length + bullet.length + sp.length + (task ? task.length : 0),
    };
  }
  const ol = OLIST_LINE.exec(lineText);
  if (ol) {
    const [, indent, num, sep, sp] = ol;
    return { isList: true, indent: indent.length, contentCol: indent.length + num.length + sep.length + sp.length };
  }
  return { isList: false, indent: 0, contentCol: 0 };
}

/**
 * Marker-width-aware list indent (R-24-01/03, Issues #53/#61). Tab deepens a
 * list item by exactly one level from its current indent. The level width is
 * taken from the nearest preceding (non-blank) list item's marker and trailing
 * spaces (`contentCol - indent`), so `10. ` adds 4 spaces while `- ` adds 2.
 *
 * Shift+Tab reverses this: it looks further back for the nearest preceding
 * list item whose indent is strictly smaller than the current one, and
 * restores that item's own indent width (not its content column), which is
 * exactly the value Tab would have produced for a sibling at that level.
 *
 * `precedingLines` must be the document's lines strictly above `lineText`, in
 * document order; they are only read, never mutated. Returns `null` when
 * `lineText` itself is not a list line, so the caller can fall back to the
 * plain (non-list) Tab/Shift-Tab behavior (R-24-01/02).
 */
export function changeListIndent(
  lineText: string,
  delta: number,
  precedingLines: string[],
): { text: string; shift: number } | null {
  const cur = listLineIndent(lineText);
  if (!cur.isList) return null;

  let target: number;
  if (delta > 0) {
    // Only the immediately preceding non-blank line counts as "the previous
    // item" — a non-list line breaks the list context (no parent to attach to).
    let i = precedingLines.length - 1;
    while (i >= 0 && precedingLines[i].trim() === '') i--;
    const ref = i >= 0 ? listLineIndent(precedingLines[i]) : null;
    if (!ref || !ref.isList) return { text: lineText, shift: 0 };
    const levelWidth = ref.contentCol - ref.indent;
    target = cur.indent + levelWidth;
  } else {
    let found: number | null = null;
    for (let i = precedingLines.length - 1; i >= 0; i--) {
      if (precedingLines[i].trim() === '') continue;
      const info = listLineIndent(precedingLines[i]);
      if (!info.isList) break; // left the list context
      if (info.indent < cur.indent) {
        found = info.indent;
        break;
      }
    }
    target = found ?? 0;
    if (target >= cur.indent) return { text: lineText, shift: 0 };
  }

  return { text: ' '.repeat(target) + lineText.slice(cur.indent), shift: target - cur.indent };
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
