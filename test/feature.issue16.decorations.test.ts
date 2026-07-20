import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
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

  it('.cm-lp-list-bulletのfont-sizeは1.4emでline-heightは1固定、hollow(○)は0.55emのまま(Issue #41)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'editor.css'), 'utf8');
    // •/▪ は 1.2em → 1.4em に拡大(Issue #41)。
    expect(css).toMatch(/\.cm-lp-list-bullet\s*\{[^}]*font-size:\s*1\.4em;/);
    // 拡大したグリフが行ボックスを押し広げないよう line-height を固定(unitless
    // 1.6 の継承を止める)。これで •/▪ 行と ○ 行のアイテム間余白が揃う。
    expect(css).toMatch(/\.cm-lp-list-bullet\s*\{[^}]*line-height:\s*1;/);
    // hollow(○, 2階層目)は 0.55em のまま不変。
    expect(css).toMatch(/\.cm-lp-list-bullet-hollow\s*\{[^}]*font-size:\s*0\.55em;/);
  });

  it('3段目と4段目は同一グリフ(▪)だがindent属性は異なる(階層差は保持、回帰: Issue #31)', () => {
    const doc = ['- a', '  - b', '    - c', '      - d'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const listLines = byTag(specs, 'list');
    expect(listLines.map((l) => l.attrs?.indent)).toEqual(['0', '2', '4', '6']);

    const bullets = byTag(specs, 'list-bullet');
    expect(bullets.map((b) => b.attrs?.widget)).toEqual(['•', '○', '▪', '▪']);
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

  it('3段目と4段目は同一アルファベットだがindent属性は異なる(階層差は保持、回帰: Issue #31)', () => {
    const doc = ['1. a', '  1. b', '    1. c', '      1. d'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const numbers = byTag(specs, 'list-number');
    expect(numbers.map((n) => n.attrs?.widget)).toEqual(['i.', 'a.', 'a.']);
    expect(numbers.map((n) => n.attrs?.indent)).toEqual(['2', '4', '6']);
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

  it('>>再掲なしの継続行もcm-lp-quote-l2を含む(lazy continuation)', () => {
    const doc = ['>> nested', 'continuation without markers'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const quotes = byTag(specs, 'quote');
    expect(quotes).toHaveLength(2);
    expect(quotes[0].className).toContain('cm-lp-quote-l2');
    expect(quotes[1].className).toContain('cm-lp-quote-l2');
  });

  it('空行を挟むと継続はリセットされる(次段落は引用にならない)', () => {
    const doc = ['>> nested', '', 'not a continuation'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const quotes = byTag(specs, 'quote');
    expect(quotes).toHaveLength(1);
  });

  it('入れ子引用の1段あたりインデント段差は16px固定(親テキスト列に整列、Issue #41)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'editor.css'), 'utf8');
    // Issue #41: 段差を 2em から 16px(= l1 のバー↔テキスト間隔)へ改め、各入れ子
    // 階層のバーが親のテキスト列に整列するようにした。l2 は 32px、l6 は 6 段ぶん。
    expect(css).toMatch(/\.cm-lp-quote-l2\s*\{[^}]*padding-left:\s*32px;/);
    expect(css).toMatch(/\.cm-lp-quote-l2\s*\{[^}]*background-position:\s*0 0, 16px 0;/);
    expect(css).toMatch(/\.cm-lp-quote-l6\s*\{[^}]*padding-left:\s*96px;/);
    expect(css).toMatch(/\.cm-lp-quote-l6\s*\{[^}]*background-position:\s*0 0, 16px 0, 32px 0, 48px 0, 64px 0, 80px 0;/);
  });
});

// R-02-08 / R-27: callout(GitHub Alerts)と折りたたみ(details)のカード統一
describe('R-02-08 / R-27 callout・details のカード表示(Issue #36)', () => {
  const readCss = () => fs.readFileSync(path.join(__dirname, '..', 'media', 'editor.css'), 'utf8');
  const readDeco = () =>
    fs.readFileSync(path.join(__dirname, '..', 'src', 'webview', 'decorations.ts'), 'utf8');

  it('Alert の open 行は上側左右、close 行は下側左右が角丸(両端が閉じたカード)', () => {
    const css = readCss();
    expect(css).toMatch(
      /\.cm-line\.cm-lp-alert-open\s*\{[^}]*border-top-left-radius:\s*6px;[^}]*border-top-right-radius:\s*6px;/,
    );
    expect(css).toMatch(
      /\.cm-line\.cm-lp-alert-close\s*\{[^}]*border-bottom-left-radius:\s*6px;[^}]*border-bottom-right-radius:\s*6px;/,
    );
  });

  it('Alert 背景は per-kind の color-mix カード塗り(ハードコード色なし)', () => {
    expect(readCss()).toMatch(
      /\.cm-line\.cm-lp-alert\s*\{[^}]*color-mix\(in srgb, var\(--lp-alert-color\)/,
    );
  });

  it('details は共通カード(border-radius と color-mix 背景)を持つ', () => {
    const css = readCss();
    expect(css).toMatch(/\.cm-lp-details\s*\{[^}]*border-radius:\s*6px;/);
    expect(css).toMatch(/\.cm-lp-details\s*\{[^}]*color-mix\(in srgb,/);
  });

  it('ALERT_ICON_PATHS は note=pencil / tip・important=flame / warning・caution=triangle', () => {
    const src = readDeco();
    expect(src).toMatch(/note:\s*ALERT_ICON_PENCIL/);
    expect(src).toMatch(/tip:\s*ALERT_ICON_FLAME/);
    expect(src).toMatch(/important:\s*ALERT_ICON_FLAME/);
    expect(src).toMatch(/warning:\s*ALERT_ICON_TRIANGLE/);
    expect(src).toMatch(/caution:\s*ALERT_ICON_TRIANGLE/);
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
