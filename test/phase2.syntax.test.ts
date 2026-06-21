import { describe, it, expect } from 'vitest';
import { computeDecorations, DecoSpec } from '../src/core/model';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);
const text = (doc: string, s: DecoSpec) => doc.slice(s.from, s.to);

describe('Phase 2: italic (*text*)', () => {
  it('marks inner text as em and hides * off-cursor', () => {
    const doc = 'an *italic* word';
    const specs = computeDecorations(doc, new Set());
    const em = byTag(specs, 'em');
    expect(em).toHaveLength(1);
    expect(text(doc, em[0])).toBe('italic');
    expect(byTag(specs, 'em-mark')).toHaveLength(2);
  });

  it('does not treat ** (bold) as two italics', () => {
    const doc = '**bold**';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'strong')).toHaveLength(1);
    expect(byTag(specs, 'em')).toHaveLength(0);
  });
});

describe('Phase 2: inline code (`code`)', () => {
  it('marks content and hides backticks off-cursor', () => {
    const doc = 'use `npm run` here';
    const specs = computeDecorations(doc, new Set());
    const code = byTag(specs, 'code');
    expect(code).toHaveLength(1);
    expect(text(doc, code[0])).toBe('npm run');
    expect(byTag(specs, 'code-mark')).toHaveLength(2);
  });

  it('does NOT decorate Markdown inside inline code', () => {
    const doc = '`**not bold**`';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'strong')).toHaveLength(0);
    expect(byTag(specs, 'code')).toHaveLength(1);
  });
});

describe('Phase 2: links [text](url)', () => {
  it('styles the label, carries href, and hides the syntax off-cursor', () => {
    const doc = 'see [docs](https://example.com) now';
    const specs = computeDecorations(doc, new Set());
    const link = byTag(specs, 'link');
    expect(link).toHaveLength(1);
    expect(text(doc, link[0])).toBe('docs');
    expect(link[0].attrs?.href).toBe('https://example.com');
    expect(byTag(specs, 'link-mark')).toHaveLength(2);
  });
});

describe('Phase 2: images ![alt](url)', () => {
  it('replaces with an image widget off-cursor', () => {
    const doc = '![logo](img/logo.png)';
    const specs = computeDecorations(doc, new Set());
    const img = byTag(specs, 'image');
    expect(img).toHaveLength(1);
    expect(img[0].type).toBe('replaceWidget');
    expect(img[0].attrs?.src).toBe('img/logo.png');
    expect(img[0].attrs?.alt).toBe('logo');
  });

  it('shows raw image syntax on the cursor line', () => {
    const doc = '![logo](img/logo.png)';
    const specs = computeDecorations(doc, new Set([0]));
    expect(byTag(specs, 'image')).toHaveLength(0);
    expect(byTag(specs, 'image-src')).toHaveLength(1);
  });
});

describe('Phase 2: blockquote (>)', () => {
  it('adds a quote line class and hides the > marker off-cursor', () => {
    const doc = '> quoted text';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'quote')).toHaveLength(1);
    const mark = byTag(specs, 'quote-mark');
    expect(mark).toHaveLength(1);
    expect(text(doc, mark[0])).toBe('> ');
  });
});

describe('Phase 2: fenced code block (```)', () => {
  const doc = ['```js', 'const x = 1;', '**still code**', '```'].join('\n');

  it('marks all block lines and never decorates Markdown inside', () => {
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'codeblock').length).toBe(4); // 4 line decorations
    // The ** inside the block must NOT be bolded.
    expect(byTag(specs, 'strong')).toHaveLength(0);
  });

  it('hides the fence ``` markers when no cursor is in the block', () => {
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'fence-mark')).toHaveLength(2);
  });

  it('shows raw fences when the cursor is inside the block', () => {
    const specs = computeDecorations(doc, new Set([1]));
    expect(byTag(specs, 'fence-mark')).toHaveLength(0);
  });
});

describe('Phase 2: tables', () => {
  const doc = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');

  it('renders a single table-block widget off-cursor (v1.4.0+: HTML table)', () => {
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'table-block')).toHaveLength(1);
    expect(byTag(specs, 'table-row')).toHaveLength(0);
  });

  it('shows raw rows when the cursor is in the table (cell editing)', () => {
    const specs = computeDecorations(doc, new Set([1]));
    expect(byTag(specs, 'table-block')).toHaveLength(0);
    expect(byTag(specs, 'table-row').length).toBe(3);
  });
});

describe('Phase 2: model purity', () => {
  const doc = '# Title\n\n**bold** and *em* and `code`\n\n- item';

  it('decorates the document without mutating the input string', () => {
    const before = doc;
    const specs = computeDecorations(doc, new Set());
    expect(specs.length).toBeGreaterThan(0);
    // The pure model must never mutate the input string.
    expect(doc).toBe(before);
  });

  it('is deterministic: repeated runs yield an identical decoration set', () => {
    const first = computeDecorations(doc, new Set());
    const second = computeDecorations(doc, new Set());
    expect(second).toEqual(first);
  });
});
