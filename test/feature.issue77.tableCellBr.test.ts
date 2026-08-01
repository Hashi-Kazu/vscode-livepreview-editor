import { describe, it, expect, beforeAll } from 'vitest';

/** Minimal fake DOM sufficient for `appendInlineCell` (createElement / createTextNode /
 *  appendChild / textContent / className). The project has no jsdom dependency, so this
 *  hand-rolled stub avoids adding one just to exercise this small rendering helper
 *  (Issue #77 / R-22-10). It intentionally implements nothing beyond what
 *  `appendInlineCell` touches. */
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

describe('Issue #77 / R-22-10: table cell <br> rendering (appendInlineCell)', () => {
  let appendInlineCell: (parent: FakeNode, text: string) => void;

  beforeAll(async () => {
    installFakeDocument();
    const mod = await import('../src/webview/decorations');
    // `appendInlineCell` is typed against `HTMLElement`; this test exercises it
    // against a minimal fake DOM node stub (see `FakeNode` above) instead of a
    // real `HTMLElement`, so the cast is intentional.
    appendInlineCell = mod.appendInlineCell as unknown as (parent: FakeNode, text: string) => void;
  });

  const flatten = (node: FakeNode): FakeNode[] => [node, ...node.children.flatMap(flatten)];

  it('renders `<br>` as a real <br> element, not literal text', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, 'a<br>b');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['#text', 'BR', '#text']);
    expect(parent.children[0].textContent).toBe('a');
    expect(parent.children[2].textContent).toBe('b');
    // No literal "<br>" text survives anywhere in the tree.
    const allText = flatten(parent)
      .map((n) => n.textContent)
      .join('');
    expect(allText).not.toContain('<br>');
  });

  it.each(['<br/>', '<br />', '<BR>', '<Br/>', '<BR />'])(
    'renders the case-insensitive/self-closing variant %s as a <br> element',
    (variant) => {
      const parent = new FakeNode();
      appendInlineCell(parent, `x${variant}y`);
      const tags = parent.children.map((c) => c.tagName);
      expect(tags).toEqual(['#text', 'BR', '#text']);
    },
  );

  it('still renders code/bold/italic tokens unaffected by the new <br> branch', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, '`code` **bold** *em* plain');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['CODE', '#text', 'STRONG', '#text', 'EM', '#text']);
  });

  it('supports multiple <br> tokens in one cell (multi-line cell content)', () => {
    const parent = new FakeNode();
    appendInlineCell(parent, 'line1<br>line2<br/>line3');
    const tags = parent.children.map((c) => c.tagName);
    expect(tags).toEqual(['#text', 'BR', '#text', 'BR', '#text']);
  });
});
