import { describe, expect, it } from 'vitest';
import {
  clampScrollLine,
  isEchoScroll,
  nextScrollSuppressUntil,
  shouldRelayScrollLine,
  SCROLL_SUPPRESS_WINDOW_MS,
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
});
