import { describe, it, expect } from 'vitest';
import {
  computeDecorations,
  detectCodeBlocks,
  detectMermaidBlocks,
  splitLines,
  DecoSpec,
} from '../src/core/model';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);
const detect = (doc: string) => {
  const lines = splitLines(doc);
  return detectMermaidBlocks(lines, detectCodeBlocks(lines));
};

// --- R-36-01: 純粋関数 detectMermaidBlocks -----------------------------------
describe('Issue #42 R-36-01 detectMermaidBlocks', () => {
  it('```mermaid フェンス（複数行コード）を { start, end, code } で 1 件検知する', () => {
    const doc = ['# 図', '', '```mermaid', 'graph TD', '  A-->B', '  B-->C', '```', '本文'].join('\n');
    const blocks = detect(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start).toBe(2);
    expect(blocks[0].end).toBe(6);
    // 開始フェンス次行〜終了フェンス前行を \n 連結、内部インデント保持。
    expect(blocks[0].code).toBe('graph TD\n  A-->B\n  B-->C');
  });

  it('情報文字列先頭トークンの大小を無視して検知する（```MERMAID）', () => {
    const doc = ['```MERMAID', 'graph TD', 'A-->B', '```'].join('\n');
    const blocks = detect(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('graph TD\nA-->B');
  });

  it('他言語フェンス（```js）は検知しない（0 件）', () => {
    const doc = ['```js', 'const a = 1;', '```'].join('\n');
    expect(detect(doc)).toHaveLength(0);
  });

  it('情報文字列なしフェンスは検知しない（0 件）', () => {
    const doc = ['```', 'graph TD', 'A-->B', '```'].join('\n');
    expect(detect(doc)).toHaveLength(0);
  });

  it('未終了 ```mermaid は検知しない（0 件）', () => {
    const doc = ['```mermaid', 'graph TD', 'A-->B'].join('\n');
    expect(detect(doc)).toHaveLength(0);
  });

  it('フェンス検知（detectCodeBlocks）は不変（mermaid でも通常の open/close を保つ）', () => {
    const doc = ['```mermaid', 'graph TD', '```'].join('\n');
    const code = detectCodeBlocks(splitLines(doc));
    expect(code.role[0]).toBe('open');
    expect(code.role[1]).toBe('inside');
    expect(code.role[2]).toBe('close');
  });
});

// --- R-36-02 / R-36-05: computeDecorations への結線 --------------------------
describe('Issue #42 R-36-02 / R-36-05 computeDecorations', () => {
  const doc = ['前文', '```mermaid', 'graph TD', '  A-->B', '```', '後文'].join('\n');
  const START = 1; // ```mermaid 行
  const INNER = 2; // graph TD 行
  const OUTSIDE = 0; // 前文
  const rawCode = 'graph TD\n  A-->B';

  it('キャレット外では mermaid-block replaceWidget が 1 件、attrs が生コード/開始行に一致（R-36-02）', () => {
    const specs = computeDecorations(doc, new Set());
    const widgets = byTag(specs, 'mermaid-block');
    expect(widgets).toHaveLength(1);
    expect(widgets[0].type).toBe('replaceWidget');
    expect(widgets[0].attrs?.code).toBe(rawCode);
    expect(widgets[0].attrs?.startLine).toBe(String(START));
  });

  it('キャレットがブロック内・オプトインなしでも mermaid-block が 1 件のまま（自動フォールスルーしない＝R-36-02 の核心）', () => {
    const specs = computeDecorations(doc, new Set([INNER]));
    expect(byTag(specs, 'mermaid-block')).toHaveLength(1);
  });

  it('オプトインあり・キャレット内で mermaid-block が 0 件（生記法へフォールスルー＝R-36-05）', () => {
    const specs = computeDecorations(doc, new Set([INNER]), {
      mermaidDirectEditStartLines: new Set([START]),
    });
    expect(byTag(specs, 'mermaid-block')).toHaveLength(0);
    // フォールスルー先＝既存コードブロック描画（言語ハイライト用 codeblock line）。
    expect(byTag(specs, 'codeblock').length).toBeGreaterThan(0);
  });

  it('オプトインあり・キャレット外で mermaid-block が 1 件（キャレット離脱時は復帰＝R-36-05）', () => {
    const specs = computeDecorations(doc, new Set([OUTSIDE]), {
      mermaidDirectEditStartLines: new Set([START]),
    });
    expect(byTag(specs, 'mermaid-block')).toHaveLength(1);
  });

  it('ソース文字列は装飾処理前後で不変（R-01-02）', () => {
    const before = doc;
    computeDecorations(doc, new Set());
    computeDecorations(doc, new Set([INNER]), { mermaidDirectEditStartLines: new Set([START]) });
    expect(doc).toBe(before);
    // すべての spec が入力オフセット範囲内（テキスト非改変の間接確認）。
    const specs = computeDecorations(doc, new Set());
    for (const s of specs) {
      expect(s.from).toBeGreaterThanOrEqual(0);
      expect(s.to).toBeLessThanOrEqual(doc.length);
    }
  });
});
