import * as vscode from 'vscode';
import { LivePreviewViewerManager } from './livePreviewViewerManager';

export function activate(context: vscode.ExtensionContext) {
  const manager = new LivePreviewViewerManager(context);
  context.subscriptions.push(manager);

  context.subscriptions.push(
    vscode.commands.registerCommand('livePreview.openWith', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage('開く Markdown ファイルが選択されていません。');
        return;
      }
      void manager.openLive(target);
    }),
  );

  // Formatting commands (also bound to keyboard shortcuts in package.json).
  for (const kind of ['bold', 'italic', 'strikethrough', 'highlight', 'code']) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`livePreview.format.${kind}`, () => manager.runFormat(kind)),
    );
  }
}

export function deactivate() {
  // no-op
}
