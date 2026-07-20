import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeDecorations, DecoSpec } from '../src/core/model';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);

// R-02-05 (Issue #41): 引用の入れ子表示。Issue 本文の再現 Markdown（空 `>` 行を
// 挟む親引用＋末尾 `> >` の入れ子1行）で、入れ子行が depth=2 の `cm-lp-quote-l2`
// （2本バー）として分類されることと、修正後の CSS ジオメトリ（段差 = l1 の
// バー↔テキスト間隔 16px に一致）を固定する。
describe('R-02-05 引用の入れ子表示(Issue #41)', () => {
  const doc = [
    '> これは引用文です。',
    '>',
    '> 複数行の引用も記述できます。',
    '>',
    '> > 引用を入れ子にすることもできます。',
  ].join('\n');

  it('親引用行は l1、末尾の入れ子行は l2(2本バー)として分類される', () => {
    const specs = computeDecorations(doc, new Set());
    const quoteLines = byTag(specs, 'quote').filter((s) => s.type === 'line');
    // 5行すべてが引用行（空 `>` 行と遅延継続も含む）。
    expect(quoteLines).toHaveLength(5);
    const classes = quoteLines.map((s) => s.className);
    // 親4行は l1、最後の入れ子行だけ l2。
    expect(classes[0]).toContain('cm-lp-quote-l1');
    expect(classes[1]).toContain('cm-lp-quote-l1');
    expect(classes[2]).toContain('cm-lp-quote-l1');
    expect(classes[3]).toContain('cm-lp-quote-l1');
    expect(classes[4]).toContain('cm-lp-quote-l2');
    // 入れ子行は l1 を含まない（l1/l2 の取り違えがないこと）。
    expect(classes[4]).not.toContain('cm-lp-quote-l1 ');
  });

  it('入れ子行の `> > ` マーカー範囲(4文字)が hide される', () => {
    const specs = computeDecorations(doc, new Set());
    const hides = byTag(specs, 'quote-mark');
    // 入れ子行のマーカー hide が幅4(`> > `)であることを確認。
    const nestHide = hides.find((h) => h.to - h.from === 4);
    expect(nestHide).toBeTruthy();
  });

  it('CSS: 入れ子の段差は 16px 固定で、各段のバーが親テキスト列に整列する', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'editor.css'), 'utf8');
    // l1(単独引用)は従来どおり padding-left 16px・バー1本(x=0)で不変。
    expect(css).toMatch(/\.cm-lp-quote-l1\s*\{[^}]*padding-left:\s*16px;[^}]*background-position:\s*0 0;/);
    // l2 は 32px、バーは x=0 と x=16px（16px 段差 = l1 のバー↔テキスト間隔）。
    expect(css).toMatch(/\.cm-lp-quote-l2\s*\{[^}]*padding-left:\s*32px;/);
    expect(css).toMatch(/\.cm-lp-quote-l2\s*\{[^}]*background-position:\s*0 0,\s*16px 0;/);
    // l3 は 48px、バーは 0/16px/32px。
    expect(css).toMatch(/\.cm-lp-quote-l3\s*\{[^}]*padding-left:\s*48px;/);
    expect(css).toMatch(/\.cm-lp-quote-l3\s*\{[^}]*background-position:\s*0 0,\s*16px 0,\s*32px 0;/);
    // 旧実装の 2em 段差が残っていないこと。
    expect(css).not.toMatch(/\.cm-lp-quote-l2\s*\{[^}]*background-position:[^;]*2em/);
  });
});
