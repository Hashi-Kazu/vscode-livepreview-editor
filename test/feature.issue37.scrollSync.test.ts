import { describe, expect, it } from 'vitest';
import {
  clampScrollLine,
  isEchoScroll,
  nextScrollSuppressUntil,
  shouldRelayScrollLine,
  SCROLL_SUPPRESS_WINDOW_MS,
  LOCAL_EDIT_SCROLL_SUPPRESS_WINDOW_MS,
  EDIT_SCROLL_SUPPRESS_WINDOW_MS,
} from '../src/core/viewport';

describe('Issue #37: bidirectional vertical scroll sync — pure helpers (R-35)', () => {
  describe('clampScrollLine', () => {
    it('leaves an in-range line unchanged', () => {
      expect(clampScrollLine(5, 100)).toBe(5);
      expect(clampScrollLine(0, 100)).toBe(0);
      expect(clampScrollLine(99, 100)).toBe(99);
    });

    it('clamps a negative line to 0', () => {
      expect(clampScrollLine(-3, 100)).toBe(0);
    });

    it('clamps a too-large line to totalLines - 1', () => {
      expect(clampScrollLine(500, 100)).toBe(99);
    });

    it('clamps to 0 for a degenerate (<=0) totalLines', () => {
      expect(clampScrollLine(5, 0)).toBe(0);
      expect(clampScrollLine(5, -1)).toBe(0);
    });

    it('rounds a fractional line before clamping', () => {
      expect(clampScrollLine(4.6, 100)).toBe(5);
    });

    it('falls back to 0 for a non-finite line', () => {
      expect(clampScrollLine(Number.NaN, 100)).toBe(0);
      expect(clampScrollLine(Number.POSITIVE_INFINITY, 100)).toBe(0);
      expect(clampScrollLine(Number.NEGATIVE_INFINITY, 100)).toBe(0);
    });
  });

  describe('nextScrollSuppressUntil', () => {
    it('returns now + windowMs', () => {
      expect(nextScrollSuppressUntil(1000, 200)).toBe(1200);
    });

    it('defaults to SCROLL_SUPPRESS_WINDOW_MS when windowMs is omitted', () => {
      expect(nextScrollSuppressUntil(1000)).toBe(1000 + SCROLL_SUPPRESS_WINDOW_MS);
    });

    it('never opens a negative-width window', () => {
      expect(nextScrollSuppressUntil(1000, -50)).toBe(1000);
    });
  });

  describe('isEchoScroll', () => {
    it('is true strictly inside the suppression window', () => {
      const suppressUntil = nextScrollSuppressUntil(1000, 200);
      expect(isEchoScroll(1050, suppressUntil)).toBe(true);
      expect(isEchoScroll(1199, suppressUntil)).toBe(true);
    });

    it('is false once the window has elapsed', () => {
      const suppressUntil = nextScrollSuppressUntil(1000, 200);
      expect(isEchoScroll(1200, suppressUntil)).toBe(false);
      expect(isEchoScroll(1500, suppressUntil)).toBe(false);
    });

    it('is false when there is no active window', () => {
      expect(isEchoScroll(1000, undefined)).toBe(false);
    });
  });

  describe('shouldRelayScrollLine', () => {
    it('does not relay the same line as last synced', () => {
      expect(shouldRelayScrollLine(10, 10)).toBe(false);
    });

    it('relays a different line', () => {
      expect(shouldRelayScrollLine(11, 10)).toBe(true);
    });

    it('relays when nothing has been synced yet', () => {
      expect(shouldRelayScrollLine(0, undefined)).toBe(true);
    });
  });

  describe('R-35-04: local-edit scroll suppression (Webview-side)', () => {
    it('LOCAL_EDIT_SCROLL_SUPPRESS_WINDOW_MS is a positive width reusing the shared window constant', () => {
      expect(LOCAL_EDIT_SCROLL_SUPPRESS_WINDOW_MS).toBe(SCROLL_SUPPRESS_WINDOW_MS);
      expect(LOCAL_EDIT_SCROLL_SUPPRESS_WINDOW_MS).toBeGreaterThan(0);
    });

    it('a scroll event right after a local edit falls inside the suppression window (must not be relayed)', () => {
      const editAt = 1000;
      const suppressUntil = nextScrollSuppressUntil(editAt, LOCAL_EDIT_SCROLL_SUPPRESS_WINDOW_MS);
      // A caret-follow/decoration-height scroll firing shortly after the edit.
      expect(isEchoScroll(editAt + 1, suppressUntil)).toBe(true);
      expect(isEchoScroll(editAt + LOCAL_EDIT_SCROLL_SUPPRESS_WINDOW_MS - 1, suppressUntil)).toBe(true);
    });

    it('a scroll event once the window has elapsed is relayed as a genuine user scroll', () => {
      const editAt = 1000;
      const suppressUntil = nextScrollSuppressUntil(editAt, LOCAL_EDIT_SCROLL_SUPPRESS_WINDOW_MS);
      expect(isEchoScroll(editAt + LOCAL_EDIT_SCROLL_SUPPRESS_WINDOW_MS, suppressUntil)).toBe(false);
    });

    it('with no local edit yet (no active window), a scroll is relayed', () => {
      expect(isEchoScroll(Date.now(), undefined)).toBe(false);
    });
  });

  describe('R-35-05: edit-induced source visible-range suppression (host-side)', () => {
    it('EDIT_SCROLL_SUPPRESS_WINDOW_MS is a positive width reusing the shared window constant', () => {
      expect(EDIT_SCROLL_SUPPRESS_WINDOW_MS).toBe(SCROLL_SUPPRESS_WINDOW_MS);
      expect(EDIT_SCROLL_SUPPRESS_WINDOW_MS).toBeGreaterThan(0);
    });

    it('a source visible-range change right after a document edit falls inside the suppression window (must not be relayed)', () => {
      const editAt = 1000;
      const suppressUntil = nextScrollSuppressUntil(editAt, EDIT_SCROLL_SUPPRESS_WINDOW_MS);
      // A reflow/caret-follow visible-range change firing shortly after the edit.
      expect(isEchoScroll(editAt + 1, suppressUntil)).toBe(true);
      expect(isEchoScroll(editAt + EDIT_SCROLL_SUPPRESS_WINDOW_MS - 1, suppressUntil)).toBe(true);
    });

    it('a source visible-range change once the window has elapsed is relayed as a genuine user scroll', () => {
      const editAt = 1000;
      const suppressUntil = nextScrollSuppressUntil(editAt, EDIT_SCROLL_SUPPRESS_WINDOW_MS);
      expect(isEchoScroll(editAt + EDIT_SCROLL_SUPPRESS_WINDOW_MS, suppressUntil)).toBe(false);
    });

    it('with no document edit yet (no active window), a source visible-range change is relayed', () => {
      expect(isEchoScroll(Date.now(), undefined)).toBe(false);
    });
  });
});
