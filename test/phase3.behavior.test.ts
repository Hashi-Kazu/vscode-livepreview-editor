import { describe, it, expect } from 'vitest';
import { computeDecorations, DecoSpec } from '../src/core/model';
import {
  diffRange,
  shouldApplyRemoteUpdate,
  shouldEmitEdit,
  shouldFlushComposition,
} from '../src/core/sync';
import { resolveSettings, viewportWindow, DEFAULT_SETTINGS, zoomFontSize } from '../src/core/viewport';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);

describe('Phase 3: Undo/Redo consistency (minimal granular edits)', () => {
  it('round-trips: applying a diff then its inverse restores the original', () => {
    const a = 'The quick brown fox';
    const b = 'The slow brown fox';
    const fwd = diffRange(a, b)!;
    // Apply forward edit by string splice using the computed offsets.
    const applied = applyDiff(a, fwd);
    expect(applied).toBe(b);
    // Inverse edit restores the original (granularity preserved for undo).
    const inv = diffRange(b, a)!;
    expect(applyDiff(b, inv)).toBe(a);
  });

  it('produces a single minimal change, not a whole-document replace', () => {
    const a = 'x'.repeat(1000) + 'A' + 'y'.repeat(1000);
    const b = 'x'.repeat(1000) + 'B' + 'y'.repeat(1000);
    const d = diffRange(a, b)!;
    expect(d.newText).toBe('B');
    expect(d.range.start.character).toBe(1000);
    expect(d.range.end.character).toBe(1001);
  });
});

function applyDiff(text: string, d: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }): string {
  const off = (line: number, ch: number) => {
    const lines = text.split('\n');
    let o = 0;
    for (let i = 0; i < line; i++) o += lines[i].length + 1;
    return o + ch;
  };
  const start = off(d.range.start.line, d.range.start.character);
  const end = off(d.range.end.line, d.range.end.character);
  return text.slice(0, start) + d.newText + text.slice(end);
}

describe('Phase 3: IME composition handling', () => {
  it('suppresses edits while composing', () => {
    expect(shouldEmitEdit({ docChanged: true, composing: true, applyingRemote: false })).toBe(false);
  });
  it('emits after composition ends', () => {
    expect(shouldEmitEdit({ docChanged: true, composing: false, applyingRemote: false })).toBe(true);
  });
  it('suppresses while applying a remote change (no echo loop)', () => {
    expect(shouldEmitEdit({ docChanged: true, composing: false, applyingRemote: true })).toBe(false);
  });
});

describe('stale update / IME flush', () => {
  it('shouldApplyRemoteUpdate: baseVersion がローカル版数未満の update は適用しない', () => {
    expect(shouldApplyRemoteUpdate({ baseVersion: 1, localVersion: 2, composing: false })).toBe(false);
  });

  it('shouldApplyRemoteUpdate: 版数が追いついていれば適用する', () => {
    expect(shouldApplyRemoteUpdate({ baseVersion: 2, localVersion: 2, composing: false })).toBe(true);
  });

  it('shouldApplyRemoteUpdate: IME 合成中は適用しない', () => {
    expect(shouldApplyRemoteUpdate({ baseVersion: 2, localVersion: 2, composing: true })).toBe(false);
  });

  it('shouldApplyRemoteUpdate: baseVersion 欠落時は版数比較をスキップして適用する', () => {
    expect(shouldApplyRemoteUpdate({ baseVersion: undefined, localVersion: 5, composing: false })).toBe(true);
  });

  it('shouldFlushComposition: 合成終了時に保留変更をフラッシュする', () => {
    expect(
      shouldFlushComposition({ composing: false, pendingCompositionChange: true, applyingRemote: false }),
    ).toBe(true);
  });

  it('shouldFlushComposition: 合成中・保留なし・remote 適用中はフラッシュしない', () => {
    expect(
      shouldFlushComposition({ composing: true, pendingCompositionChange: true, applyingRemote: false }),
    ).toBe(false);
    expect(
      shouldFlushComposition({ composing: false, pendingCompositionChange: false, applyingRemote: false }),
    ).toBe(false);
    expect(
      shouldFlushComposition({ composing: false, pendingCompositionChange: true, applyingRemote: true }),
    ).toBe(false);
  });
});

describe('Phase 3: settings', () => {
  it('falls back to defaults when unset', () => {
    expect(resolveSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps fontSize to the allowed range', () => {
    expect(resolveSettings({ fontSize: 2 }).fontSize).toBe(8);
    expect(resolveSettings({ fontSize: 999 }).fontSize).toBe(40);
    expect(resolveSettings({ fontSize: 18 }).fontSize).toBe(18);
  });
});

describe('Phase 3: tab-local mouse-wheel zoom', () => {
  // R-28-16: one 1px step per Ctrl/Cmd + wheel gesture.
  it('changes exactly one pixel based on wheel direction, not magnitude', () => {
    expect(zoomFontSize(14, -1)).toBe(15);
    expect(zoomFontSize(14, -999)).toBe(15);
    expect(zoomFontSize(14, 1)).toBe(13);
    expect(zoomFontSize(14, 999)).toBe(13);
  });

  // R-28-16: the effective tab-local font size remains within 8..40px.
  it('clamps zoom to the supported font-size range', () => {
    expect(zoomFontSize(40, -1)).toBe(40);
    expect(zoomFontSize(8, 1)).toBe(8);
  });

  // R-28-16: a non-gesture delta leaves the normalized size unchanged.
  it('does not change the size for zero or invalid wheel deltas', () => {
    expect(zoomFontSize(14, 0)).toBe(14);
    expect(zoomFontSize(14, Number.NaN)).toBe(14);
  });
});

describe('Phase 3: large-document performance', () => {
  const makeDoc = (n: number) =>
    Array.from({ length: n }, (_, i) => (i % 3 === 0 ? `# Heading ${i}` : `- item **${i}** with \`code\``)).join('\n');

  it('viewport limiting only decorates lines inside the window', () => {
    const doc = makeDoc(5000);
    const win = viewportWindow(5000, 1000, 1100);
    const specs = computeDecorations(doc, new Set(), { lineRange: win });
    // Every line-decoration must fall within the requested window's offsets.
    const lines = doc.split('\n');
    let winStart = 0;
    for (let i = 0; i < win.startLine; i++) winStart += lines[i].length + 1;
    const headings = byTag(specs, 'heading');
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.every((h) => h.from >= winStart)).toBe(true);
  });

  it('decorating a viewport window of a 5000-line doc is fast', () => {
    const doc = makeDoc(5000);
    const win = viewportWindow(5000, 0, 120);
    const t0 = performance.now();
    computeDecorations(doc, new Set(), { lineRange: win });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(100); // generous upper bound for CI
  });

  it('full-document decoration of 5000 lines completes within a time budget', () => {
    const doc = makeDoc(5000);
    const t0 = performance.now();
    const specs = computeDecorations(doc, new Set());
    const elapsed = performance.now() - t0;
    expect(specs.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });
});
