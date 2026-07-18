/**
 * Pure, framework-agnostic GitHub-table source editing (R-22-05).
 *
 * These helpers operate on the *raw source lines* of a single table block
 * (`string[]`, where line 0 is the header, line 1 the delimiter, and lines 2..n
 * the body rows) and return a NEW array of source lines with a row/column added
 * or removed. They contain NO dependency on CodeMirror or the VS Code/Webview
 * APIs so they can be unit-tested directly and reused by the Webview's
 * right-click table menu (R-22-06).
 *
 * Design rules:
 * - The input array is never mutated (callers pass a slice of the document).
 * - Pipes are rebuilt uniformly (`| a | b |`) by splitting each row with
 *   `parseTableRow` and re-joining; empty cells are filled with a single space.
 * - The delimiter row (line 1) is kept consistent: added columns receive a
 *   `---` cell, and existing alignment markers (`:--`, `--:`, `:--:`) survive
 *   the rebuild verbatim.
 * - Guards: the header row cannot be deleted, and the last remaining column
 *   cannot be deleted (either request returns an unchanged copy).
 */
import { parseTableRow } from './model';

/** Default delimiter cell for a newly inserted column (no alignment). */
const DEFAULT_DELIM = '---';

/** Rebuild a single table source line from its cells (`| a | b |`). Empty cells
 *  are filled with a single space so the pipe structure stays intact. */
function buildRow(cells: string[]): string {
  const filled = cells.map((c) => (c === '' ? ' ' : c));
  return '| ' + filled.join(' | ') + ' |';
}

/** Number of columns in the table (taken from the header row). */
function columnCount(lines: string[]): number {
  return lines.length > 0 ? parseTableRow(lines[0]).length : 0;
}

/**
 * Insert an empty body row. `position === 'top'` inserts it as the first body
 * row (immediately after the delimiter); a numeric `position` inserts the new
 * row *after* the body row at that 0-based body index. A negative index (e.g. a
 * header/delimiter target) is ignored (returns an unchanged copy).
 */
export function insertTableRow(lines: string[], position: number | 'top'): string[] {
  const result = lines.slice();
  if (result.length < 2) return result; // not a well-formed table block
  const emptyRow = buildRow(new Array(columnCount(result)).fill(''));
  let insertAt: number;
  if (position === 'top') {
    insertAt = 2; // first body row (after header + delimiter)
  } else {
    if (position < 0) return result; // guard: header/delimiter cannot spawn rows here
    insertAt = Math.min(position + 3, result.length); // after body row `position`
  }
  result.splice(insertAt, 0, emptyRow);
  return result;
}

/**
 * Delete the body row at the given 0-based body index. The header (index -2)
 * and delimiter (index -1) are protected: any index outside `[0, bodyCount)`
 * returns an unchanged copy.
 */
export function deleteTableRow(lines: string[], bodyRowIndex: number): string[] {
  const result = lines.slice();
  const bodyCount = result.length - 2;
  if (bodyRowIndex < 0 || bodyRowIndex >= bodyCount) return result; // guard header/delim/out-of-range
  result.splice(bodyRowIndex + 2, 1);
  return result;
}

/**
 * Insert a new column relative to `colIndex`. `side === 'left'` inserts before
 * the column, `'right'` after it. The new header/body cells are empty (single
 * space) and the delimiter row receives a `---` cell.
 */
export function insertTableColumn(lines: string[], colIndex: number, side: 'left' | 'right'): string[] {
  if (lines.length < 2) return lines.slice();
  const at = side === 'left' ? colIndex : colIndex + 1;
  return lines.map((line, idx) => {
    const cells = parseTableRow(line);
    const clampedAt = Math.max(0, Math.min(at, cells.length));
    cells.splice(clampedAt, 0, idx === 1 ? DEFAULT_DELIM : '');
    return buildRow(cells);
  });
}

/**
 * Delete the column at `colIndex` from every row (header, delimiter, body).
 * The last remaining column is protected: a single-column table, or an
 * out-of-range index, returns an unchanged copy.
 */
export function deleteTableColumn(lines: string[], colIndex: number): string[] {
  if (lines.length < 2) return lines.slice();
  const cols = columnCount(lines);
  if (cols <= 1) return lines.slice(); // guard: never remove the last column
  if (colIndex < 0 || colIndex >= cols) return lines.slice();
  return lines.map((line) => {
    const cells = parseTableRow(line);
    if (colIndex < cells.length) cells.splice(colIndex, 1);
    return buildRow(cells);
  });
}
