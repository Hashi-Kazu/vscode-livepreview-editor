import { describe, it, expect } from 'vitest';
import { computeDecorations, computeDecorationsSafe, DecoSpec } from '../src/core/model';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);

describe('Phase 3: nested lists', () => {
  it('detects indented (nested) list items with their indent level', () => {
    const doc = ['- top', '  - child', '    - grandchild'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const lists = byTag(specs, 'list');
    expect(lists).toHaveLength(3);
    const indents = byTag(specs, 'list').map((s) => Number(s.attrs?.indent));
    expect(indents).toEqual([0, 2, 4]);
  });

  it('handles a fenced code block nested inside a list without bolding its content', () => {
    const doc = ['- item', '  ```', '  **not bold**', '  ```', '- next'].join('\n');
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'strong')).toHaveLength(0);
    expect(byTag(specs, 'codeblock').length).toBe(3); // 3 block lines
    expect(byTag(specs, 'list').length).toBe(2); // the two real list items
  });
});

describe('Phase 3: code block mis-decoration prevention', () => {
  it('never decorates #, **, *, `, > inside a fenced block', () => {
    const doc = ['```', '# not a heading', '**not bold**', '> not a quote', '`not code`', '```'].join('\n');
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'heading')).toHaveLength(0);
    expect(byTag(specs, 'strong')).toHaveLength(0);
    expect(byTag(specs, 'quote')).toHaveLength(0);
    expect(byTag(specs, 'code')).toHaveLength(0);
  });

  it('handles an unterminated fence gracefully (rest of doc is code)', () => {
    const doc = ['```', '**still code**', 'more code'].join('\n');
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'strong')).toHaveLength(0);
    expect(byTag(specs, 'codeblock').length).toBe(3);
  });
});

describe('Phase 3: error-tolerant computation (fallback to source)', () => {
  it('returns ok for normal input', () => {
    const res = computeDecorationsSafe('# hi', new Set());
    expect(res.ok).toBe(true);
    expect(res.specs.length).toBeGreaterThan(0);
  });

  it('never throws on adversarial input (unbalanced markers, huge marker runs)', () => {
    const nasty = '****__**`[](' + '*'.repeat(5000) + '\n# '.repeat(100);
    expect(() => computeDecorationsSafe(nasty, new Set([0, 1, 2]))).not.toThrow();
    const res = computeDecorationsSafe(nasty, new Set());
    expect(res.ok).toBe(true);
  });
});
