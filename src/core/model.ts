/**
 * Pure, framework-agnostic Markdown decoration model.
 *
 * This module contains NO dependency on CodeMirror or the VS Code/Webview APIs.
 * It takes a document string plus the set of "cursor lines" (lines where the raw
 * Markdown should stay visible, Obsidian Live-Preview style) and returns a flat
 * list of {@link DecoSpec} descriptors with absolute document offsets.
 *
 * The Webview layer (`src/webview`) maps these descriptors onto CodeMirror 6
 * `Decoration` objects. Keeping the logic here pure makes it unit-testable with
 * Vitest without spinning up a DOM or an editor instance.
 */

/** Kind of decoration the Webview should materialise. */
export type DecoType =
  | 'hide' // Decoration.replace with no widget — collapses a syntax marker.
  | 'mark' // Decoration.mark — styles a range while keeping the text.
  | 'line' // Decoration.line — styles the whole line.
  | 'replaceWidget'; // Decoration.replace with a widget (bullet, image, …).

/** A single decoration descriptor with absolute offsets into the document. */
export interface DecoSpec {
  from: number;
  to: number;
  type: DecoType;
  /** Semantic tag, e.g. 'strong', 'em', 'heading', 'list-bullet', 'codeblock'. */
  tag: string;
  /** CSS class the Webview should apply (mark/line). */
  className?: string;
  /** Extra attributes (href, src, alt, level, widget text, …). */
  attrs?: Record<string, string>;
}

export interface DecorationOptions {
  /**
   * Optional inclusive 0-based line window. When set, only lines inside the
   * window are decorated. Used by the Webview to limit work to the viewport.
   */
  lineRange?: { startLine: number; endLine: number };
}

export interface LineInfo {
  text: string;
  /** Absolute offset of the first character of the line. */
  from: number;
  /** Absolute offset just past the last character (before the newline). */
  to: number;
}

/** Split a document into lines while tracking absolute offsets.
 *  A trailing CR (from CRLF endings) is excluded from `text`/`to` so block
 *  regexes anchored with `$` still match; the CR simply stays undecorated. */
export function splitLines(doc: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let from = 0;
  for (const raw of doc.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ text, from, to: from + text.length });
    from += raw.length + 1; // +1 for the consumed '\n'
  }
  return lines;
}

/** Result of scanning the document for fenced code blocks. */
export interface CodeBlockInfo {
  /** Per line: 'open' | 'close' | 'inside' | null. */
  role: (null | 'open' | 'close' | 'inside')[];
  /** For each line index, the [openLine, closeLine] block it belongs to. */
  blockOf: (null | { open: number; close: number })[];
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/** Identify fenced code blocks (``` or ~~~). Robust to unterminated fences. */
export function detectCodeBlocks(lines: LineInfo[]): CodeBlockInfo {
  const role: CodeBlockInfo['role'] = new Array(lines.length).fill(null);
  const blockOf: CodeBlockInfo['blockOf'] = new Array(lines.length).fill(null);

  let open = -1;
  let fenceChar = '';
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i].text);
    if (open === -1) {
      if (m) {
        open = i;
        fenceChar = m[2][0];
        fenceLen = m[2].length;
      }
    } else {
      // Inside a block: a closing fence must use the same char and be >= length
      // and carry no info string.
      if (m && m[2][0] === fenceChar && m[2].length >= fenceLen && m[3].trim() === '') {
        role[open] = 'open';
        role[i] = 'close';
        for (let j = open; j <= i; j++) {
          blockOf[j] = { open, close: i };
          if (role[j] === null) role[j] = 'inside';
        }
        open = -1;
      }
    }
  }
  // Unterminated fence: treat the opener and the rest as a block to end of doc.
  if (open !== -1) {
    const close = lines.length - 1;
    role[open] = 'open';
    for (let j = open; j <= close; j++) {
      blockOf[j] = { open, close };
      if (role[j] === null) role[j] = 'inside';
    }
  }
  return { role, blockOf };
}

export interface TableBlock {
  start: number; // first line index (header)
  end: number; // last line index
}

/** Identify contiguous GitHub-table blocks as line ranges. */
export function detectTableBlocks(lines: LineInfo[], code: CodeBlockInfo): TableBlock[] {
  const blocks: TableBlock[] = [];
  const delimRe = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  for (let i = 0; i < lines.length - 1; i++) {
    if (code.role[i] || code.role[i + 1]) continue;
    if (
      lines[i].text.includes('|') &&
      lines[i + 1].text.includes('|') &&
      delimRe.test(lines[i + 1].text) &&
      lines[i + 1].text.includes('-') &&
      parseTableRow(lines[i].text).length === parseTableRow(lines[i + 1].text).length
    ) {
      let j = i + 2;
      while (j < lines.length && !code.role[j] && lines[j].text.includes('|') && lines[j].text.trim() !== '') j++;
      blocks.push({ start: i, end: j - 1 });
      i = j - 1;
    }
  }
  return blocks;
}

export interface DetailsBlock {
  start: number; // line index of the `<details ...>` opener
  end: number; // line index of the `</details>` closer
  summary: string; // text inside <summary>…</summary> (may be empty)
  /** Body lines (between </summary> and </details>), with structural HTML tags
   *  stripped. Leading/trailing empty lines are trimmed; interior blanks kept. */
  body: string[];
  /** Absolute offsets of the inner content (between summary close and </details>). */
  contentFrom: number;
  contentTo: number;
}

const DETAILS_OPEN_RE = /^\s*<details(\s[^>]*)?>/i;
const DETAILS_CLOSE_RE = /^\s*<\/details>\s*$/i;
const SUMMARY_INLINE_RE = /<summary[^>]*>([\s\S]*?)<\/summary>/i;

/**
 * Match the structural HTML tags of a `<details>` accordion *within a single
 * line* so the Webview can hide just the angle-bracket tag spans while leaving
 * any summary body text visible (and editable). We deliberately keep this to the
 * tags that delimit the accordion — `<details …>`, `<summary …>`, `</summary>`,
 * `</details>` — and never touch the user's prose.
 */
const DETAILS_TAG_RE = /<details(?:\s[^>]*)?>|<summary(?:\s[^>]*)?>|<\/summary>|<\/details>/gi;

/**
 * Return the in-line offset ranges (relative to the line text) occupied by the
 * structural `<details>`/`<summary>` HTML tags. These ranges should be hidden
 * regardless of cursor position so the raw `<details><summary>…</summary>` /
 * `</details>` markup never leaks into the rendered view (the summary text
 * between the tags stays visible). Pure — operates on a string only.
 */
export function detailsTagRanges(lineText: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  DETAILS_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DETAILS_TAG_RE.exec(lineText)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

/**
 * Identify HTML `<details><summary>…</summary>…</details>` accordion blocks as
 * line ranges. Pure & framework-agnostic. Code blocks are skipped (a `<details>`
 * inside a fenced block is literal text, not an accordion). Unterminated blocks
 * (no closing `</details>`) are ignored so we never collapse to end-of-file.
 *
 * The summary may live on the same line as `<details>` or on its own line(s);
 * we scan from the opener until the first `</summary>` (or block end).
 */
export function detectDetailsBlocks(lines: LineInfo[], code: CodeBlockInfo): DetailsBlock[] {
  const blocks: DetailsBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (code.role[i]) continue;
    if (!DETAILS_OPEN_RE.test(lines[i].text)) continue;
    // Find the matching close, ignoring nested code blocks.
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (code.role[j]) continue;
      if (DETAILS_CLOSE_RE.test(lines[j].text)) {
        close = j;
        break;
      }
      // A second <details> opener before a close: bail (avoid mis-pairing).
      if (DETAILS_OPEN_RE.test(lines[j].text)) break;
    }
    if (close === -1) continue; // unterminated — leave as raw text
    // Extract the summary text (may span the opener line and following lines).
    const joined = lines.slice(i, close + 1).map((l) => l.text).join('\n');
    const sm = SUMMARY_INLINE_RE.exec(joined);
    const summary = sm ? sm[1].replace(/\s+/g, ' ').trim() : '';
    // Body = every line strictly between </summary> and </details>, with the
    // structural <details>/<summary>/</summary>/</details> tags removed. The
    // </summary> may sit on the opener line or a later line; scan for it.
    let summaryCloseLine = i;
    for (let j = i; j <= close; j++) {
      if (/<\/summary>/i.test(lines[j].text)) {
        summaryCloseLine = j;
        break;
      }
    }
    const body: string[] = [];
    for (let j = summaryCloseLine; j < close; j++) {
      let text = lines[j].text;
      if (j === summaryCloseLine) {
        // On the summary-close line, keep only what FOLLOWS </summary> (the text
        // between the summary tags is the summary, not body).
        const cm = /<\/summary>/i.exec(text);
        text = cm ? text.slice(cm.index + cm[0].length) : '';
      }
      // Strip any remaining structural tags; what remains is body prose.
      const stripped = text.replace(DETAILS_TAG_RE, '').trim();
      if (j === summaryCloseLine) {
        if (stripped !== '') body.push(stripped);
        continue;
      }
      body.push(stripped);
    }
    // Trim leading/trailing empty lines (interior blanks preserved).
    while (body.length && body[0] === '') body.shift();
    while (body.length && body[body.length - 1] === '') body.pop();
    blocks.push({
      start: i,
      end: close,
      summary,
      body,
      contentFrom: lines[i].from,
      contentTo: lines[close].to,
    });
    i = close;
  }
  return blocks;
}

export interface MathBlock {
  start: number; // first line index (the `$$` opener)
  end: number; // last line index (the `$$` closer)
  tex: string; // the TeX source between the fences (newline-joined)
}

/**
 * Identify block math `$$…$$` fences as line ranges. Pure & framework-agnostic.
 * Two forms are recognised:
 *   1. Single line: `$$ E = mc^2 $$` (content between the fences on one line).
 *   2. Multi-line: an opening line beginning with `$$` and a later line that is
 *      only `$$` (whitespace-trimmed) as the closer.
 * Fenced code blocks are skipped (a `$$` inside a code block is literal text).
 * A leading `\$$` is an escaped literal and never opens a block. Unterminated
 * multi-line fences (no closing `$$` line) are ignored so we never collapse to
 * end-of-file.
 */
export function detectMathBlocks(lines: LineInfo[], code: CodeBlockInfo): MathBlock[] {
  const blocks: MathBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (code.role[i]) continue;
    const t = lines[i].text;
    // Opener: `$$` after optional leading whitespace (so `\$$…` does not match).
    const open = /^\s*\$\$/.exec(t);
    if (!open) continue;
    const rest = t.slice(open[0].length);
    // Single-line form: `$$ … $$` with non-empty content between the fences.
    const single = /^(.*?)\$\$\s*$/.exec(rest);
    if (single && single[1].trim() !== '') {
      blocks.push({ start: i, end: i, tex: single[1].trim() });
      continue;
    }
    // Multi-line form: scan for a line that is only `$$` (code blocks excluded).
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (code.role[j]) continue;
      if (/^\s*\$\$\s*$/.test(lines[j].text)) {
        close = j;
        break;
      }
    }
    if (close === -1) continue; // unterminated — leave as raw text
    const body: string[] = [];
    if (rest.trim() !== '') body.push(rest.trim());
    for (let j = i + 1; j < close; j++) body.push(lines[j].text);
    blocks.push({ start: i, end: close, tex: body.join('\n').trim() });
    i = close;
  }
  return blocks;
}

/** Split a table row into trimmed cell strings (outer pipes ignored). */
export function parseTableRow(text: string): string[] {
  let s = text.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * Map a rendered table row index to its 0-based source document line, given the
 * block's start line. The header is `startLine`; the delimiter row (`startLine
 * + 1`) is skipped (returns null); each body row `rows[k]` maps to `startLine +
 * 2 + k`. Used by the Webview to set `data-line` so a click can move the caret
 * into the block (making cells editable). Pure & framework-agnostic.
 */
export function tableRowSourceLine(startLine: number, kind: 'header' | 'delim' | 'row', rowIndex = 0): number | null {
  if (kind === 'header') return startLine;
  if (kind === 'delim') return null; // delimiter row carries no editable cell
  return startLine + 2 + rowIndex;
}

/** Parse a table block into header + body rows + column alignments. */
export function parseTable(lines: LineInfo[], block: TableBlock): {
  header: string[];
  align: ('left' | 'center' | 'right' | 'none')[];
  rows: string[][];
} {
  const header = parseTableRow(lines[block.start].text);
  const align = parseTableRow(lines[block.start + 1].text).map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : 'none';
  });
  const rows: string[][] = [];
  for (let i = block.start + 2; i <= block.end; i++) rows.push(parseTableRow(lines[i].text));
  return { header, align, rows };
}

interface InlineMatch {
  start: number; // index within text
  end: number; // exclusive index within text
  specs: (base: number, cursorLine: boolean) => DecoSpec[];
}

const INLINE_CODE_RE = /`([^`\n]+)`/y;
// Inline math $…$ (KaTeX). Open `$` directly followed by a non-space non-`$`
// char; close `$` directly preceded by a non-space non-`$` char; no `$`/newline
// inside. `\$` (escaped dollar) is rejected by the caller (preceding backslash).
const MATH_INLINE_RE = /\$([^\s$](?:[^$\n]*[^\s$])?)\$/y;
const IMAGE_RE = /!\[([^\]\n]*)\]\(([^)\n]+)\)/y;
const LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/y;
const BOLD_RE = /(\*\*|__)(\S[\s\S]*?\S|\S)\1/y;
const ITALIC_RE = /(\*|_)([^\s*_][^*_\n]*?[^\s*_]|[^\s*_])\1/y;
const STRIKE_RE = /~~(\S[\s\S]*?\S|\S)~~/y;
const HIGHLIGHT_RE = /==(\S[\s\S]*?\S|\S)==/y;
const AUTOLINK_RE = /<((?:https?:\/\/|mailto:)[^>\s]+|[^>\s@]+@[^>\s@]+\.[^>\s@]+)>/y;
const ESCAPABLE = /[\\`*_{}\[\]()#+\-.!~>=|"']/;

/**
 * Parse inline Markdown within a single text segment.
 * @param text   the line (or sub-segment) text
 * @param base   absolute offset of `text[0]` in the document
 * @param cursorLine whether the raw syntax should remain visible
 * @param segStart index in `text` to start scanning from
 */
export function parseInline(text: string, base: number, cursorLine: boolean, segStart = 0): DecoSpec[] {
  const out: DecoSpec[] = [];
  let i = segStart;
  while (i < text.length) {
    let matched: InlineMatch | null = null;

    // Backslash escape: `\*` renders the literal char and must NOT start a
    // construct. Hide the backslash off-cursor and skip the escaped char.
    if (text[i] === '\\' && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) {
      if (!cursorLine) {
        out.push({ from: base + i, to: base + i + 1, type: 'hide', tag: 'escape' });
      }
      i += 2;
      continue;
    }

    // Priority order: inline code → image → link → bold → italic.
    INLINE_CODE_RE.lastIndex = i;
    let m = INLINE_CODE_RE.exec(text);
    if (m && m.index === i) {
      const content = m[1];
      matched = {
        start: i,
        end: i + m[0].length,
        specs: (b, cur) => {
          const specs: DecoSpec[] = [
            { from: b + i + 1, to: b + i + 1 + content.length, type: 'mark', tag: 'code', className: 'cm-lp-code' },
          ];
          if (!cur) {
            specs.push({ from: b + i, to: b + i + 1, type: 'hide', tag: 'code-mark' });
            specs.push({ from: b + i + 1 + content.length, to: b + i + m![0].length, type: 'hide', tag: 'code-mark' });
          }
          return specs;
        },
      };
    }

    // Inline math $…$ — priority right after inline code. A `$` immediately
    // preceded by a backslash is an escaped literal (`\$`), not a delimiter.
    if (!matched && text[i] === '$' && !(i > 0 && text[i - 1] === '\\')) {
      MATH_INLINE_RE.lastIndex = i;
      m = MATH_INLINE_RE.exec(text);
      if (m && m.index === i) {
        const tex = m[1];
        const full = m[0];
        matched = {
          start: i,
          end: i + full.length,
          specs: (b, cur) => {
            // On the cursor line the raw `$…$` stays visible (editable); off
            // cursor it becomes a KaTeX widget. Never mutate the source (R-01-02).
            if (cur) return [];
            return [
              { from: b + i, to: b + i + full.length, type: 'replaceWidget', tag: 'math-inline', attrs: { tex } },
            ];
          },
        };
      }
    }

    if (!matched) {
      IMAGE_RE.lastIndex = i;
      m = IMAGE_RE.exec(text);
      if (m && m.index === i) {
        const alt = m[1];
        const url = m[2];
        const full = m[0];
        matched = {
          start: i,
          end: i + full.length,
          specs: (b, cur) => {
            if (cur) {
              return [{ from: b + i, to: b + i + full.length, type: 'mark', tag: 'image-src', className: 'cm-lp-image-src' }];
            }
            return [
              {
                from: b + i,
                to: b + i + full.length,
                type: 'replaceWidget',
                tag: 'image',
                attrs: { src: url, alt, widget: alt || url },
              },
            ];
          },
        };
      }
    }

    if (!matched) {
      LINK_RE.lastIndex = i;
      m = LINK_RE.exec(text);
      if (m && m.index === i) {
        const label = m[1];
        const url = m[2];
        const full = m[0];
        const labelStart = i + 1;
        const labelEnd = labelStart + label.length;
        matched = {
          start: i,
          end: i + full.length,
          specs: (b, cur) => {
            const specs: DecoSpec[] = [
              { from: b + labelStart, to: b + labelEnd, type: 'mark', tag: 'link', className: 'cm-lp-link', attrs: { href: url } },
            ];
            if (!cur) {
              specs.push({ from: b + i, to: b + labelStart, type: 'hide', tag: 'link-mark' });
              specs.push({ from: b + labelEnd, to: b + i + full.length, type: 'hide', tag: 'link-mark' });
            }
            return specs;
          },
        };
      }
    }

    if (!matched) {
      BOLD_RE.lastIndex = i;
      m = BOLD_RE.exec(text);
      // Underscore emphasis must not open/close intra-word (CommonMark rule).
      if (m && m.index === i && (m[1] !== '__' || underscoreBoundaryOk(text, i, i + m[0].length))) {
        const marker = m[1]; // ** or __
        const content = m[2];
        const full = m[0];
        const contentStart = i + marker.length;
        const contentEnd = contentStart + content.length;
        matched = {
          start: i,
          end: i + full.length,
          specs: (b, cur) => {
            const specs: DecoSpec[] = [
              { from: b + contentStart, to: b + contentEnd, type: 'mark', tag: 'strong', className: 'cm-lp-strong' },
            ];
            if (!cur) {
              specs.push({ from: b + i, to: b + contentStart, type: 'hide', tag: 'strong-mark' });
              specs.push({ from: b + contentEnd, to: b + i + full.length, type: 'hide', tag: 'strong-mark' });
            }
            return specs;
          },
        };
      }
    }

    if (!matched) {
      ITALIC_RE.lastIndex = i;
      m = ITALIC_RE.exec(text);
      if (m && m.index === i && (m[1] !== '_' || underscoreBoundaryOk(text, i, i + m[0].length))) {
        const content = m[2];
        const full = m[0];
        const contentStart = i + 1;
        const contentEnd = contentStart + content.length;
        matched = {
          start: i,
          end: i + full.length,
          specs: (b, cur) => {
            const specs: DecoSpec[] = [
              { from: b + contentStart, to: b + contentEnd, type: 'mark', tag: 'em', className: 'cm-lp-em' },
            ];
            if (!cur) {
              specs.push({ from: b + i, to: b + contentStart, type: 'hide', tag: 'em-mark' });
              specs.push({ from: b + contentEnd, to: b + i + full.length, type: 'hide', tag: 'em-mark' });
            }
            return specs;
          },
        };
      }
    }

    // Autolink <https://…> / <a@b.com>
    if (!matched) {
      AUTOLINK_RE.lastIndex = i;
      m = AUTOLINK_RE.exec(text);
      if (m && m.index === i) {
        const inner = m[1];
        const full = m[0];
        const href = inner.includes('@') && !inner.includes(':') ? `mailto:${inner}` : inner;
        const innerStart = i + 1;
        const innerEnd = innerStart + inner.length;
        matched = {
          start: i,
          end: i + full.length,
          specs: (b, cur) => {
            const specs: DecoSpec[] = [
              { from: b + innerStart, to: b + innerEnd, type: 'mark', tag: 'link', className: 'cm-lp-link', attrs: { href } },
            ];
            if (!cur) {
              specs.push({ from: b + i, to: b + innerStart, type: 'hide', tag: 'link-mark' });
              specs.push({ from: b + innerEnd, to: b + i + full.length, type: 'hide', tag: 'link-mark' });
            }
            return specs;
          },
        };
      }
    }

    // Strikethrough ~~text~~ and highlight ==text== share a simple pattern.
    if (!matched) {
      STRIKE_RE.lastIndex = i;
      m = STRIKE_RE.exec(text);
      if (m && m.index === i) matched = pairedMatcher(i, m[0], 2, m[1].length, 'strike', 'cm-lp-strike');
    }
    if (!matched) {
      HIGHLIGHT_RE.lastIndex = i;
      m = HIGHLIGHT_RE.exec(text);
      if (m && m.index === i) matched = pairedMatcher(i, m[0], 2, m[1].length, 'highlight', 'cm-lp-highlight');
    }

    if (matched) {
      out.push(...matched.specs(base, cursorLine));
      i = matched.end;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Underscore emphasis (`_` / `__`) must not be flanked by ASCII word characters,
 * so intra-word underscores like `my_var_name` are not treated as emphasis
 * (CommonMark rule). Asterisk emphasis is intentionally allowed intra-word.
 */
function underscoreBoundaryOk(text: string, start: number, end: number): boolean {
  const prev = start > 0 ? text[start - 1] : '';
  const next = end < text.length ? text[end] : '';
  return !/[A-Za-z0-9]/.test(prev) && !/[A-Za-z0-9]/.test(next);
}

/** Helper for symmetric paired-marker inline syntax (strike, highlight). */
function pairedMatcher(
  i: number,
  full: string,
  markerLen: number,
  contentLen: number,
  tag: string,
  className: string,
): InlineMatch {
  const contentStart = i + markerLen;
  const contentEnd = contentStart + contentLen;
  return {
    start: i,
    end: i + full.length,
    specs: (b, cur) => {
      const specs: DecoSpec[] = [
        { from: b + contentStart, to: b + contentEnd, type: 'mark', tag, className },
      ];
      if (!cur) {
        specs.push({ from: b + i, to: b + contentStart, type: 'hide', tag: `${tag}-mark` });
        specs.push({ from: b + contentEnd, to: b + i + full.length, type: 'hide', tag: `${tag}-mark` });
      }
      return specs;
    },
  };
}

const HEADING_RE = /^(#{1,6})(\s+)(.*)$/;
const QUOTE_RE = /^(\s*)((?:>\s?)+)(.*)$/;
const ULIST_RE = /^(\s*)([-*+])(\s+)(.*)$/;
const OLIST_RE = /^(\s*)(\d+[.)])(\s+)(.*)$/;

/**
 * Compute every decoration for the document.
 *
 * @param doc          full document text
 * @param cursorLines  set of 0-based line indices where raw syntax stays visible
 * @param options      feature toggles / viewport window
 */
export function computeDecorations(
  doc: string,
  cursorLines: Set<number>,
  options: DecorationOptions = {},
): DecoSpec[] {
  const lines = splitLines(doc);
  const code = detectCodeBlocks(lines);
  const tableBlocks = detectTableBlocks(lines, code);
  const tableStartAt = new Map<number, TableBlock>();
  const tableMember: boolean[] = new Array(lines.length).fill(false);
  for (const tb of tableBlocks) {
    tableStartAt.set(tb.start, tb);
    for (let j = tb.start; j <= tb.end; j++) tableMember[j] = true;
  }
  const detailsBlocks = detectDetailsBlocks(lines, code);
  const detailsStartAt = new Map<number, DetailsBlock>();
  const detailsMember: boolean[] = new Array(lines.length).fill(false);
  for (const db of detailsBlocks) {
    detailsStartAt.set(db.start, db);
    for (let j = db.start; j <= db.end; j++) detailsMember[j] = true;
  }
  const mathBlocks = detectMathBlocks(lines, code);
  const mathStartAt = new Map<number, MathBlock>();
  const mathMember: boolean[] = new Array(lines.length).fill(false);
  for (const mb of mathBlocks) {
    mathStartAt.set(mb.start, mb);
    for (let j = mb.start; j <= mb.end; j++) mathMember[j] = true;
  }
  const specs: DecoSpec[] = [];

  const inRange = (i: number) =>
    !options.lineRange || (i >= options.lineRange.startLine && i <= options.lineRange.endLine);

  // A code block / table is "active" (shows raw) if any of its lines has a cursor.
  const blockHasCursor = (open: number, close: number) => {
    for (let j = open; j <= close; j++) if (cursorLines.has(j)) return true;
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    if (!inRange(i)) continue;
    const line = lines[i];
    const role = code.role[i];

    // --- Fenced code blocks ---------------------------------------------
    if (role) {
      const block = code.blockOf[i]!;
      const active = blockHasCursor(block.open, block.close);
      specs.push({ from: line.from, to: line.from, type: 'line', tag: 'codeblock', className: 'cm-lp-codeblock' });
      if ((role === 'open' || role === 'close') && !active) {
        const fenceMatch = FENCE_RE.exec(line.text)!;
        const fenceStart = line.from + fenceMatch[1].length;
        const fenceEnd = fenceStart + fenceMatch[2].length;
        specs.push({ from: fenceStart, to: fenceEnd, type: 'hide', tag: 'fence-mark' });
      }
      // Crucial: never parse inline Markdown inside a code block.
      continue;
    }

    // --- Tables ----------------------------------------------------------
    if (tableMember[i]) {
      const block = tableStartAt.get(i);
      if (!block) continue; // non-start rows are handled by the block at start
      const active = blockHasCursor(block.start, block.end);
      if (active) {
        // R-22-02: caret inside the block → show raw `| a | b |` rows so the
        // cell text is directly editable. Fall through to per-line handling
        // (inline rendering still applies). The delimiter row stays raw too.
        // (do not emit a table-block widget here)
      } else {
        // Non-active: render the whole block as one HTML table widget.
        const parsed = parseTable(lines, block);
        specs.push({
          from: lines[block.start].from,
          to: lines[block.end].to,
          type: 'replaceWidget',
          tag: 'table-block',
          attrs: { table: JSON.stringify(parsed), startLine: String(block.start) },
        });
        i = block.end; // skip the consumed rows
        continue;
      }
    }

    // --- HTML <details> accordion ---------------------------------------
    if (detailsMember[i]) {
      const block = detailsStartAt.get(i);
      if (!block) continue; // inner lines handled by the start
      // Viewer-only: ALWAYS replace the whole block with one accordion widget
      // (closed by default), even when the caret is inside the block (R-27-03).
      // Clicking the summary opens/closes it natively; the body is not editable
      // in-place (edit via the standard source editor).
      specs.push({
        from: lines[block.start].from,
        to: lines[block.end].to,
        type: 'replaceWidget',
        tag: 'details-block',
        attrs: { summary: block.summary, body: JSON.stringify(block.body) },
      });
      i = block.end;
      continue;
    }

    // --- Block math ($$…$$) ---------------------------------------------
    if (mathMember[i]) {
      const block = mathStartAt.get(i);
      if (!block) continue; // inner lines handled by the start
      const active = blockHasCursor(block.start, block.end);
      if (!active) {
        // Caret outside the block → replace the whole fence with a KaTeX widget.
        specs.push({
          from: lines[block.start].from,
          to: lines[block.end].to,
          type: 'replaceWidget',
          tag: 'math-block',
          attrs: { tex: block.tex },
        });
        i = block.end;
        continue;
      }
      // Active: fall through so the raw `$$…$$` fence stays visible/editable.
    }

    const isCursor = cursorLines.has(i);

    // --- Headings --------------------------------------------------------
    let m = HEADING_RE.exec(line.text);
    if (m) {
      const level = m[1].length;
      specs.push({
        from: line.from,
        to: line.from,
        type: 'line',
        tag: 'heading',
        className: `cm-lp-heading cm-lp-h${level}`,
        attrs: { level: String(level) },
      });
      if (!isCursor) {
        specs.push({ from: line.from, to: line.from + m[1].length + m[2].length, type: 'hide', tag: 'heading-mark' });
      }
      specs.push(...parseInline(line.text, line.from, isCursor, m[1].length + m[2].length));
      continue;
    }

    // --- Horizontal rule (---, ***, ___) --------------------------------
    if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line.text)) {
      specs.push({ from: line.from, to: line.from, type: 'line', tag: 'hr', className: 'cm-lp-hr' });
      if (!isCursor) {
        specs.push({ from: line.from, to: line.to, type: 'replaceWidget', tag: 'hr-widget', attrs: { widget: '' } });
      }
      continue;
    }

    // --- Blockquote -----------------------------------------------------
    m = QUOTE_RE.exec(line.text);
    if (m) {
      const markerLen = m[1].length + m[2].length;
      specs.push({ from: line.from, to: line.from, type: 'line', tag: 'quote', className: 'cm-lp-quote' });
      if (!isCursor) {
        specs.push({ from: line.from + m[1].length, to: line.from + markerLen, type: 'hide', tag: 'quote-mark' });
      }
      specs.push(...parseInline(line.text, line.from, isCursor, markerLen));
      continue;
    }

    // --- Lists (unordered / ordered) ------------------------------------
    m = ULIST_RE.exec(line.text);
    if (m) {
      const indent = m[1].length;
      const contentStart = indent + m[2].length + m[3].length;
      const rest = line.text.slice(contentStart);
      // GFM task list item: - [ ] / - [x]
      const task = /^\[([ xX])\](\s+)/.exec(rest);

      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        specs.push({
          from: line.from,
          to: line.from,
          type: 'line',
          tag: 'task',
          className: checked ? 'cm-lp-task cm-lp-task-checked' : 'cm-lp-task',
          attrs: { indent: String(indent), checked: String(checked) },
        });
        const markerStart = line.from + indent;
        const textStart = line.from + contentStart + task[0].length; // past "[ ] "
        if (!isCursor) {
          specs.push({
            from: markerStart,
            to: textStart,
            type: 'replaceWidget',
            tag: 'task-checkbox',
            attrs: { checked: String(checked), indent: String(indent) },
          });
        }
        if (checked) {
          specs.push({ from: textStart, to: line.to, type: 'mark', tag: 'task-done', className: 'cm-lp-task-done' });
        }
        specs.push(...parseInline(line.text, line.from, isCursor, contentStart + task[0].length));
        continue;
      }

      specs.push({
        from: line.from,
        to: line.from,
        type: 'line',
        tag: 'list',
        className: 'cm-lp-list',
        attrs: { indent: String(indent), ordered: 'false' },
      });
      const markerStart = line.from + indent;
      const markerEnd = markerStart + m[2].length + m[3].length;
      if (!isCursor) {
        specs.push({ from: markerStart, to: markerEnd, type: 'replaceWidget', tag: 'list-bullet', attrs: { widget: '•', indent: String(indent) } });
      }
      specs.push(...parseInline(line.text, line.from, isCursor, indent + m[2].length + m[3].length));
      continue;
    }

    m = OLIST_RE.exec(line.text);
    if (m) {
      const indent = m[1].length;
      specs.push({
        from: line.from,
        to: line.from,
        type: 'line',
        tag: 'list',
        className: 'cm-lp-list cm-lp-list-ordered',
        attrs: { indent: String(indent), ordered: 'true' },
      });
      // Ordered list markers stay visible (numbers carry meaning); just style.
      specs.push(...parseInline(line.text, line.from, isCursor, indent + m[2].length + m[3].length));
      continue;
    }

    // --- Plain paragraph: inline only -----------------------------------
    specs.push(...parseInline(line.text, line.from, isCursor));
  }

  specs.sort((a, b) => a.from - b.from || a.to - b.to);
  return specs;
}

/** Outcome of {@link computeDecorationsSafe}. */
export interface SafeResult {
  ok: boolean;
  specs: DecoSpec[];
  error?: string;
}

/**
 * Error-tolerant wrapper around {@link computeDecorations}. If decoration
 * computation throws (a malformed document edge case), the caller can fall back
 * to the raw source view instead of crashing the Webview.
 */
export function computeDecorationsSafe(
  doc: string,
  cursorLines: Set<number>,
  options: DecorationOptions = {},
): SafeResult {
  try {
    return { ok: true, specs: computeDecorations(doc, cursorLines, options) };
  } catch (err) {
    return { ok: false, specs: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** A single ATX heading discovered by {@link scanHeadings}. */
export interface HeadingInfo {
  /** Heading strength, 1–6 (number of leading `#`). */
  level: number;
  /** Heading text with the `#` marker and its trailing whitespace removed. */
  text: string;
  /** 0-based line index of the heading. */
  line: number;
  /** Absolute offset of the first character of the heading line. */
  from: number;
  /** Absolute offset just past the last character of the heading line. */
  to: number;
}

/**
 * Scan the whole document for ATX headings (`#` … `######`), skipping any `#`
 * that lives inside a fenced code block (those are literal text, not headings).
 * Pure & framework-agnostic; walks the entire document (not viewport-limited) so
 * it can drive full-document features such as heading-section folding (R-30) and
 * is reusable by other outline-style features.
 */
export function scanHeadings(doc: string): HeadingInfo[] {
  const lines = splitLines(doc);
  const code = detectCodeBlocks(lines);
  const out: HeadingInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (code.role[i]) continue; // `#` inside a fenced code block is literal text
    const m = HEADING_RE.exec(lines[i].text);
    if (!m) continue;
    out.push({
      level: m[1].length,
      text: m[3].trim(),
      line: i,
      from: lines[i].from,
      to: lines[i].to,
    });
  }
  return out;
}

/**
 * Compute the collapsible range of the heading section that starts on `line`
 * (0-based). The range runs from the END of the heading line to the end of the
 * line immediately before the next heading of the same or stronger strength
 * (level ≤ this heading's level). If no such heading follows, the section
 * extends to the end of the document. Returns `null` when `line` is not a
 * heading or the section has no body lines to fold. Fenced code blocks are
 * ignored when locating the next heading, so a section spanning a code block is
 * folded correctly. Pure & framework-agnostic.
 */
export function headingFoldRange(doc: string, line: number): { from: number; to: number } | null {
  const lines = splitLines(doc);
  const headings = scanHeadings(doc);
  const current = headings.find((h) => h.line === line);
  if (!current) return null;

  let endLine = lines.length - 1;
  for (const h of headings) {
    if (h.line > line && h.level <= current.level) {
      endLine = h.line - 1;
      break;
    }
  }

  const from = lines[line].to;
  const to = lines[endLine].to;
  if (to <= from) return null; // nothing beneath this heading to fold
  return { from, to };
}
