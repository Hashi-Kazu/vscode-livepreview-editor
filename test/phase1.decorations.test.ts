import { describe, it, expect } from 'vitest';
import { computeDecorations, DecoSpec } from '../src/core/model';

/** Helper: find specs by tag. */
const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);
/** Helper: the substring a spec covers. */
const text = (doc: string, s: DecoSpec) => doc.slice(s.from, s.to);

describe('Phase 1: bold (**text**)', () => {
  it('marks the inner text as strong and hides ** markers when off the cursor line', () => {
    const doc = 'hello **world** end';
    const specs = computeDecorations(doc, new Set());
    const strong = byTag(specs, 'strong');
    expect(strong).toHaveLength(1);
    expect(text(doc, strong[0])).toBe('world');
    expect(strong[0].type).toBe('mark');

    // Both ** markers hidden.
    const hides = byTag(specs, 'strong-mark');
    expect(hides).toHaveLength(2);
    expect(hides.every((h) => text(doc, h) === '**')).toBe(true);
  });

  it('keeps raw ** visible on the cursor line (no hide specs)', () => {
    const doc = 'hello **world** end';
    const specs = computeDecorations(doc, new Set([0]));
    expect(byTag(specs, 'strong')).toHaveLength(1); // still styled
    expect(byTag(specs, 'strong-mark')).toHaveLength(0); // but markers shown
  });
});

describe('Phase 1: headings (# .. ######)', () => {
  it('applies a level-specific class and hides the # prefix off-cursor', () => {
    const doc = '## Title here';
    const specs = computeDecorations(doc, new Set());
    const heading = byTag(specs, 'heading');
    expect(heading).toHaveLength(1);
    expect(heading[0].type).toBe('line');
    expect(heading[0].className).toContain('cm-lp-h2');
    expect(heading[0].attrs?.level).toBe('2');

    const mark = byTag(specs, 'heading-mark');
    expect(mark).toHaveLength(1);
    expect(text(doc, mark[0])).toBe('## ');
  });

  it.each([1, 2, 3, 4, 5, 6])('detects level %i headings', (level) => {
    const doc = `${'#'.repeat(level)} Heading`;
    const specs = computeDecorations(doc, new Set());
    const heading = byTag(specs, 'heading');
    expect(heading[0].className).toContain(`cm-lp-h${level}`);
  });

  it('does not hide the prefix on the cursor line', () => {
    const doc = '# Title';
    const specs = computeDecorations(doc, new Set([0]));
    expect(byTag(specs, 'heading')).toHaveLength(1);
    expect(byTag(specs, 'heading-mark')).toHaveLength(0);
  });
});

describe('Phase 1: lists', () => {
  it('replaces the "- " marker with a bullet widget off-cursor', () => {
    const doc = '- item one';
    const specs = computeDecorations(doc, new Set());
    const line = byTag(specs, 'list');
    expect(line).toHaveLength(1);
    expect(line[0].attrs?.ordered).toBe('false');

    const bullet = byTag(specs, 'list-bullet');
    expect(bullet).toHaveLength(1);
    expect(bullet[0].type).toBe('replaceWidget');
    expect(bullet[0].attrs?.widget).toBe('•');
    expect(text(doc, bullet[0])).toBe('- ');
  });

  it('keeps the "- " marker raw on the cursor line', () => {
    const doc = '- item';
    const specs = computeDecorations(doc, new Set([0]));
    expect(byTag(specs, 'list')).toHaveLength(1);
    expect(byTag(specs, 'list-bullet')).toHaveLength(0);
  });

  it('recognises ordered lists without replacing the number', () => {
    const doc = '1. first';
    const specs = computeDecorations(doc, new Set());
    const line = byTag(specs, 'list');
    expect(line[0].attrs?.ordered).toBe('true');
    expect(byTag(specs, 'list-bullet')).toHaveLength(0);
  });
});

describe('Phase 1: cursor-line range correctness across multiple lines', () => {
  it('only the cursor line shows raw markers', () => {
    const doc = ['**a**', '**b**', '**c**'].join('\n');
    const specs = computeDecorations(doc, new Set([1]));
    // Line 1 (the middle) keeps its markers; lines 0 and 2 hide them → 4 hides.
    expect(byTag(specs, 'strong-mark')).toHaveLength(4);
    // All three are still styled strong.
    expect(byTag(specs, 'strong')).toHaveLength(3);
  });
});
