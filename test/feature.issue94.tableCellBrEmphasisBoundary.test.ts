import { describe, it, expect, beforeAll } from 'vitest';

/** Minimal fake DOM sufficient for `appendInlineCell` (createElement / createTextNode /
 *  appendChild / textContent / className). See `test/feature.issue77.tableCellBr.test.ts`
 *  for the original pattern this stub is copied from (Issue #94). */
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

describe('Issue #94: table cell <br> must not be swallowed by emphasis/code tokenisation (appendInlineCell)', () => {
  let appendInlineCell: (parent: FakeNode, text: string) => void;

  beforeAll(async () => {
    installFakeDocument();
    const mod = await import('../src/webview/decorations');
    // `appendInlineCell` is typed against `HTMLElement`; this test exercises it
    // against a minimal fake DOM node stub (see `FakeNode` above) instead of a
    // real `HTMLElement`, so the cast is intentional.
    appendInlineCell = mod.appendInlineCell as unknown as (parent: FakeNode, text: string) => void;
  });

  // Leaf elements (EM/STRONG/CODE/#text) set `.textContent` directly instead
  // of appending a child text node, so recurse into `.children` only for
  // container nodes that actually have children.
  const flattenText = (node: FakeNode): string =>
    node.children.length > 0 ? node.children.map(flattenText).join('') : node.textContent;

  it('does not merge underscores across a <br> boundary (a_b<br>c_d)', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, 'a_b<br>c_d');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['#text', 'BR', '#text']);
    expect(tags).not.toContain('EM');
    expect(tags).not.toContain('STRONG');
    expect(parent.children[0].textContent).toBe('a_b');
    expect(parent.children[2].textContent).toBe('c_d');
  });

  it('renders the reported trigger case as two plain-text runs joined by a real <br>', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, 'report_v1.md<br>final_v2.md');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['#text', 'BR', '#text']);
    expect(tags).not.toContain('EM');
    expect(tags).not.toContain('STRONG');
    expect(parent.children[0].textContent).toBe('report_v1.md');
    expect(parent.children[2].textContent).toBe('final_v2.md');
  });

  it('still emphasises ordinary italic text outside the <br> (`_italic_<br>plain`)', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, '_italic_<br>plain');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['EM', 'BR', '#text']);
    expect(parent.children[0].textContent).toBe('italic');
    expect(parent.children[2].textContent).toBe('plain');
  });

  it('is unaffected by circled-number prefixes (①report_v1.md<br>②final_v2.md)', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, '①report_v1.md<br>②final_v2.md');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['#text', 'BR', '#text']);
    expect(tags).not.toContain('EM');
    expect(tags).not.toContain('STRONG');
    expect(parent.children[0].textContent).toBe('①report_v1.md');
    expect(parent.children[2].textContent).toBe('②final_v2.md');
  });

  it('does not let a code span cross a <br> boundary (`a<br>b`)', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, '`a<br>b`');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['#text', 'BR', '#text']);
    expect(tags).not.toContain('CODE');
    expect(parent.children[0].textContent).toBe('`a');
    expect(parent.children[2].textContent).toBe('b`');
  });

  it('handles multiple <br> + underscore pairs in one cell (`_a_<br>b_c_<br>_d_`)', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, '_a_<br>b_c_<br>_d_');
    const tags = parent.children.map((c) => c.tagName);
    // Segment 1 "_a_": both boundaries non-alphanumeric -> emphasised.
    // Segment 2 "b_c_": the `_c_` match is intra-word (preceded by "b") so
    // `underscoreBoundaryOk` rejects it and the whole segment stays plain text.
    // Segment 3 "_d_": both boundaries non-alphanumeric -> emphasised.
    expect(tags).toEqual(['EM', 'BR', '#text', 'BR', 'EM']);
    expect(parent.children[0].textContent).toBe('a');
    expect(parent.children[2].textContent).toBe('b_c_');
    expect(parent.children[4].textContent).toBe('d');
    expect(flattenText(parent)).toBe('ab_c_d');
  });
});
