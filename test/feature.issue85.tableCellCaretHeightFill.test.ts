import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const readProjectFile = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('Issue #85: table cell input fills the full cell height so clicks land at the click position', () => {
  it('.cm-lp-table-cell-input has height: 100% so it covers the entire editing cell, even when a sibling cell in the same row is taller', () => {
    const css = readProjectFile('media/editor.css');

    const inputMatch = css.match(/\.cm-lp-table-cell-input\s*\{([^}]*)\}/);
    expect(inputMatch).not.toBeNull();
    const inputBody = inputMatch![1];

    expect(inputBody).toMatch(/height:\s*100%;/);
  });
});
