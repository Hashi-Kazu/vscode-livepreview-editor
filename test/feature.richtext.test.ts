import { describe, it, expect } from 'vitest';
import { computeDecorations, DecoSpec } from '../src/core/model';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);
const text = (doc: string, s: DecoSpec) => doc.slice(s.from, s.to);

// R-09: 取り消し線 / ハイライト
describe('R-09 取り消し線・ハイライト', () => {
  it('R-09-01: ~~text~~ を取り消し線装飾し ~~ を隠す', () => {
    const doc = 'this is ~~gone~~ ok';
    const specs = computeDecorations(doc, new Set());
    const s = byTag(specs, 'strike');
    expect(s).toHaveLength(1);
    expect(text(doc, s[0])).toBe('gone');
    expect(byTag(specs, 'strike-mark')).toHaveLength(2);
  });

  it('R-09-02: ==text== をハイライト装飾し == を隠す', () => {
    const doc = 'note ==important== here';
    const specs = computeDecorations(doc, new Set());
    const h = byTag(specs, 'highlight');
    expect(h).toHaveLength(1);
    expect(text(doc, h[0])).toBe('important');
    expect(byTag(specs, 'highlight-mark')).toHaveLength(2);
  });

  it('カーソル行では生記法を表示する', () => {
    const doc = '~~x~~ and ==y==';
    const specs = computeDecorations(doc, new Set([0]));
    expect(byTag(specs, 'strike-mark')).toHaveLength(0);
    expect(byTag(specs, 'highlight-mark')).toHaveLength(0);
    expect(byTag(specs, 'strike')).toHaveLength(1);
    expect(byTag(specs, 'highlight')).toHaveLength(1);
  });

  it('コードブロック内では装飾しない', () => {
    const doc = ['```', '~~x~~ ==y==', '```'].join('\n');
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'strike')).toHaveLength(0);
    expect(byTag(specs, 'highlight')).toHaveLength(0);
  });
});
