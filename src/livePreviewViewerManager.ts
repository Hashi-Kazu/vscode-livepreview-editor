import * as path from 'path';
import * as vscode from 'vscode';
import { diffRange, fromLF, shouldResync, toggleTaskAt, toLF } from './core/sync';
import {
  decideFocusRestoreViewer,
  decideFollow,
  findViewerForUri,
  isCurrentBinding,
  PendingViewerFocusRestore,
  ViewerState,
} from './core/viewer';
import { resolveSettings } from './core/viewport';

interface ViewerBinding {
  uri: vscode.Uri;
  key: string;
  generation: number;
  webviewText: string;
  changeSubscription: vscode.Disposable;
}

interface Viewer {
  id: string;
  panel: vscode.WebviewPanel;
  binding: ViewerBinding;
  operationQueue: Promise<void>;
  messageSubscription?: vscode.Disposable;
  viewStateSubscription?: vscode.Disposable;
  configSubscription?: vscode.Disposable;
  disposeSubscription?: vscode.Disposable;
}

/**
 * Owns editable WebviewPanel viewers and their TextDocument bindings.
 *
 * Panels are independent of source editor tabs. A document is loaded with
 * workspace.openTextDocument when needed, which keeps editing functional after
 * its source tab closes without revealing that source document.
 */
export class LivePreviewViewerManager implements vscode.Disposable {
  public static readonly viewType = 'livePreview.viewer';

  private readonly viewers = new Map<string, Viewer>();
  private readonly viewersByUri = new Map<string, Viewer>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private lastInteractedViewerId: string | undefined;
  private activeViewerId: string | undefined;
  private pendingFocusRestore: PendingViewerFocusRestore | undefined;
  private nextViewerId = 1;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor || editor.document.languageId !== 'markdown') {
          this.pendingFocusRestore = undefined;
          return;
        }
        if (!this.followActiveEditorEnabled()) {
          this.pendingFocusRestore = undefined;
          return;
        }
        const focusRestore = this.pendingFocusRestore;
        this.pendingFocusRestore = undefined;
        void this.followActiveEditor(editor.document.uri, focusRestore);
      }),
    );
  }

  public dispose(): void {
    for (const viewer of [...this.viewers.values()]) viewer.panel.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  /** Open a distinct viewer beside the source, or reveal the existing URI owner. */
  public async openLive(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    const existingId = findViewerForUri(this.viewerStates(), key);
    if (existingId) {
      const existing = this.viewers.get(existingId);
      if (existing) {
        this.markInteracted(existing);
        existing.panel.reveal(existing.panel.viewColumn, false);
      }
      return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== 'markdown') {
      vscode.window.showWarningMessage('Live Preview は Markdown ファイルのみ表示できます。');
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      LivePreviewViewerManager.viewType,
      this.titleFor(uri),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const viewer = this.createViewer(panel, document);
    this.viewers.set(viewer.id, viewer);
    this.viewersByUri.set(key, viewer);
    this.markInteracted(viewer);
  }

  /** Route formatting commands to the most recently interacted viewer. */
  public runFormat(kind: string): void {
    const viewer = this.lastInteractedViewerId
      ? this.viewers.get(this.lastInteractedViewerId)
      : undefined;
    void viewer?.panel.webview.postMessage({ type: 'format', kind });
  }

  private createViewer(panel: vscode.WebviewPanel, document: vscode.TextDocument): Viewer {
    const id = `viewer-${this.nextViewerId++}`;
    const binding = this.createBinding(panel, document, 1);
    const viewer: Viewer = {
      id,
      panel,
      binding,
      operationQueue: Promise.resolve(),
    };

    viewer.messageSubscription = panel.webview.onDidReceiveMessage((message) => {
      this.handleMessage(viewer, message);
    });
    viewer.viewStateSubscription = panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        this.activeViewerId = viewer.id;
        this.markInteracted(viewer);
      } else if (this.activeViewerId === viewer.id) {
        this.pendingFocusRestore = {
          viewerId: viewer.id,
          uri: viewer.binding.key,
        };
        this.activeViewerId = undefined;
      }
    });
    viewer.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('livePreview.fontSize')) return;
      const fontSize = this.currentFontSize();
      void panel.webview.postMessage({ type: 'settings', fontSize });
    });
    viewer.disposeSubscription = panel.onDidDispose(() => this.disposeViewer(viewer));
    this.configureWebview(panel.webview, document.uri);
    panel.webview.html = this.getHtml(panel.webview);
    return viewer;
  }

  private handleMessage(viewer: Viewer, message: any): void {
    if (message?.type === 'interacted') {
      this.markInteracted(viewer);
      return;
    }

    switch (message?.type) {
      case 'ready':
        void this.postInit(viewer);
        break;
      case 'edit':
        this.enqueue(viewer, async () => {
          if (!isCurrentBinding(message.binding, viewer.binding.generation)) return;
          if (typeof message.text !== 'string') return;
          await this.applyEdit(viewer, message.text);
        });
        break;
      case 'toggleTask':
        this.enqueue(viewer, async () => {
          if (!isCurrentBinding(message.binding, viewer.binding.generation)) return;
          const result = toggleTaskAt(viewer.binding.webviewText, message.line);
          if (!result.changed) return;
          await this.applyEdit(viewer, result.text);
          await viewer.panel.webview.postMessage({
            type: 'update',
            text: result.text,
            binding: viewer.binding.generation,
          });
        });
        break;
      case 'openLink':
        if (!isCurrentBinding(message.binding, viewer.binding.generation)) return;
        void this.openLink(viewer.binding.uri, message.href);
        break;
      case 'renderError':
        if (!isCurrentBinding(message.binding, viewer.binding.generation)) return;
        vscode.window.showWarningMessage(
          `Live Preview のレンダリングに失敗しました: ${message.message}`,
        );
        break;
    }
  }

  private enqueue(viewer: Viewer, operation: () => Promise<void>): void {
    viewer.operationQueue = viewer.operationQueue
      .then(operation)
      .catch((error) => {
        console.error('Live Preview viewer operation failed', error);
        vscode.window.showWarningMessage(`Live Preview の更新に失敗しました: ${String(error)}`);
      });
  }

  private async applyEdit(viewer: Viewer, newLF: string): Promise<void> {
    const binding = viewer.binding;
    const document = await vscode.workspace.openTextDocument(binding.uri);
    if (viewer.binding !== binding) return;

    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const current = document.getText();
    const target = fromLF(newLF, eol);
    binding.webviewText = newLF;
    const diff = diffRange(current, target);
    if (!diff) return;

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      binding.uri,
      new vscode.Range(
        diff.range.start.line,
        diff.range.start.character,
        diff.range.end.line,
        diff.range.end.character,
      ),
      diff.newText,
    );
    await vscode.workspace.applyEdit(edit);
  }

  private async followActiveEditor(
    uri: vscode.Uri,
    pendingFocusRestore?: PendingViewerFocusRestore,
  ): Promise<void> {
    const targetKey = uri.toString();
    const decision = decideFollow(
      this.viewerStates(),
      targetKey,
      this.lastInteractedViewerId,
    );
    const restoreViewerId = decideFocusRestoreViewer(decision, targetKey, pendingFocusRestore);
    if (decision.type === 'none') return;
    if (decision.type === 'use-existing') {
      const existing = this.viewers.get(decision.viewerId);
      if (existing) {
        this.markInteracted(existing);
        if (restoreViewerId === existing.id) {
          existing.panel.reveal(existing.panel.viewColumn, false);
        }
      }
      return;
    }

    const viewer = this.viewers.get(decision.viewerId);
    if (!viewer) return;
    this.enqueue(viewer, async () => {
      await this.switchDocument(viewer, uri);
      if (restoreViewerId === viewer.id && viewer.binding.key === targetKey) {
        viewer.panel.reveal(viewer.panel.viewColumn, false);
      }
    });
  }

  /**
   * Runs in the same queue as edits, so all pending edits for the previous
   * binding settle before its listeners and URI ownership are replaced.
   */
  private async switchDocument(viewer: Viewer, uri: vscode.Uri): Promise<void> {
    const targetKey = uri.toString();
    if (viewer.binding.key === targetKey) return;
    const owner = this.viewersByUri.get(targetKey);
    if (owner && owner !== viewer) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== 'markdown') return;

    const previous = viewer.binding;
    this.viewersByUri.delete(previous.key);
    previous.changeSubscription.dispose();

    const generation = previous.generation + 1;
    viewer.binding = this.createBinding(viewer.panel, document, generation);
    this.viewersByUri.set(targetKey, viewer);
    viewer.panel.title = this.titleFor(uri);
    this.configureWebview(viewer.panel.webview, uri);
    await this.postInit(viewer);
  }

  private createBinding(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
    generation: number,
  ): ViewerBinding {
    let binding: ViewerBinding;
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== binding.key) return;
      const documentText = toLF(event.document.getText());
      const fromWebview = documentText === binding.webviewText;
      if (
        shouldResync({
          isFromWebview: fromWebview,
          webviewText: binding.webviewText,
          documentText,
        })
      ) {
        binding.webviewText = documentText;
        void panel.webview.postMessage({
          type: 'update',
          text: documentText,
          binding: binding.generation,
        });
      } else {
        binding.webviewText = documentText;
      }
    });
    binding = {
      uri: document.uri,
      key: document.uri.toString(),
      generation,
      webviewText: toLF(document.getText()),
      changeSubscription,
    };
    return binding;
  }

  private async postInit(viewer: Viewer): Promise<void> {
    const { binding, panel } = viewer;
    try {
      const document = await vscode.workspace.openTextDocument(binding.uri);
      if (viewer.binding !== binding) return;
      binding.webviewText = toLF(document.getText());
      const resourceBase = panel.webview
        .asWebviewUri(vscode.Uri.joinPath(binding.uri, '..'))
        .toString();
      await panel.webview.postMessage({
        type: 'init',
        text: binding.webviewText,
        fontSize: this.currentFontSize(),
        resourceBase,
        binding: binding.generation,
      });
    } catch (error) {
      vscode.window.showWarningMessage(
        `Live Preview の文書を読み込めませんでした: ${String(error)}`,
      );
    }
  }

  private configureWebview(webview: vscode.Webview, uri: vscode.Uri): void {
    const documentFolder = vscode.Uri.joinPath(uri, '..');
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        documentFolder,
        ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []),
      ],
    };
  }

  private markInteracted(viewer: Viewer): void {
    this.lastInteractedViewerId = viewer.id;
    if (viewer.panel.active) this.activeViewerId = viewer.id;
  }

  private disposeViewer(viewer: Viewer): void {
    viewer.binding.changeSubscription.dispose();
    viewer.messageSubscription?.dispose();
    viewer.viewStateSubscription?.dispose();
    viewer.configSubscription?.dispose();
    viewer.disposeSubscription?.dispose();
    this.viewers.delete(viewer.id);
    if (this.viewersByUri.get(viewer.binding.key) === viewer) {
      this.viewersByUri.delete(viewer.binding.key);
    }
    if (this.lastInteractedViewerId === viewer.id) {
      this.lastInteractedViewerId = [...this.viewers.keys()].at(-1);
    }
    if (this.activeViewerId === viewer.id) this.activeViewerId = undefined;
    if (this.pendingFocusRestore?.viewerId === viewer.id) this.pendingFocusRestore = undefined;
  }

  private viewerStates(): ViewerState[] {
    return [...this.viewers.values()].map((viewer) => ({
      id: viewer.id,
      uri: viewer.binding.key,
    }));
  }

  private followActiveEditorEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('livePreview')
      .get<boolean>('followActiveEditor', true);
  }

  private currentFontSize(): number {
    return resolveSettings({
      fontSize: vscode.workspace.getConfiguration('livePreview').get('fontSize'),
    }).fontSize;
  }

  private titleFor(uri: vscode.Uri): string {
    return `Live Preview: ${path.basename(uri.fsPath || uri.path)}`;
  }

  /** Open external URLs, relative files, or a deduplicated Markdown viewer. */
  private async openLink(documentUri: vscode.Uri, rawHref: unknown): Promise<void> {
    if (typeof rawHref !== 'string' || !rawHref) return;
    const href = rawHref.replace(/^<([\s\S]*)>$/, '$1');
    if (/^(https?|mailto):/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }

    let relative = href.split('#')[0].split('?')[0].replace(/\\/g, '/');
    try {
      relative = decodeURIComponent(relative);
    } catch {
      // Keep invalid percent-encoding unchanged.
    }
    if (!relative) return;

    const target = vscode.Uri.joinPath(documentUri, '..', relative);
    if (!(await this.fileExists(target))) {
      vscode.window.showWarningMessage(`リンク先が見つかりません: ${href}`);
      return;
    }
    if (/\.md$/i.test(target.path)) {
      await this.openLive(target);
    } else {
      await vscode.commands.executeCommand('vscode.open', target, { preview: false });
    }
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css'),
    );
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Live Preview</title>
</head>
<body>
  <div id="editor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
