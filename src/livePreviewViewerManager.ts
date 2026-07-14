import * as path from 'path';
import * as vscode from 'vscode';
import { SelfSaveGuard } from './core/selfSaveGuard';
import { diffRange, fromLFPreserving, shouldResync, toggleTaskAt, toLF } from './core/sync';
import {
  decideFileEventAction,
  decideFollow,
  FileEventAction,
  findViewerForUri,
  isCurrentBinding,
  ViewerState,
} from './core/viewer';
import { resolveSettings } from './core/viewport';
import {
  buildMediaSnippet,
  formatMarkdownLinkTarget,
  isImageFile,
  uniqueMediaName,
} from './core/pasteLink';

interface ViewerBinding {
  uri: vscode.Uri;
  key: string;
  generation: number;
  webviewText: string;
  lastEditVersion: number;
  changeSubscription: vscode.Disposable;
  /**
   * Suppresses echoes of this binding's own `document.save()` call. Save
   * participants (trim trailing whitespace, insert final newline, format on
   * save, etc.) can rewrite the document after `save()` resolves; such
   * changes must not be echoed back to the Webview as an external change.
   */
  saveGuard: SelfSaveGuard;
}

interface Viewer {
  id: string;
  panel: vscode.WebviewPanel;
  binding: ViewerBinding;
  operationQueue: Promise<void>;
  disposed?: boolean;
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
  private nextViewerId = 1;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor || editor.document.languageId !== 'markdown') return;
        if (!this.followActiveEditorEnabled()) return;
        void this.followActiveEditor(editor.document.uri);
      }),
      vscode.workspace.onDidRenameFiles((event) => {
        const actions = decideFileEventAction(this.viewerStates(), {
          type: 'rename',
          files: event.files.map((file) => ({
            oldUri: file.oldUri.toString(),
            newUri: file.newUri.toString(),
          })),
        });
        this.applyFileEventActions(actions);
      }),
      vscode.workspace.onDidDeleteFiles((event) => {
        const actions = decideFileEventAction(this.viewerStates(), {
          type: 'delete',
          uris: event.files.map((uri) => uri.toString()),
        });
        this.applyFileEventActions(actions);
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
      if (event.webviewPanel.active) this.markInteracted(viewer);
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
        this.postInit(viewer);
        break;
      case 'edit':
        this.enqueue(viewer, async () => {
          if (!isCurrentBinding(message.binding, viewer.binding.generation)) return;
          if (typeof message.text !== 'string') return;
          if (typeof message.version === 'number') {
            viewer.binding.lastEditVersion = Math.max(viewer.binding.lastEditVersion, message.version);
          }
          await this.applyEdit(viewer, message.text);
        });
        break;
      case 'toggleTask':
        this.enqueue(viewer, async () => {
          if (!isCurrentBinding(message.binding, viewer.binding.generation)) return;
          const result = toggleTaskAt(viewer.binding.webviewText, message.line);
          if (!result.changed) return;
          await this.applyEdit(viewer, result.text);
          if (viewer.disposed || viewer.binding.webviewText !== result.text) return;
          await viewer.panel.webview.postMessage({
            type: 'update',
            text: result.text,
            binding: viewer.binding.generation,
            baseVersion: viewer.binding.lastEditVersion,
          });
        });
        break;
      case 'pasteMedia':
        this.enqueue(viewer, async () => {
          if (!isCurrentBinding(message.binding, viewer.binding.generation)) return;
          await this.handlePasteMedia(viewer, message);
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
      .then(async () => {
        if (viewer.disposed) return;
        await operation();
      })
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
    const target = fromLFPreserving(newLF, current, eol);
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
    const applied = await vscode.workspace.applyEdit(edit);
    if (viewer.binding !== binding) return;
    if (!applied) {
      binding.webviewText = toLF(document.getText());
      vscode.window.showWarningMessage('Live Preview の編集をドキュメントへ適用できませんでした。');
      if (!viewer.disposed) {
        await viewer.panel.webview.postMessage({
          type: 'update',
          text: binding.webviewText,
          binding: binding.generation,
          baseVersion: binding.lastEditVersion,
        });
      }
      return;
    }
    const savedDocument = await vscode.workspace.openTextDocument(binding.uri);
    if (viewer.binding !== binding) return;
    const token = binding.saveGuard.begin();
    try {
      const saved = await savedDocument.save();
      if (!saved) {
        vscode.window.showWarningMessage('Live Preview の編集をドキュメントへ保存できませんでした。');
      }
    } finally {
      binding.saveGuard.end(token);
    }
  }

  /**
   * Save pasted/dropped binaries into the workspace and resolve dropped URIs to
   * relative paths, then reply with a single `insertMedia` snippet for the
   * Webview to insert at the current selection (R-29).
   */
  private async handlePasteMedia(
    viewer: Viewer,
    message: {
      binding: number;
      files?: { name: string; data: Uint8Array }[];
      uris?: string[];
    },
  ): Promise<void> {
    const binding = viewer.binding;
    const documentFolder = vscode.Uri.joinPath(binding.uri, '..');
    const destFolder = this.mediaDestinationFolder();
    const targetDir = vscode.Uri.joinPath(documentFolder, destFolder);

    const relTargets: string[] = [];

    const files = Array.isArray(message.files) ? message.files : [];
    if (files.length > 0) {
      const taken = await this.directoryNames(targetDir);
      if (files.length > 0) {
        await this.ensureDirectory(targetDir);
      }
      for (const file of files) {
        if (!file || typeof file.name !== 'string' || !file.data) continue;
        const name = uniqueMediaName(sanitizeFileName(file.name), (n) => taken.has(n));
        taken.add(name);
        const fileUri = vscode.Uri.joinPath(targetDir, name);
        await vscode.workspace.fs.writeFile(fileUri, new Uint8Array(file.data));
        relTargets.push(joinRelative(destFolder, name));
      }
    }

    const uris = Array.isArray(message.uris) ? message.uris : [];
    for (const raw of uris) {
      const rel = this.relativizeUri(raw, documentFolder);
      if (rel) relTargets.push(rel);
    }

    if (relTargets.length === 0) return;
    if (viewer.disposed || viewer.binding !== binding) return;

    const snippets = relTargets.map((rel) => {
      const base = rel.split('/').pop() ?? rel;
      return buildMediaSnippet({
        isImage: isImageFile(base),
        target: formatMarkdownLinkTarget(rel),
      });
    });

    const first = snippets[0];
    const text = snippets.map((s) => s.text).join(' ');
    await viewer.panel.webview.postMessage({
      type: 'insertMedia',
      binding: binding.generation,
      text,
      placeholderFrom: first.placeholderFrom,
      placeholderTo: first.placeholderTo,
    });
  }

  /**
   * Resolve the destination folder (relative to the document) for saved media.
   * Honors a plain relative folder from `markdown.copyFiles.destination`; glob
   * variables and absolute paths are ignored in favor of the default `assets`.
   */
  private mediaDestinationFolder(): string {
    const configured = vscode.workspace
      .getConfiguration('markdown')
      .get<Record<string, string>>('copyFiles.destination');
    if (configured && typeof configured === 'object') {
      for (const value of Object.values(configured)) {
        if (typeof value !== 'string' || !value) continue;
        if (value.includes('${') || value.includes('*')) continue;
        if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) continue;
        return value.replace(/\/+$/, '').replace(/\/[^/]*\.[^/]*$/, '') || 'assets';
      }
    }
    return 'assets';
  }

  private async ensureDirectory(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(uri);
    } catch {
      // Directory may already exist; writeFile will surface real errors.
    }
  }

  private async directoryNames(uri: vscode.Uri): Promise<Set<string>> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      return new Set(entries.map(([name]) => name));
    } catch {
      return new Set();
    }
  }

  /** Return a forward-slash path relative to the document folder, or undefined. */
  private relativizeUri(raw: unknown, documentFolder: vscode.Uri): string | undefined {
    if (typeof raw !== 'string' || !raw) return undefined;
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(raw.trim());
    } catch {
      return undefined;
    }
    if (uri.scheme !== 'file') return undefined;
    const bases = [documentFolder, ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [])];
    for (const base of bases) {
      const rel = path.relative(base.fsPath, uri.fsPath);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel.split(path.sep).join('/');
      }
    }
    return undefined;
  }

  private async followActiveEditor(uri: vscode.Uri): Promise<void> {
    const decision = decideFollow(
      this.viewerStates(),
      uri.toString(),
      this.lastInteractedViewerId,
    );
    if (decision.type === 'none') return;
    if (decision.type === 'use-existing') {
      const existing = this.viewers.get(decision.viewerId);
      if (existing) this.markInteracted(existing);
      return;
    }

    const viewer = this.viewers.get(decision.viewerId);
    if (!viewer) return;
    this.enqueue(viewer, async () => this.switchDocument(viewer, uri));
  }

  private applyFileEventActions(actions: readonly FileEventAction[]): void {
    for (const action of actions) {
      const viewer = this.viewers.get(action.viewerId);
      if (!viewer) continue;
      if (action.type === 'close') {
        this.enqueue(viewer, async () => viewer.panel.dispose());
        continue;
      }
      this.enqueue(viewer, async () => {
        if (viewer.binding.key !== action.oldKey) return;
        await this.switchDocument(viewer, vscode.Uri.parse(action.newKey));
      });
    }
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
    this.postInit(viewer);
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
          isDuringOwnSave: binding.saveGuard.isActive,
        })
      ) {
        binding.webviewText = documentText;
        void panel.webview.postMessage({
          type: 'update',
          text: documentText,
          binding: binding.generation,
          baseVersion: binding.lastEditVersion,
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
      lastEditVersion: 0,
      changeSubscription,
      saveGuard: new SelfSaveGuard(),
    };
    return binding;
  }

  private postInit(viewer: Viewer): void {
    const { binding, panel } = viewer;
    void vscode.workspace.openTextDocument(binding.uri).then(
      (document) => {
        if (viewer.binding !== binding) return;
        binding.webviewText = toLF(document.getText());
        const resourceBase = panel.webview
          .asWebviewUri(vscode.Uri.joinPath(binding.uri, '..'))
          .toString();
        void panel.webview.postMessage({
          type: 'init',
          text: binding.webviewText,
          fontSize: this.currentFontSize(),
          resourceBase,
          binding: binding.generation,
        });
      },
      (error) => {
        vscode.window.showWarningMessage(
          `Live Preview の文書を読み込めませんでした: ${String(error)}`,
        );
      },
    );
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
  }

  private disposeViewer(viewer: Viewer): void {
    viewer.disposed = true;
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

/** Join a relative folder and filename with forward slashes. */
function joinRelative(folder: string, name: string): string {
  const clean = folder.replace(/^\/+/, '').replace(/\/+$/, '');
  return clean ? `${clean}/${name}` : name;
}

/** Strip path separators from a dropped filename so it stays a single segment. */
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base || 'file';
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
