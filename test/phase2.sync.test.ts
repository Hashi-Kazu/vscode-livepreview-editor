import { describe, it, expect, vi } from 'vitest';
import {
  shouldResync,
  diffRange,
  computeRemotePatch,
  cursorLinesFromSelections,
  offsetToPos,
  fromLF,
  fromLFPreserving,
  isSaveParticipantNormalization,
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

describe('save-participant normalization is not treated as external (R-04-02)', () => {
  it('detects trailing-whitespace-only changes as save-participant normalization', () => {
    const webviewText = 'line one \nline two\t\nline three';
    const documentText = 'line one\nline two\nline three';
    expect(isSaveParticipantNormalization(webviewText, documentText)).toBe(true);
    expect(
      shouldResync({
        isFromWebview: false,
        webviewText,
        documentText,
        isSaveNormalization: true,
      }),
    ).toBe(false);
  });

  it('detects a trailing-final-newline-only difference as save-participant normalization', () => {
    const webviewText = 'abc\ndef';
    const documentText = 'abc\ndef\n';
    expect(isSaveParticipantNormalization(webviewText, documentText)).toBe(true);
    expect(
      shouldResync({
        isFromWebview: false,
        webviewText,
        documentText,
        isSaveNormalization: true,
      }),
    ).toBe(false);
  });

  it('does NOT flag a genuine content change as save-participant normalization', () => {
    const webviewText = 'old content';
    const documentText = 'new content (git pull)';
    const isSaveNormalization = isSaveParticipantNormalization(webviewText, documentText);
    expect(isSaveNormalization).toBe(false);
    expect(
      shouldResync({
        isFromWebview: false,
        webviewText,
        documentText,
        isSaveNormalization,
      }),
    ).toBe(true);
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

describe('Phase 2: computeRemotePatch (caret-preserving resync, R-03-08/R-04-02)', () => {
  it('returns the same minimal range as diffRange', () => {
    const oldText = 'hello world';
    const newText = 'hello brave world';
    const patch = computeRemotePatch(oldText, newText, { anchor: 0, head: 0 });
    expect(patch.from).toBe(6);
    expect(patch.to).toBe(6);
    expect(patch.insert).toBe('brave ');
  });

  it('leaves a caret in the unchanged prefix untouched', () => {
    // Change is after the caret: caret must not move.
    const oldText = 'abc def';
    const newText = 'abc XYZ def';
    const patch = computeRemotePatch(oldText, newText, { anchor: 3, head: 3 });
    expect(patch.anchor).toBe(3);
    expect(patch.head).toBe(3);
  });

  it('shifts a caret in the unchanged suffix by the length delta', () => {
    // Change is before the caret: caret shifts with the inserted text.
    const oldText = 'abc def';
    const newText = 'abcXY def';
    const patch = computeRemotePatch(oldText, newText, { anchor: 7, head: 7 }); // end
    expect(patch.anchor).toBe(9); // 7 + (9-7)
    expect(patch.head).toBe(9);
  });

  it('keeps a tail-side caret at the document end (does not roll back)', () => {
    // Host echoes a stale, shorter text while the caret sits at the very end
    // of what the user just typed. The caret must stay at the new end, never
    // earlier than the typing position.
    const oldText = 'abcdefg';
    const newText = 'abcdef'; // missing the just-typed trailing char
    const patch = computeRemotePatch(oldText, newText, { anchor: 7, head: 7 });
    expect(patch.anchor).toBe(newText.length); // 6, still at the end
    expect(patch.head).toBe(newText.length);
    expect(patch.anchor).toBeGreaterThanOrEqual(patch.from);
  });

  it('does not roll the caret back before the typing position when the replaced range covers the typing line', () => {
    // A format-on-save echo rewrites the whole typing line ("# Hello" ->
    // "# hello"); the caret is at end-of-line. It must remain at the trailing
    // edge of the rewritten region, not collapse to the region start.
    const oldText = 'intro\n# Hello\noutro';
    const newText = 'intro\n# hello\noutro';
    const caret = oldText.indexOf('\noutro'); // end of the "# Hello" line
    const patch = computeRemotePatch(oldText, newText, { anchor: caret, head: caret });
    // Region is "Hello" -> "hello" at the same length; caret preserved exactly.
    expect(patch.anchor).toBe(newText.indexOf('\noutro'));
    // And crucially never earlier than where the region begins.
    expect(patch.anchor).toBeGreaterThan(patch.from);
    expect(patch.anchor).not.toBeLessThan(caret - (oldText.length - newText.length));
  });

  it('preserves a non-collapsed selection across a change touching its range', () => {
    const oldText = 'aabbcc';
    const newText = 'aaXXcc';
    const patch = computeRemotePatch(oldText, newText, { anchor: 2, head: 4 });
    // Region [2,4) -> [2,4); anchor pinned to region edges, not collapsed.
    expect(patch.anchor).toBe(2);
    expect(patch.head).toBe(4);
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
