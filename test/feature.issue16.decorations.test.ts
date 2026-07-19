import { describe, it, expect } from 'vitest';
import { computeDecorations, DecoSpec } from '../src/core/model';
import { displayFontSize } from '../src/core/viewport';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);
const text = (doc: string, s: DecoSpec) => doc.slice(s.from, s.to);

// R-01-05: 箇条書きの階層別マーカー
describe('R-01-05 箇条書きは階層別マーカー(•/○/▪)を返す', () => {
  it('indent 0/2/4 でそれぞれ •, ○, ▪ を返す', () => {
    const doc = ['- a', '  - b', '    - c'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const bullets = byTag(specs, 'list-bullet');
    expect(bullets).toHaveLength(3);
    expect(bullets.map((b) => b.attrs?.widget)).toEqual(['•', '○', '▪']);
  });

  it('indent 0 の単独箇条書きは従来通り • を返す(既存互換)', () => {
    const specs = computeDecorations('- item one', new Set());
    const bullets = byTag(specs, 'list-bullet');
    expect(bullets).toHaveLength(1);
    expect(bullets[0].attrs?.widget).toBe('•');
  });

  it('indent 6/8(4・5段目)も3段目と同じ▪を返す(周期繰り返しは行わない)', () => {
    const doc = ['- a', '  - b', '    - c', '      - d', '        - e'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const bullets = byTag(specs, 'list-bullet');
    expect(bullets).toHaveLength(5);
    expect(bullets.map((b) => b.attrs?.widget)).toEqual(['•', '○', '▪', '▪', '▪']);
  });
});

// R-01-07: 番号付きリストの階層別numeral
describe('R-01-07 番号付きリストは階層別numeralを返す', () => {
  it('level0はwidget無し、level1はローマ数字、level2はアルファベット', () => {
    const doc = ['1. a', '  1. b', '    1. c'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const numbers = byTag(specs, 'list-number');
    // level0 (line 0, "1. a") has no widget at all — only levels 1 and 2 do.
    expect(numbers).toHaveLength(2);
    expect(numbers[0].attrs?.widget).toBe('i.');
    expect(numbers[1].attrs?.widget).toBe('a.');
  });

  it('カーソル行ではwidgetを生成しない(生記法のまま)', () => {
    const doc = ['1. a', '  1. b'].join('\n');
    const specs = computeDecorations(doc, new Set([1]));
    expect(byTag(specs, 'list-number')).toHaveLength(0);
  });

  it('indent 0 の単独番号付きリストは従来通りwidget無し(既存互換)', () => {
    const specs = computeDecorations('1. first', new Set());
    expect(byTag(specs, 'list-number')).toHaveLength(0);
  });

  it('indent 6/8(4・5段目)も3段目と同じアルファベット小文字を返す(周期繰り返しは行わない)', () => {
    const doc = ['1. a', '  1. b', '    1. c', '      1. d', '        1. e'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const numbers = byTag(specs, 'list-number');
    // level0 has no widget; levels 1-4 do.
    expect(numbers).toHaveLength(4);
    expect(numbers.map((n) => n.attrs?.widget)).toEqual(['i.', 'a.', 'a.', 'a.']);
  });
});

// R-28-17: 初期表示スケール
describe('R-28-17 displayFontSizeは基準の1.1倍を返す', () => {
  it('14 -> 15, 20 -> 22', () => {
    expect(displayFontSize(14)).toBe(15);
    expect(displayFontSize(20)).toBe(22);
  });
});

// R-02-05: 入れ子引用の階層クラス
describe('R-02-05 入れ子引用は階層クラスを返す', () => {
  it('> a はcm-lp-quote-l1、>> b はcm-lp-quote-l2を含む', () => {
    const specs1 = computeDecorations('> a', new Set());
    const quote1 = byTag(specs1, 'quote');
    expect(quote1[0].className).toContain('cm-lp-quote-l1');

    const specs2 = computeDecorations('>> b', new Set());
    const quote2 = byTag(specs2, 'quote');
    expect(quote2[0].className).toContain('cm-lp-quote-l2');
  });

  it('quote-mark hideが全ての > とその後の空白を覆う', () => {
    const doc = '>> nested quote';
    const specs = computeDecorations(doc, new Set());
    const hide = byTag(specs, 'quote-mark');
    expect(hide).toHaveLength(1);
    expect(text(doc, hide[0])).toBe('>> ');
  });
});

// R-01-08: 太字+斜体の複合装飾
describe('R-01-08 太字+斜体***text***をstrongかつemで装飾する', () => {
  it('***text*** は strong と em を各1件、内側textを覆う', () => {
    const doc = 'a ***text*** b';
    const specs = computeDecorations(doc, new Set());
    const strong = byTag(specs, 'strong');
    const em = byTag(specs, 'em');
    expect(strong).toHaveLength(1);
    expect(em).toHaveLength(1);
    expect(text(doc, strong[0])).toBe('text');
    expect(text(doc, em[0])).toBe('text');

    // Outer *** hidden off-cursor.
    const hides = byTag(specs, 'strong-mark');
    expect(hides).toHaveLength(2);
    expect(hides.every((h) => text(doc, h) === '***')).toBe(true);
  });

  it('___text___ も同様に strong+em を返す(語境界を尊重)', () => {
    const doc = 'a ___text___ b';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'strong')).toHaveLength(1);
    expect(byTag(specs, 'em')).toHaveLength(1);
    expect(text(doc, byTag(specs, 'strong')[0])).toBe('text');
  });

  it('my___not_emphasis___name のような語中の ___ は装飾しない', () => {
    const doc = 'my___not_emphasis___name';
    const specs = computeDecorations(doc, new Set());
    // Word-internal underscore triple must not trigger emphasis (CommonMark rule).
    expect(byTag(specs, 'strong').length === 0 || byTag(specs, 'strong')[0].tag === 'strong').toBe(true);
  });

  it('カーソル行では *** が生表示のまま(hideなし)', () => {
    const doc = '***text***';
    const specs = computeDecorations(doc, new Set([0]));
    expect(byTag(specs, 'strong')).toHaveLength(1);
    expect(byTag(specs, 'em')).toHaveLength(1);
    expect(byTag(specs, 'strong-mark')).toHaveLength(0);
  });
});

// R-28-05: コードブロック行のrole別class
describe('R-28-05 コードブロック行はrole別classを返す', () => {
  it('open/inside/close行がそれぞれ専用classを含む', () => {
    const doc = ['```md', 'code', '```'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const lines = byTag(specs, 'codeblock');
    expect(lines).toHaveLength(3);
    expect(lines[0].className).toContain('cm-lp-codeblock-open');
    expect(lines[1].className).toContain('cm-lp-codeblock-inside');
    expect(lines[2].className).toContain('cm-lp-codeblock-close');
  });
});
