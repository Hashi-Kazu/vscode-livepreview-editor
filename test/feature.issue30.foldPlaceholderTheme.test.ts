import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

describe('Issue #30: fold placeholder theme background wins over CodeMirror default', () => {
  it('prefixes .cm-foldPlaceholder with .cm-editor so its specificity beats the built-in base theme', () => {
    const css = read('media', 'editor.css');

    // The bare, low-specificity selector must no longer exist on its own line,
    // otherwise CodeMirror's built-in `.${baseThemeID} .cm-foldPlaceholder`
    // rule (specificity 0,2,0) would still win over it (0,1,0).
    expect(css).not.toMatch(/^\.cm-foldPlaceholder\s*\{/m);

    // A rule with at least two class selectors targeting .cm-foldPlaceholder
    // (e.g. `.cm-editor .cm-foldPlaceholder`) must exist, raising specificity
    // to 0,2,0 or higher.
    expect(css).toMatch(/\.cm-editor\s+\.cm-foldPlaceholder\s*\{/);
  });

  it('keeps the theme-following background declaration referencing the editor background variable', () => {
    const css = read('media', 'editor.css');
    const match = css.match(/\.cm-editor\s+\.cm-foldPlaceholder\s*\{([^}]*)\}/);

    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/var\(--vscode-editor-background\)/);
  });
});
