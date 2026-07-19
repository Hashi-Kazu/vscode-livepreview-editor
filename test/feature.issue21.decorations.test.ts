import { describe, it, expect } from 'vitest';
import {
  computeDecorations,
  detectAlertBlocks,
  detectCodeBlocks,
  splitLines,
  DecoSpec,
  AlertKind,
} from '../src/core/model';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);
const slice = (doc: string, s: DecoSpec) => doc.slice(s.from, s.to);

// --- #4/#5 コードフェンス開始行の言語情報文字列 ------------------------------
describe('Issue #21 #4/#5 コードフェンス開始行: 言語情報文字列の扱い', () => {
  it('非カーソル行では言語情報文字列を hide し、言語名を line spec の属性に持つ', () => {
    const doc = ['```markdown', 'hello', '```'].join('\n');
    const specs = computeDecorations(doc, new Set());
    // 情報文字列 "markdown" を覆う hide spec が存在する。
    const info = byTag(specs, 'fence-info');
    expect(info).toHaveLength(1);
    expect(slice(doc, info[0])).toBe('markdown');
    // 開始行の codeblock line spec が言語名属性を持つ。
    const openLine = specs.find((s) => s.tag === 'codeblock' && (s.className ?? '').includes('cm-lp-codeblock-open'));
    expect(openLine?.attrs?.lang).toBe('markdown');
  });

  it('カーソル行では情報文字列を hide せず、言語ラベル属性も付けない（生表示）', () => {
    const doc = ['```js', 'const a = 1;', '```'].join('\n');
    const specs = computeDecorations(doc, new Set([0]));
    expect(byTag(specs, 'fence-info')).toHaveLength(0);
    const openLine = specs.find((s) => s.tag === 'codeblock' && (s.className ?? '').includes('cm-lp-codeblock-open'));
    expect(openLine?.attrs?.lang).toBeUndefined();
  });

  it('言語情報の無いフェンスでは fence-info を出さない', () => {
    const doc = ['```', 'plain', '```'].join('\n');
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'fence-info')).toHaveLength(0);
    // フェンス記号自体の hide は従来どおり存在する。
    expect(byTag(specs, 'fence-mark').length).toBeGreaterThan(0);
  });
});

// --- #7 GitHub Alerts --------------------------------------------------------
describe('Issue #21 #7 GitHub Alerts の検知と装飾', () => {
  const kinds: [string, AlertKind][] = [
    ['NOTE', 'note'],
    ['TIP', 'tip'],
    ['IMPORTANT', 'important'],
    ['WARNING', 'warning'],
    ['CAUTION', 'caution'],
  ];

  for (const [label, kind] of kinds) {
    it(`'> [!${label}]' を種別 ${kind} の alert として検知する`, () => {
      const doc = [`> [!${label}]`, '> body text'].join('\n');
      const specs = computeDecorations(doc, new Set());
      const lines = byTag(specs, 'alert');
      // 2 行とも alert line spec を持ち、種別クラスが付く。
      expect(lines.length).toBe(2);
      for (const l of lines) expect(l.className).toContain(`cm-lp-alert-${kind}`);
      // 先頭行にはタイトルウィジェットが出る。
      const title = specs.find((s) => s.tag === 'alert-title');
      expect(title?.attrs?.kind).toBe(kind);
    });
  }

  it('生ラベル [!NOTE] を可視テキストとして残さない（replaceWidget で置換）', () => {
    const doc = ['> [!NOTE]', '> hello'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const title = byTag(specs, 'alert-title');
    expect(title).toHaveLength(1);
    // ラベル範囲が [!NOTE] を覆っている（置換されるため可視の生ラベルにならない）。
    expect(slice(doc, title[0])).toBe('[!NOTE]');
    // '>' マーカーも hide される。
    expect(byTag(specs, 'quote-mark').length).toBeGreaterThan(0);
  });

  it('カーソル行では生記法（[!NOTE]）を維持しタイトルウィジェットを出さない', () => {
    const doc = ['> [!NOTE]', '> hello'].join('\n');
    const specs = computeDecorations(doc, new Set([0]));
    // 先頭行がカーソル行 → タイトルウィジェットは出ない。
    expect(byTag(specs, 'alert-title')).toHaveLength(0);
    // alert line spec 自体（種別バンド）は維持される。
    expect(byTag(specs, 'alert').length).toBe(2);
  });

  it('コードブロック内の "> [!NOTE]" は alert として検知しない（素通し）', () => {
    const doc = ['```', '> [!NOTE]', '> body', '```'].join('\n');
    const lines = splitLines(doc);
    const code = detectCodeBlocks(lines);
    expect(detectAlertBlocks(lines, code)).toHaveLength(0);
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'alert')).toHaveLength(0);
    expect(byTag(specs, 'alert-title')).toHaveLength(0);
  });

  it('通常の引用（[!TYPE] を持たない）は alert にならない', () => {
    const doc = ['> just a quote', '> second line'].join('\n');
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'alert')).toHaveLength(0);
    expect(byTag(specs, 'quote').length).toBe(2);
  });
});

// --- #6 入れ子引用の階層クラス（#16 互換維持） ------------------------------
describe('Issue #21 #6 入れ子引用は階層クラスを返す（#16 互換）', () => {
  it("'> a' は cm-lp-quote-l1、'>> b' は cm-lp-quote-l2 を含む", () => {
    const doc = ['> a', '>> b'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const quotes = byTag(specs, 'quote');
    expect(quotes).toHaveLength(2);
    expect(quotes[0].className).toContain('cm-lp-quote-l1');
    expect(quotes[1].className).toContain('cm-lp-quote-l2');
  });
});
