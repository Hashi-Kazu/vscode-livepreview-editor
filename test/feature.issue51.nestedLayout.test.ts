import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EditorState } from '@codemirror/state';
import { computeListEnterEdit } from '../src/core/editing';
import { computeDecorations, DecoSpec } from '../src/core/model';

const readProjectFile = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const byTag = (specs: DecoSpec[], tag: string) => specs.filter((spec) => spec.tag === tag);

describe('Issue #51: quote padding wins CodeMirror base theme', () => {
  it('uses a two-class selector and increases effective padding by 16px through l6', () => {
    const css = readProjectFile('media/editor.css');
    for (let level = 1; level <= 6; level += 1) {
      const rule = new RegExp(`\\.cm-line\\.cm-lp-quote-l${level}\\s*\\{[^}]*padding-left:\\s*${level * 16}px;`);
      expect(css).toMatch(rule);
    }
    expect(css).not.toMatch(/(?:^|\n)\.cm-lp-quote-l[1-6]\s*\{/);
  });
});

describe('Issue #51: unordered and ordered lists share marker geometry', () => {
  it('uses the common fixed marker slot without list-specific vertical spacing', () => {
    const css = readProjectFile('media/editor.css');
    const decorations = readProjectFile('src/webview/decorations.ts');
    const markerRule = css.match(/\.cm-lp-list-marker\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(markerRule).toMatch(/display:\s*inline-block;/);
    expect(markerRule).toMatch(/width:\s*[^;]+;/);
    expect(markerRule).toMatch(/height:\s*1\.6em;/);
    expect(markerRule).toMatch(/line-height:\s*1\.6em;/);
    expect(markerRule).toMatch(/margin-right:\s*[^;]+;/);
    expect(markerRule).toMatch(/vertical-align:\s*[^;]+;/);
    expect(markerRule).not.toMatch(/(?:margin|padding)-(?:top|bottom):/);

    expect(decorations).toMatch(/marker\.className = 'cm-lp-list-marker'/);
    expect(decorations).toMatch(/s\.tag === 'list-bullet' \|\| s\.tag === 'list-number'/);
    expect(decorations).toMatch(/new ListMarkerWidget/);

    const specs = computeDecorations(['- bullet', '1. ordered'].join('\n'), new Set());
    expect(byTag(specs, 'list-bullet')[0].attrs?.widget).toBe('•');
    expect(byTag(specs, 'list-number')[0].attrs?.widget).toBe('1.');
  });
});

describe('Issue #51: fourth-level ordered Enter keeps level and increments number', () => {
  it('registers Enter at highest precedence and inserts the next same-level item', () => {
    const mainSource = readProjectFile('src/webview/main.ts');
    expect(mainSource).toMatch(
      /const enterKeymap = Prec\.highest\(keymap\.of\(\[\{ key: 'Enter', run: handleEnter \}\]\)\);/,
    );
    const editingKeymap = mainSource.match(/const editingKeymap = keymap\.of\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
    expect(editingKeymap).not.toContain("key: 'Enter'");

    const doc = ['1. a', '  1. b', '    1. c', '      1. d'].join('\n');
    const state = EditorState.create({ doc, selection: { anchor: doc.length } });
    const line = state.doc.lineAt(state.selection.main.from);
    const edit = computeListEnterEdit(
      line.text,
      line.from,
      state.selection.main.from,
      state.selection.main.to,
    );
    expect(edit).not.toBeNull();
    const next = state.update(edit!).state;
    expect(next.doc.toString().split('\n')[4]).toBe('      2. ');
    expect(next.selection.main.anchor).toBe(doc.length + '\n      2. '.length);
  });
});
