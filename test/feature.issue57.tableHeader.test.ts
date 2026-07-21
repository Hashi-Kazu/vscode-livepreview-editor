import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const readProjectFile = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('Issue #57: table header row is visually differentiated from data rows', () => {
  it('th block has heavier weight, a bottom rule, and a theme-following stronger background than the zebra row', () => {
    const css = readProjectFile('media/editor.css');

    const thMatch = css.match(/table\.cm-lp-table th\s*\{([^}]*)\}/);
    expect(thMatch).not.toBeNull();
    const thBody = thMatch![1];

    // (a) heavier weight than data rows.
    expect(thBody).toMatch(/font-weight:\s*700;/);
    // (b) bottom rule to separate header from data rows.
    expect(thBody).toMatch(/border-bottom:\s*1px solid var\(--vscode-panel-border[^;]*\);/);
    // (c) theme-following background via color-mix.
    expect(thBody).toMatch(/background:\s*color-mix\(/);

    const zebraMatch = css.match(/table\.cm-lp-table tr:nth-child\(2n\) td\s*\{([^}]*)\}/);
    expect(zebraMatch).not.toBeNull();
    const zebraBody = zebraMatch![1];

    // Header and zebra background declarations must differ (clear differentiation).
    const thBackgroundDecls = thBody.match(/background:[^;]+;/g) ?? [];
    const zebraBackgroundDecls = zebraBody.match(/background:[^;]+;/g) ?? [];
    expect(thBackgroundDecls.length).toBeGreaterThan(0);
    expect(zebraBackgroundDecls.length).toBeGreaterThan(0);
    expect(thBackgroundDecls).not.toEqual(zebraBackgroundDecls);
    thBackgroundDecls.forEach((decl) => expect(zebraBackgroundDecls).not.toContain(decl));

    // No hardcoded hex/rgb colors outside of var(...) fallback arguments in the
    // header block (theme adherence, R-28-04).
    const withoutVarFallbacks = thBody.replace(/var\([^)]*\)/g, '');
    expect(withoutVarFallbacks).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(withoutVarFallbacks).not.toMatch(/rgba?\(/);

    // Border thickness stays 1px so the row height accounting (R-28-11) is unaffected.
    const borderBottomDecls = thBody.match(/border-bottom:[^;]+;/g) ?? [];
    expect(borderBottomDecls.length).toBeGreaterThan(0);
    borderBottomDecls.forEach((decl) => expect(decl).toMatch(/^\s*border-bottom:\s*1px\b/));
  });
});
