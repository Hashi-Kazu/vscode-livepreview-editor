/**
 * Pure, framework-agnostic GitHub-table source editing (R-22-05).
 *
 * These helpers operate on the *raw source lines* of a single table block
 * (`string[]`, where line 0 is the header, line 1 the delimiter, and lines 2..n
 * the body rows) and return a NEW array of source lines with a row/column added
 * or removed, or a single cell updated (`updateTableCell`). They contain NO
 * dependency on CodeMirror or the VS Code/Webview APIs so they can be unit-tested
 * directly and reused by the Webview's right-click table menu (R-22-06) and
 * direct cell editing (R-22-07).
 *
 * Design rules:
 * - The input array is never mutated (callers pass a slice of the document).
 * - Pipes are rebuilt uniformly (`| a | b |`) by splitting each row with
 *   `parseTableRow` and re-joining; empty cells are filled with a single space,
 *   and a literal `|` inside a cell is escaped as `\|` (inverse of
 *   `parseTableRow`) so it never splits the row.
 * - The delimiter row (line 1) is kept consistent: added columns receive a
 *   `---` cell, and existing alignment markers (`:--`, `--:`, `:--:`) survive
 *   the rebuild verbatim.
 * - Guards: the header row cannot be deleted, and the last remaining column
 *   cannot be deleted (either request returns an unchanged copy).
 */
import { parseTableRow } from './model';

/** Default delimiter cell for a newly inserted column (no alignment). */
const DEFAULT_DELIM = '---';

/** Escape a literal pipe inside a cell value as `\|` so it does not split the
 *  row when re-serialised. `parseTableRow` performs the inverse (unescape). */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/** Rebuild a single table source line from its cells (`| a | b |`). Empty cells
 *  are filled with a single space so the pipe structure stays intact; literal
 *  pipes inside a cell are escaped (`\|`) so the row structure survives. */
function buildRow(cells: string[]): string {
  const filled = cells.map((c) => (c === '' ? ' ' : escapeCell(c)));
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

/**
 * Replace the text of a single cell (R-22-05). `row.type === 'header'` targets
 * the header line (index 0); `row.type === 'body'` targets body row `index`
 * (0-based, mapping to source line `index + 2`). The delimiter row (line 1) is
 * never editable and any out-of-range row/column returns an unchanged copy.
 *
 * Only the target row is re-serialised, so the delimiter row — and therefore the
 * column alignment markers — survive verbatim. Literal pipes in `value` are
 * escaped (`\|`) by `buildRow` so the row structure is preserved. The input
 * array is never mutated.
 */
export function updateTableCell(
  lines: string[],
  row: { type: 'header' } | { type: 'body'; index: number },
  colIndex: number,
  value: string,
): string[] {
  const result = lines.slice();
  if (result.length < 2) return result; // not a well-formed table block
  const lineIndex = row.type === 'header' ? 0 : row.index + 2;
  if (row.type === 'body' && (row.index < 0 || lineIndex >= result.length)) return result;
  if (lineIndex === 1) return result; // guard: the delimiter row has no editable cell
  const cells = parseTableRow(result[lineIndex]);
  if (colIndex < 0 || colIndex >= cells.length) return result; // non-existent column
  cells[colIndex] = value;
  result[lineIndex] = buildRow(cells);
  return result;
}
