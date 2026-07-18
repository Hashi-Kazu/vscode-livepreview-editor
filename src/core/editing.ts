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
