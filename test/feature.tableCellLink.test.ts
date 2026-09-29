import { describe, it, expect, beforeAll } from 'vitest';

class FakeNode {
  tagName?: string;
  className = '';
  textContent = '';
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  appendChild(child: FakeNode) {
    this.children.push(child);
    return child;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
}

function installFakeDocument() {
  (globalThis as any).document = {
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
  (globalThis as any).window = { addEventListener() {} };
}

describe('R-22-03 / R-02-03: links inside table cells (appendInlineCell)', () => {
  let render: (text: string) => FakeNode;

  beforeAll(async () => {
    installFakeDocument();
    const mod = await import('../src/webview/decorations');
    const fn = mod.appendInlineCell as unknown as (parent: FakeNode, text: string) => void;
    render = (text) => {
      const p = new FakeNode();
      fn(p, text);
      return p;
    };
  });

  it('renders [text](url) as a link element', () => {
    const p = render('[docs](https://example.com/a)');
    expect(p.children).toHaveLength(1);
    const el = p.children[0];
    expect(el.className).toBe('cm-lp-link');
    expect(el.getAttribute('data-href')).toBe('https://example.com/a');
    expect(el.textContent).toBe('docs');
  });

  it('renders autolinks', () => {
    const a = render('<https://example.com>').children[0];
    expect(a.className).toBe('cm-lp-link');
    expect(a.getAttribute('data-href')).toBe('https://example.com');
    expect(a.textContent).toBe('https://example.com');
    const b = render('<user@example.com>').children[0];
    expect(b.className).toBe('cm-lp-link');
    expect(b.getAttribute('data-href')).toBe('mailto:user@example.com');
  });

  it('keeps order text, link, text, strong', () => {
    const p = render('a [x](y.md) b **c**');
    expect(p.children.map((c) => c.tagName)).toEqual(['#text', 'SPAN', '#text', 'STRONG']);
    expect(p.children[1].className).toBe('cm-lp-link');
  });

  it('does not italicise underscores inside a link', () => {
    const p = render('[a_b_c](http://x/a_b_)');
    expect(p.children).toHaveLength(1);
    expect(p.children[0].className).toBe('cm-lp-link');
    expect(p.children[0].getAttribute('data-href')).toBe('http://x/a_b_');
  });

  it('handles links around <br>', () => {
    const p = render('[x](u)<br>[y](v)');
    expect(p.children.map((c) => c.tagName)).toEqual(['SPAN', 'BR', 'SPAN']);
  });

  it('leaves link-free cells unchanged', () => {
    const p = render('`c` *e* plain');
    expect(p.children.map((c) => c.tagName)).toEqual(['CODE', '#text', 'EM', '#text']);
  });
});
