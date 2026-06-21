import { describe, it, expect } from 'vitest';
import { computeDecorations, DecoSpec } from '../src/core/model';
import { toggleTaskAt, toLF, fromLF } from '../src/core/sync';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);
const text = (doc: string, s: DecoSpec) => doc.slice(s.from, s.to);

// R-08: タスクチェックボックス
describe('R-08 タスクチェックボックス（表示）', () => {
  it('R-08-01: - [ ] / - [x] を検知しチェックボックスウィジェットへ置換する', () => {
    const doc = ['- [ ] todo', '- [x] done'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const boxes = byTag(specs, 'task-checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].type).toBe('replaceWidget');
    expect(boxes[0].attrs?.checked).toBe('false');
    expect(boxes[1].attrs?.checked).toBe('true');
    // 大文字 X も完了扱い
    const upper = computeDecorations('- [X] done', new Set());
    expect(byTag(upper, 'task-checkbox')[0].attrs?.checked).toBe('true');
  });

  it('R-08-01: 通常リストはビュレット、タスクはビュレットにしない', () => {
    const doc = '- [ ] task';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'task-checkbox')).toHaveLength(1);
    expect(byTag(specs, 'list-bullet')).toHaveLength(0);
    expect(byTag(specs, 'task')).toHaveLength(1); // line deco
  });

  it('R-08-02: 完了タスクの本文に取り消し線スタイルを当てる', () => {
    const doc = '- [x] finished work';
    const specs = computeDecorations(doc, new Set());
    const done = byTag(specs, 'task-done');
    expect(done).toHaveLength(1);
    expect(text(doc, done[0])).toBe('finished work');
    // 未完了は取り消し線なし
    expect(byTag(computeDecorations('- [ ] open', new Set()), 'task-done')).toHaveLength(0);
  });

  it('R-08-03: カーソル行では生記法を表示する（置換しない）', () => {
    const doc = '- [ ] todo';
    const specs = computeDecorations(doc, new Set([0]));
    expect(byTag(specs, 'task-checkbox')).toHaveLength(0);
    expect(byTag(specs, 'task')).toHaveLength(1); // line スタイルは残る
  });

  it('R-08-04: ネストタスクの indent を保持する', () => {
    const doc = ['- [ ] parent', '  - [x] child'].join('\n');
    const specs = computeDecorations(doc, new Set());
    const boxes = byTag(specs, 'task-checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].attrs?.indent).toBe('0');
    expect(boxes[1].attrs?.indent).toBe('2');
  });
});

describe('R-08-05 タスクトグル（純粋ロジック）', () => {
  it('[ ] ⇄ [x] をトグルし元テキストは破壊しない', () => {
    const doc = ['- [ ] a', '- [x] b'].join('\n');
    const r0 = toggleTaskAt(doc, 0);
    expect(r0.changed).toBe(true);
    expect(r0.checked).toBe(true);
    expect(r0.text).toBe(['- [x] a', '- [x] b'].join('\n'));
    // 入力は不変
    expect(doc).toBe(['- [ ] a', '- [x] b'].join('\n'));

    const r1 = toggleTaskAt(doc, 1);
    expect(r1.checked).toBe(false);
    expect(r1.text).toBe(['- [ ] a', '- [ ] b'].join('\n'));
  });

  it('タスクでない行・範囲外は変更しない', () => {
    const doc = 'plain line';
    expect(toggleTaskAt(doc, 0).changed).toBe(false);
    expect(toggleTaskAt(doc, 5).changed).toBe(false);
  });

  it('インデント・* / + マーカーのタスクもトグルできる', () => {
    expect(toggleTaskAt('  * [ ] x', 0).text).toBe('  * [x] x');
    expect(toggleTaskAt('+ [x] y', 0).text).toBe('+ [ ] y');
  });

  it('CRLF 行末でもトグルでき、CR を保持する', () => {
    const doc = '- [ ] a\r\n- [x] b';
    const r = toggleTaskAt(doc, 0);
    expect(r.changed).toBe(true);
    expect(r.text).toBe('- [x] a\r\n- [x] b'); // CR は維持
  });
});

describe('EOL 正規化ヘルパー', () => {
  it('toLF は CRLF / CR を LF へ正規化する', () => {
    expect(toLF('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
  it('fromLF は LF を指定 EOL に戻す（往復で不変）', () => {
    const lf = 'a\nb\nc';
    expect(fromLF(lf, '\r\n')).toBe('a\r\nb\r\nc');
    expect(fromLF(lf, '\n')).toBe(lf);
    expect(toLF(fromLF(lf, '\r\n'))).toBe(lf);
  });
});
