import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

describe('Issue #28: removes the in-view dirty indicator while retaining the custom editor', () => {
  it('removes the host and Webview dirty message path and its viewer-only CSS', () => {
    const host = read('src', 'livePreviewCustomEditorProvider.ts');
    const webview = read('src', 'webview', 'main.ts');
    const css = read('media', 'editor.css');

    expect(host).not.toMatch(/postDirtyState/);
    expect(host).not.toMatch(/type:\s*['"]dirty['"]/);
    expect(webview).not.toMatch(/case\s+['"]dirty['"]/);
    expect(webview).not.toMatch(/cm-lp-unsaved-indicator/);
    expect(css).not.toMatch(/cm-lp-unsaved-indicator/);
  });

  it('retains the livePreview.editor Custom Text Editor contribution', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      contributes?: { customEditors?: Array<{ viewType?: string }> };
    };

    expect(packageJson.contributes?.customEditors).toContainEqual(
      expect.objectContaining({ viewType: 'livePreview.editor' }),
    );
  });
});
