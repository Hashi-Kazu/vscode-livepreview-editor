import { describe, it, expect, beforeAll } from 'vitest';

/** Minimal fake DOM sufficient for `appendInlineCell` (createElement / createTextNode /
 *  appendChild / textContent / className). See `test/feature.issue77.tableCellBr.test.ts`
 *  for the original pattern this stub is copied from (Issue #92 / R-01-06). */
class FakeNode {
  tagName?: string;
  className = '';
  textContent = '';
  children: FakeNode[] = [];
  appendChild(child: FakeNode) {
    this.children.push(child);
    return child;
  }
}

function installFakeDocument() {
  (globalThis as any).document = {
    // `@codemirror/view` probes `document.documentElement.style` at module
    // load time (browser sniffing) even though this test never instantiates
    // an EditorView; keep this minimal stub satisfied.
    documentElement: { style: {} },
    createElement(tag: string) {
      const el = new FakeNode();
      el.tagName = tag.toUpperCase();
      return el;
    },
    createTextNode(text: string) {
      const node = new FakeNode();
      node.tagName = '#text';
      node.textContent = text;
      return node;
    },
  };
  // `mermaid` (imported transitively by decorations.ts) registers a
  // `window.addEventListener('load', ...)` at module load time; stub just
  // enough for that side effect to no-op.
  (globalThis as any).window = { addEventListener() {} };
}

describe('Issue #92 / R-01-06: table cell underscore emphasis word-boundary rule (appendInlineCell)', () => {
  let appendInlineCell: (parent: FakeNode, text: string) => void;

  beforeAll(async () => {
    installFakeDocument();
    const mod = await import('../src/webview/decorations');
    // `appendInlineCell` is typed against `HTMLElement`; this test exercises it
    // against a minimal fake DOM node stub (see `FakeNode` above) instead of a
    // real `HTMLElement`, so the cast is intentional.
    appendInlineCell = mod.appendInlineCell as unknown as (parent: FakeNode, text: string) => void;
  });

  const flattenText = (node: FakeNode): string =>
    node.tagName === '#text' ? node.textContent : node.children.map(flattenText).join('');

  it('does not emphasise an intra-word underscore run (`snake_case_word`)', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, 'snake_case_word');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).not.toContain('EM');
    expect(tags).not.toContain('STRONG');
    expect(tags).toEqual(['#text']);
    expect(parent.children[0].textContent).toBe('snake_case_word');
  });

  it('still emphasises a word-boundary underscore run (`_italic_ word`)', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, '_italic_ word');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['EM', '#text']);
    expect(parent.children[0].tagName).toBe('EM');
    expect(parent.children[0].textContent).toBe('italic');
    expect(parent.children[1].textContent).toBe(' word');
  });

  it('does not bold-emphasise `__bold__` when immediately followed by a word character', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, '__bold__word');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).not.toContain('STRONG');
    expect(tags).toEqual(['#text']);
    expect(parent.children[0].textContent).toBe('__bold__word');
  });

  it('handles multiple intra-word underscores without an infinite loop or dropped text', () => {
    const parent = new FakeNode();
    const text = 'a_b_c';
    appendInlineCell(parent, text);
    expect(flattenText(parent)).toBe(text);
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).not.toContain('EM');
    expect(tags).not.toContain('STRONG');
  });

  it('still renders code/bold(**)/italic(*) tokens unaffected by the underscore boundary check', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, '`code` **bold** *em* plain');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['CODE', '#text', 'STRONG', '#text', 'EM', '#text']);
  });
});
