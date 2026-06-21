import { describe, it, expect } from 'vitest';
import { computeDecorations, DecoSpec } from '../src/core/model';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);
const slice = (doc: string, s: DecoSpec) => doc.slice(s.from, s.to);

/** Structural invariants that must hold for CodeMirror to accept the set. */
function assertInvariants(doc: string, specs: DecoSpec[]) {
  // 1) Every offset is within bounds and well-ordered.
  for (const s of specs) {
    expect(s.from).toBeGreaterThanOrEqual(0);
    expect(s.to).toBeLessThanOrEqual(doc.length);
    expect(s.from).toBeLessThanOrEqual(s.to);
  }
  // 2) Line decorations are zero-width at a line start.
  for (const s of specs.filter((x) => x.type === 'line')) {
    expect(s.from).toBe(s.to);
  }
  // 3) Replace / widget decorations must never overlap (CodeMirror requirement).
  const repl = specs
    .filter((s) => s.type === 'hide' || s.type === 'replaceWidget')
    .sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < repl.length; i++) {
    expect(repl[i].from).toBeGreaterThanOrEqual(repl[i - 1].to);
  }
}

describe('Inline 組み合わせ（1行に複数記法）', () => {
  it('太字・リンク・コード・タグ・取り消し線が同一行で共存する', () => {
    const doc = '**b** [l](u) `c` ==h== ~~s~~';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'strong')).toHaveLength(1);
    expect(byTag(specs, 'link')).toHaveLength(1);
    expect(byTag(specs, 'code')).toHaveLength(1);
    expect(byTag(specs, 'highlight')).toHaveLength(1);
    expect(byTag(specs, 'strike')).toHaveLength(1);
    assertInvariants(doc, specs);
  });

  it('隣接する記法でも replace 範囲が重ならない', () => {
    const doc = '**a**`b`==c==~~d~~';
    const specs = computeDecorations(doc, new Set());
    assertInvariants(doc, specs);
  });
});

describe('ブロック内の Inline', () => {
  it('見出し内の太字・コードを装飾する', () => {
    const doc = '## Title **bold** `code`';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'heading')).toHaveLength(1);
    expect(byTag(specs, 'strong')).toHaveLength(1);
    expect(byTag(specs, 'code')).toHaveLength(1);
    assertInvariants(doc, specs);
  });

  it('リスト項目内のリンク、引用内のコードを装飾する', () => {
    const doc = '- see [x](y)\n> use `z`';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'link')).toHaveLength(1);
    expect(byTag(specs, 'code')).toHaveLength(1);
    assertInvariants(doc, specs);
  });

  it('タスク項目内のリンクを装飾し、チェックボックスと重ならない', () => {
    const doc = '- [x] read [doc](u) today';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'task-checkbox')).toHaveLength(1);
    expect(byTag(specs, 'link')).toHaveLength(1);
    expect(byTag(specs, 'task-done')).toHaveLength(1);
    assertInvariants(doc, specs);
  });
});

describe('アンダースコア強調の語中判定（CommonMark）', () => {
  it('語中の _ は強調しない（my_var_name）', () => {
    const specs = computeDecorations('my_var_name here', new Set());
    expect(byTag(specs, 'em')).toHaveLength(0);
  });

  it('語中の __ も強調しない（a__b__c）', () => {
    const specs = computeDecorations('a__b__c', new Set());
    expect(byTag(specs, 'strong')).toHaveLength(0);
  });

  it('独立した _italic_ / __bold__ は強調する', () => {
    expect(byTag(computeDecorations('an _italic_ word', new Set()), 'em')).toHaveLength(1);
    expect(byTag(computeDecorations('a __bold__ word', new Set()), 'strong')).toHaveLength(1);
  });

  it('括弧・記号に囲まれた _italic_ は強調する', () => {
    expect(byTag(computeDecorations('(_x_)', new Set()), 'em')).toHaveLength(1);
  });

  it('アスタリスクは語中でも強調する（CommonMark 準拠）', () => {
    expect(byTag(computeDecorations('a*b*c', new Set()), 'em')).toHaveLength(1);
  });
});

describe('改行コード・マルチバイト', () => {
  it('CRLF でもオフセットが破綻しない', () => {
    const doc = '**a**\r\n# H\r\n- [ ] t';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'strong')).toHaveLength(1);
    expect(byTag(specs, 'heading')).toHaveLength(1);
    expect(byTag(specs, 'task-checkbox')).toHaveLength(1);
    assertInvariants(doc, specs);
  });

  it('日本語（マルチバイト）の強調オフセットが正しい', () => {
    const doc = 'これは**太字**です';
    const specs = computeDecorations(doc, new Set());
    const strong = byTag(specs, 'strong');
    expect(strong).toHaveLength(1);
    expect(slice(doc, strong[0])).toBe('太字');
    assertInvariants(doc, specs);
  });
});

describe('境界・退化ケース', () => {
  it('空文書・空行のみでも例外を投げない', () => {
    expect(() => computeDecorations('', new Set())).not.toThrow();
    expect(computeDecorations('\n\n\n', new Set())).toEqual([]);
  });

  it('全記法混在の大きめ文書で不変条件を満たす', () => {
    const doc = [
      '# Heading **bold** _em_',
      '',
      'Para with [link](http://x), `code`, ~~del~~, ==hi==, <https://a.com>, \\*esc\\*.',
      '',
      '> quote with **bold**',
      '',
      '- [ ] todo [doc](u)',
      '- [x] done ~~old~~',
      '  - nested item',
      '',
      '---',
      '',
      '```js',
      'const x = "**not bold**";',
      '```',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    const specs = computeDecorations(doc, new Set());
    assertInvariants(doc, specs);
    // コードブロック内は一切装飾されない
    expect(byTag(specs, 'strong').every((s) => slice(doc, s) !== 'not bold')).toBe(true);
    // 表はブロックウィジェット、水平線も描画される
    expect(byTag(specs, 'table-block')).toHaveLength(1);
    expect(byTag(specs, 'hr-widget')).toHaveLength(1);
  });
});
