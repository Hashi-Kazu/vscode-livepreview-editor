import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Issue #63: unsupported dropped URI warning', () => {
  it('非 file URI を警告なく無視し、file URI の既存処理を維持する', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'livePreviewCustomEditorProvider.ts'),
      'utf8',
    );
    const relativizeUri = source.match(/private async relativizeUri\([\s\S]*?\n  }\n\n  \/\/ --- Link handling/)?.[0] ?? '';
    const handlePasteMedia = source.match(/private async handlePasteMedia\([\s\S]*?\n  }\n\n  private async directoryNames/)?.[0] ?? '';

    expect(source).not.toContain('unsupported dropped URI');
    expect(relativizeUri).toMatch(/if \(uri\.scheme !== 'file'\) \{\s*return undefined;\s*\}/);
    expect(handlePasteMedia).toMatch(/const resolved = await this\.relativizeUri\(raw, documentFolder\);\s*if \(!resolved\) continue;/);

    expect(relativizeUri).toContain('vscode.workspace.workspaceFolders');
    expect(relativizeUri).toContain('vscode.workspace.fs.stat(uri)');
    expect(relativizeUri).toMatch(/path\.relative\(documentFolder\.fsPath, uri\.fsPath\)/);
    expect(relativizeUri).toContain('ワークスペース外のファイルはリンクに挿入できません。');
    expect(relativizeUri).toContain('dropped URI could not be read');
    expect(handlePasteMedia).toContain('buildMediaSnippet');
  });
});
