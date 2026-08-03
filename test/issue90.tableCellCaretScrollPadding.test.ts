import { describe, it, expect } from 'vitest';
import { computeCaretScrollLeft } from '../src/core/editing';

// R-22-10 / Issue #90: `syncCellInputCaretScroll` (src/webview/main.ts) computes
// the table-cell <input>'s visible content width before calling
// `computeCaretScrollLeft`. `.cm-lp-table-cell-input` uses `padding: 6px 13px`
// with `box-sizing: border-box`, so `input.clientWidth` includes both the left
// and right padding. The visible (text-rendering) width is
// `clientWidth - paddingLeft - paddingRight`, but the Issue #86 implementation
// only subtracted `paddingRight`, overestimating the visible width by
// `paddingLeft` and under-scrolling once the caret overflowed the right edge.
//
// `computeCaretScrollLeft` itself is unchanged (pure decision function); these
// tests demonstrate the difference in behaviour between passing it the
// under-corrected `clientWidth` (bug) and the fully-corrected `clientWidth` (fix).
describe('Issue #90: table-cell input caret-scroll must subtract both left and right padding', () => {
  const rawClientWidth = 100; // input.clientWidth (includes padding, box-sizing: border-box)
  const paddingLeft = 13;
  const paddingRight = 13;

  it('under-subtracts by paddingLeft when only paddingRight is removed (pre-fix bug reproduction)', () => {
    const buggyVisibleWidth = rawClientWidth - paddingRight; // 87, missing paddingLeft
    const correctVisibleWidth = rawClientWidth - paddingLeft - paddingRight; // 74

    // Caret sits just past the true visible edge (74) but still within the
    // buggy (too generous) visible width (87), so the buggy calculation wrongly
    // treats it as already visible and leaves scrollLeft untouched.
    const caretOffset = 80;
    const buggyResult = computeCaretScrollLeft(caretOffset, buggyVisibleWidth, 0);
    const correctResult = computeCaretScrollLeft(caretOffset, correctVisibleWidth, 0);

    expect(buggyResult).toBe(0); // bug: caret appears visible, no scroll applied
    expect(correctResult).toBe(caretOffset - correctVisibleWidth); // fix: scrolls to reveal the caret
    expect(correctResult).toBeGreaterThan(buggyResult);
  });

  it('produces a correct scrollLeft that keeps the caret within the fully-corrected visible window', () => {
    const correctVisibleWidth = rawClientWidth - paddingLeft - paddingRight; // 74
    let scrollLeft = 0;
    const caretOffsets = [60, 90, 120, 160];
    for (const caretOffset of caretOffsets) {
      scrollLeft = computeCaretScrollLeft(caretOffset, correctVisibleWidth, scrollLeft);
      expect(caretOffset).toBeGreaterThanOrEqual(scrollLeft);
      expect(caretOffset).toBeLessThanOrEqual(scrollLeft + correctVisibleWidth);
    }
    expect(scrollLeft).toBeGreaterThan(0);
  });

  it('the corrected clientWidth formula matches input.clientWidth - paddingLeft - paddingRight', () => {
    const clientWidth = Math.max(0, rawClientWidth - paddingLeft - paddingRight);
    expect(clientWidth).toBe(74);
    // Sanity: the pre-fix formula (paddingRight only) would have yielded a
    // larger, incorrect value.
    const buggyClientWidth = Math.max(0, rawClientWidth - paddingRight);
    expect(buggyClientWidth).toBe(87);
    expect(buggyClientWidth).toBeGreaterThan(clientWidth);
  });
});
