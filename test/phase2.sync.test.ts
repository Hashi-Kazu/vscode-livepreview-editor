import { describe, it, expect, vi } from 'vitest';
import {
  shouldResync,
  diffRange,
  cursorLinesFromSelections,
  offsetToPos,
  fromLF,
  fromLFPreserving,
} from '../src/core/sync';

describe('Phase 2: external change detection (shouldResync)', () => {
  it('resyncs when an external edit diverges from the webview text', () => {
    expect(
      shouldResync({ isFromWebview: false, webviewText: 'old', documentText: 'new (git pull)' }),
    ).toBe(true);
  });

  it('does NOT resync when the change echoes the webview own edit', () => {
    expect(
      shouldResync({ isFromWebview: true, webviewText: 'new', documentText: 'new' }),
    ).toBe(false);
  });

  it('does NOT resync when the text is already equal', () => {
    expect(
      shouldResync({ isFromWebview: false, webviewText: 'same', documentText: 'same' }),
    ).toBe(false);
  });

  it('does NOT resync when the change was caused by our own document.save() (e.g. trim trailing whitespace)', () => {
    expect(
      shouldResync({
        isFromWebview: false,
        isDuringOwnSave: true,
        webviewText: 'abc ',
        documentText: 'abc',
      }),
    ).toBe(false);
  });

  it('still resyncs on a genuine external change while not in our own save', () => {
    expect(
      shouldResync({
        isFromWebview: false,
        isDuringOwnSave: false,
        webviewText: 'old',
        documentText: 'new (git pull)',
      }),
    ).toBe(true);
  });

  it('drives a mocked webview.postMessage exactly once on external change', () => {
    const post = vi.fn();
    const webviewText = 'a';
    const documentText = 'b'; // external change
    if (shouldResync({ isFromWebview: false, webviewText, documentText })) {
      post({ type: 'update', text: documentText });
    }
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: 'update', text: 'b' });
  });
});

describe('Phase 2: diffRange (minimal edit for granular undo)', () => {
  it('returns null for identical text', () => {
    expect(diffRange('abc', 'abc')).toBeNull();
  });

  it('computes a minimal middle replacement', () => {
    const d = diffRange('hello world', 'hello brave world')!;
    expect(d.newText).toBe('brave ');
    expect(d.range.start).toEqual(offsetToPos('hello world', 6));
    expect(d.range.end).toEqual(offsetToPos('hello world', 6));
  });

  it('computes a deletion range', () => {
    const d = diffRange('foo bar baz', 'foo baz')!;
    expect(d.newText).toBe('');
  });

  it('handles multi-line positions', () => {
    const d = diffRange('line1\nline2', 'line1\nLINE2')!;
    expect(d.range.start.line).toBe(1);
  });
});

describe('Phase 2: cursorLinesFromSelections', () => {
  it('maps a single caret to its line', () => {
    const text = 'a\nb\nc';
    const set = cursorLinesFromSelections(text, [{ from: 2, to: 2 }]); // on line 1 ("b")
    expect([...set]).toEqual([1]);
  });

  it('includes every line a selection spans', () => {
    const text = 'aa\nbb\ncc\ndd';
    const set = cursorLinesFromSelections(text, [{ from: 1, to: 7 }]); // lines 0..2
    expect([...set].sort()).toEqual([0, 1, 2]);
  });
});

describe('Phase 2: per-line EOL preservation', () => {
  it('fromLFPreserving keeps per-line EOL for mixed CRLF/LF', () => {
    expect(fromLFPreserving('a\nB\nc\n', 'a\r\nb\nc\r\n', '\r\n')).toBe('a\r\nB\nc\r\n');
  });

  it('matches fromLF for documents using a single EOL', () => {
    const newLF = 'a\nB\nc\n';
    expect(fromLFPreserving(newLF, 'a\r\nb\r\nc\r\n', '\r\n')).toBe(fromLF(newLF, '\r\n'));
    expect(fromLFPreserving(newLF, 'a\nb\nc\n', '\n')).toBe(fromLF(newLF, '\n'));
  });

  it('does not add a trailing EOL when the old document has none', () => {
    expect(fromLFPreserving('a\nB\n', 'a\r\nb', '\r\n')).toBe('a\r\nB');
  });
});
