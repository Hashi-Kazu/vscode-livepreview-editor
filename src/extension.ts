import * as vscode from 'vscode';
import { LivePreviewCustomEditorProvider } from './livePreviewCustomEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new LivePreviewCustomEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      LivePreviewCustomEditorProvider.viewType,
      provider,
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('livePreview.openWith', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage('開く Markdown ファイルが選択されていません。');
        return;
      }
      // Open through the Custom Editor. VS Code reveals an existing editor for
      // the same resource (supportsMultipleEditorsPerDocument: false) instead of
      // creating a duplicate tab.
      await vscode.commands.executeCommand('vscode.openWith', target, LivePreviewCustomEditorProvider.viewType, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      });
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
