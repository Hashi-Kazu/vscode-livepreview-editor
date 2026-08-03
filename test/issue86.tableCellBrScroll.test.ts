import { describe, it, expect } from 'vitest';
import { computeCaretScrollLeft } from '../src/core/editing';

// R-22-10 / Issue #86: after inserting a `<br>` in a table cell via Shift+Enter
// and continuing to type, the caret must stay visible inside the cell's
// `<input>` even once the text overflows the input's width. `computeCaretScrollLeft`
// is the pure decision function the Webview applies to `input.scrollLeft` on
// every `input` event (both the synthetic one fired right after `<br>`
// insertion, and every subsequent real keystroke).
describe('Issue #86: computeCaretScrollLeft keeps the table-cell input caret visible', () => {
  it('leaves scrollLeft untouched when the caret is already inside the visible range', () => {
    expect(computeCaretScrollLeft(50, 100, 0)).toBe(0);
    expect(computeCaretScrollLeft(50, 100, 20)).toBe(20);
  });

  it('scrolls right so an overflowing caret (typed past the right edge) becomes visible', () => {
    // Visible window is [scrollLeft, scrollLeft + clientWidth) = [0, 100).
    // The caret is now at pixel 140, past the right edge -> scroll so the
    // caret lands exactly at the right edge.
    expect(computeCaretScrollLeft(140, 100, 0)).toBe(40);
  });

  it('keeps scrolling right as more text is typed after a <br> insertion, tracking the caret', () => {
    // Simulates repeated `input` events as the user keeps typing after
    // Shift+Enter inserted a <br>: each keystroke grows caretOffset further
    // past the input's clientWidth, and scrollLeft must keep following it.
    let scrollLeft = 0;
    const clientWidth = 100;
    const caretOffsets = [90, 110, 135, 160, 200];
    for (const caretOffset of caretOffsets) {
      scrollLeft = computeCaretScrollLeft(caretOffset, clientWidth, scrollLeft);
      // The caret must always be within the visible window after the update.
      expect(caretOffset).toBeGreaterThanOrEqual(scrollLeft);
      expect(caretOffset).toBeLessThanOrEqual(scrollLeft + clientWidth);
    }
    // The window followed the caret rather than staying pinned at 0.
    expect(scrollLeft).toBeGreaterThan(0);
  });

  it('scrolls left so a caret moved before the visible range (e.g. Home/ArrowLeft) becomes visible', () => {
    expect(computeCaretScrollLeft(10, 100, 50)).toBe(10);
  });

  it('snaps scrollLeft to 0 once the caret returns to the very start of the text', () => {
    expect(computeCaretScrollLeft(0, 100, 300)).toBe(0);
  });
});
