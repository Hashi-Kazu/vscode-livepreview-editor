/**
 * Pure synchronisation helpers shared by the extension host and the Webview.
 *
 * These functions encode the decision logic for keeping a CodeMirror document,
 * the VS Code `TextDocument`, and external on-disk changes in agreement. They
 * are intentionally free of any VS Code / CodeMirror imports so they can be
 * unit-tested directly.
 */

export interface ResyncParams {
  /** True when the incoming change originated from the Webview itself. */
  isFromWebview: boolean;
  /** Text the Webview currently believes the document holds. */
  webviewText: string;
  /** New text of the underlying document. */
  documentText: string;
}

/**
 * Decide whether the Webview must reload its contents from the document.
 *
 * An external change (Git pull, another editor, format-on-save) should trigger
 * a resync, but an echo of the Webview's own edit must not — otherwise the
 * cursor jumps and edits fight each other.
 */
export function shouldResync({ isFromWebview, webviewText, documentText }: ResyncParams): boolean {
  if (isFromWebview) return false;
  return webviewText !== documentText;
}

/** A line/character position (0-based), mirroring vscode.Position. */
export interface Pos {
  line: number;
  character: number;
}

export interface TextRange {
  start: Pos;
  end: Pos;
}

/**
 * Compute the minimal replaced range between two strings so we can apply a
 * single `WorkspaceEdit` instead of replacing the whole document (which would
 * blow away VS Code's undo granularity).
 */
export function diffRange(oldText: string, newText: string): { range: TextRange; newText: string } | null {
  if (oldText === newText) return null;

  // Common prefix length.
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) start++;

  // Common suffix length (not overlapping the prefix).
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  return {
    range: {
      start: offsetToPos(oldText, start),
      end: offsetToPos(oldText, oldEnd),
    },
    newText: newText.slice(start, newEnd),
  };
}

/** Convert an absolute offset into a {line, character} position. */
export function offsetToPos(text: string, offset: number): Pos {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

/**
 * Expand a selection (anchor/head offsets) into the set of 0-based line indices
 * that should display raw Markdown. Lines touched by any selection are included.
 */
export function cursorLinesFromSelections(
  text: string,
  selections: { from: number; to: number }[],
): Set<number> {
  const lineStarts = computeLineStarts(text);
  const set = new Set<number>();
  for (const sel of selections) {
    const from = Math.min(sel.from, sel.to);
    const to = Math.max(sel.from, sel.to);
    const startLine = lineAt(lineStarts, from);
    const endLine = lineAt(lineStarts, to);
    for (let l = startLine; l <= endLine; l++) set.add(l);
  }
  return set;
}

/**
 * Whether a CodeMirror document change should be pushed to the host *now*.
 *
 * During IME composition (Japanese/CJK conversion) we must NOT emit edits — the
 * intermediate, un-confirmed characters would cause the decorations to flicker
 * and the host document to churn. We defer until composition ends.
 */
export function shouldEmitEdit(params: { docChanged: boolean; composing: boolean; applyingRemote: boolean }): boolean {
  if (!params.docChanged) return false;
  if (params.applyingRemote) return false;
  if (params.composing) return false;
  return true;
}

/** Normalise any CRLF/CR to LF (the convention used on the webview/CodeMirror side). */
export function toLF(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Convert LF text to the given end-of-line sequence (to preserve a file's EOL). */
export function fromLF(text: string, eol: '\n' | '\r\n'): string {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

/** Result of {@link toggleTaskAt}. */
export interface ToggleResult {
  /** The full document text after toggling (unchanged if the line is not a task). */
  text: string;
  /** Whether a task checkbox was actually toggled. */
  changed: boolean;
  /** New checked state (only meaningful when `changed`). */
  checked: boolean;
}

/**
 * Toggle the task checkbox on a given 0-based line: `- [ ]` ⇄ `- [x]`.
 * Pure: returns the new document text without mutating the input. Lines that are
 * not task items are returned unchanged.
 */
export function toggleTaskAt(doc: string, line: number): ToggleResult {
  const lines = doc.split('\n');
  if (line < 0 || line >= lines.length) return { text: doc, changed: false, checked: false };
  // Tolerate a trailing CR so CRLF documents still match.
  const m = /^(\s*[-*+]\s+\[)([ xX])(\][\s\S]*?)(\r?)$/.exec(lines[line]);
  if (!m) return { text: doc, changed: false, checked: false };
  const nowChecked = m[2].toLowerCase() === 'x';
  const next = nowChecked ? ' ' : 'x';
  lines[line] = m[1] + next + m[3] + m[4];
  return { text: lines.join('\n'), changed: true, checked: !nowChecked };
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(lineStarts: number[], offset: number): number {
  // Binary search for the greatest lineStart <= offset.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
