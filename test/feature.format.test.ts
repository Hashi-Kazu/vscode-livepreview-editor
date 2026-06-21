import { describe, it, expect } from 'vitest';
import { toggleWrap } from '../src/core/format';

// R-16: フォーマットコマンド（トグル）
describe('R-16 toggleWrap（対称マーカー）', () => {
  it('R-16-01: 選択範囲をマーカーで囲む', () => {
    const r = toggleWrap('hello world', 0, 5, '**');
    expect(r.text).toBe('**hello** world');
    expect(r.text.slice(r.selFrom, r.selTo)).toBe('hello');
  });

  it('R-16-02: 外側にマーカーがあれば解除する', () => {
    // "**hello** world" の hello を選択（from=2,to=7）
    const r = toggleWrap('**hello** world', 2, 7, '**');
    expect(r.text).toBe('hello world');
    expect(r.text.slice(r.selFrom, r.selTo)).toBe('hello');
  });

  it('R-16-03: 選択がマーカーを含む場合も解除する', () => {
    const r = toggleWrap('**hello** world', 0, 9, '**');
    expect(r.text).toBe('hello world');
    expect(r.text.slice(r.selFrom, r.selTo)).toBe('hello');
  });

  it('R-16-04: 空選択では空ペアを挿入しカーソルを中央へ置く', () => {
    const r = toggleWrap('ab', 1, 1, '*');
    expect(r.text).toBe('a**b');
    expect(r.selFrom).toBe(2);
    expect(r.selTo).toBe(2);
  });

  it('各マーカー（* ~~ == `）で動作する', () => {
    expect(toggleWrap('x', 0, 1, '*').text).toBe('*x*');
    expect(toggleWrap('x', 0, 1, '~~').text).toBe('~~x~~');
    expect(toggleWrap('x', 0, 1, '==').text).toBe('==x==');
    expect(toggleWrap('x', 0, 1, '`').text).toBe('`x`');
  });

  it('ラウンドトリップ: 付与→解除で元に戻る', () => {
    const on = toggleWrap('word', 0, 4, '**');
    const off = toggleWrap(on.text, on.selFrom, on.selTo, '**');
    expect(off.text).toBe('word');
  });
});
