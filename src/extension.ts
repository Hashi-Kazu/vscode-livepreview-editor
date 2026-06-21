import * as vscode from 'vscode';
import { LivePreviewEditorProvider } from './livePreviewEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new LivePreviewEditorProvider(context);
  context.subscriptions.push(provider.register());

  context.subscriptions.push(
    vscode.commands.registerCommand('livePreview.openWith', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage('開く Markdown ファイルが選択されていません。');
        return;
      }
      provider.openLive(target);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('livePreview.toggleSource', () => {
      provider.toggleActiveSource();
    }),
  );

  // Formatting commands (also bound to keyboard shortcuts in package.json).
  for (const kind of ['bold', 'italic', 'strikethrough', 'highlight', 'code']) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`livePreview.format.${kind}`, () => provider.runFormat(kind)),
    );
  }
}

export function deactivate() {
  // no-op
}
