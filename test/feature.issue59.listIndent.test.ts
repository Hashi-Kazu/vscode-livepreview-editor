import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { buildDecorations } from '../src/webview/decorations';

function linePadding(state: EditorState, lineNumber: number): string | undefined {
  const line = state.doc.line(lineNumber);
  let padding: string | undefined;
  buildDecorations(state).between(line.from, line.to, (_from, _to, value) => {
    const decoration = value as Decoration;
    padding ??= decoration.spec.attributes?.style;
  });
  return padding;
}

describe('Issue #59: list indentation', () => {
  it('ul・ol のネスト表示インデントを 1 段 1.5em に縮小する', () => {
    const doc = [
      '- ul root',
      '  - ul nested',
      '    - ul deep',
      '1. ol root',
      '  1. ol nested',
      '    1. ol deep',
      '- [ ] task root',
      '  - [ ] task nested',
    ].join('\n');
    const state = EditorState.create({ doc });

    expect(linePadding(state, 1)).toBeUndefined();
    expect(linePadding(state, 2)).toBe('padding-left: 1.5em;');
    expect(linePadding(state, 3)).toBe('padding-left: 3em;');
    expect(linePadding(state, 4)).toBeUndefined();
    expect(linePadding(state, 5)).toBe('padding-left: 1.5em;');
    expect(linePadding(state, 6)).toBe('padding-left: 3em;');
    expect(linePadding(state, 7)).toBeUndefined();
    expect(linePadding(state, 8)).toBe('padding-left: 2em;');
    expect(state.doc.toString()).toBe(doc);

    const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'editor.css'), 'utf8');
    const markerRule = css.match(/\.cm-lp-list-marker\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(markerRule).toMatch(/width:\s*2em;/);
    expect(markerRule).toMatch(/margin-right:\s*0\.5em;/);
  });
});
