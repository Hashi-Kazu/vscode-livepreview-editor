import * as path from 'path';
import * as vscode from 'vscode';
import {
  appliedEditVersion,
  consumeExpectedWorkspaceEditChange,
  diffRange,
  ExpectedWorkspaceEditChange,
  fromLFPreserving,
  toLF,
} from './core/sync';
import { resolveSettings } from './core/viewport';
import {
  buildMediaSnippet,
  dedupeFilesAgainstUris,
  formatMarkdownLinkTarget,
  isImageFile,
  MediaSnippet,
  parseUriList,
  uniqueMediaName,
} from './core/pasteLink';

/**
 * Delay after the last Webview keystroke before the buffered edit is applied to
 * the TextDocument. Coalescing keeps VS Code's own undo units close to the
 * natural editing rhythm. It is only a batching window: correctness-critical
 * flush points (Undo/Redo, save, blur, dispose) flush synchronously ahead of
 * the timer so no confirmed input is ever lost.
 */
const EDIT_APPLY_DEBOUNCE_MS = 200;

/**
 * Live Preview as a VS Code Custom *Text* Editor.
 *
 * Each editor is bound for its whole life to the single {@link vscode.TextDocument}
 * VS Code passes to {@link resolveCustomTextEditor}; there is no active-editor
 * following, no `workspace.openTextDocument` re-fetch, and no extension-owned
 * autosave. Undo/Redo is delegated to VS Code, and persistence is driven by the
 * Webview's Ctrl+S (forwarded here) and VS Code's standard autoSave. All state
 * mutations for one editor run through a per-editor serial operation queue.
 */
export class LivePreviewCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'livePreview.editor';

  private readonly sessions = new Set<LivePreviewEditorSession>();
  private lastActive: LivePreviewEditorSession | undefined;
  private readonly output: vscode.OutputChannel;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel('Live Preview');
    context.subscriptions.push(this.output);
  }

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    const session = new LivePreviewEditorSession(this.context, this.output, document, webviewPanel, {
      onActive: (active) => {
        this.lastActive = active;
      },
      onDispose: (closed) => {
        this.sessions.delete(closed);
        if (this.lastActive === closed) {
          this.lastActive = [...this.sessions].at(-1);
        }
      },
    });
    this.sessions.add(session);
    this.lastActive = session;
  }

  /** Route a formatting command to the most recently active Live Preview editor. */
  public runFormat(kind: string): void {
    this.lastActive?.postFormat(kind);
  }
}

interface SessionHost {
  onActive(session: LivePreviewEditorSession): void;
  onDispose(session: LivePreviewEditorSession): void;
}

let nextSessionId = 1;

/** One resolved Custom Text Editor: its Webview, bound document, and sync state. */
class LivePreviewEditorSession {
  /** Stable identity for this editor instance; sent to the Webview as `binding`. */
  private readonly id = nextSessionId++;
  private readonly uri: vscode.Uri;

  private operationQueue: Promise<void> = Promise.resolve();
  private disposed = false;

  /** Latest LF text the Webview is known to hold / the document was set to. */
  private webviewText: string;
  /** Buffered Webview edit not yet applied to the TextDocument. */
  private pendingEdit?: { text: string; version: number };
  private editDebounceTimer?: ReturnType<typeof setTimeout>;
  private lastReceivedVersion = 0;
  private lastAckVersion = 0;
  /** Self echoes of our own WorkspaceEdits, keyed by source Webview version. */
  private readonly expectedChanges = new Map<number, ExpectedWorkspaceEditChange>();

  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    private readonly sessionHost: SessionHost,
  ) {
    this.uri = document.uri;
    this.webviewText = toLF(document.getText());

    this.configureWebview();
    this.panel.webview.html = this.getHtml();
    this.log('custom-editor-open', { chars: this.webviewText.length });

    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message)),
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('livePreview.fontSize')) return;
        void this.panel.webview.postMessage({ type: 'settings', fontSize: this.currentFontSize() });
      }),
      this.panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.active) {
          this.sessionHost.onActive(this);
        } else {
          // Blur may apply the buffered edit (durability); it must never save.
          this.enqueue(async () => this.flushPendingEdit());
        }
      }),
    );
    this.panel.onDidDispose(() => this.dispose());
  }

  /** Forward a formatting command to this editor's Webview. */
  postFormat(kind: string): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage({ type: 'format', kind });
  }

  // --- Webview message handling ----------------------------------------------

  private handleMessage(message: any): void {
    if (this.disposed) return;
    switch (message?.type) {
      case 'ready':
        this.log('webview-ready', {});
        this.postInit();
        break;
      case 'edit':
        if (message.binding !== this.id) return;
        if (typeof message.text !== 'string' || typeof message.version !== 'number') return;
        this.queuePendingEdit(message.text, message.version);
        break;
      case 'save':
        if (message.binding !== this.id) return;
        this.enqueue(async () => {
          this.log('save-request', {});
          await this.saveDocument();
          this.log('save-complete', { dirty: this.document.isDirty });
        });
        break;
      case 'undo':
        if (message.binding !== this.id) return;
        this.enqueue(async () => this.runHistoryCommand('undo'));
        break;
      case 'redo':
        if (message.binding !== this.id) return;
        this.enqueue(async () => this.runHistoryCommand('redo'));
        break;
      case 'pasteMedia':
        if (message.binding !== this.id) return;
        this.enqueue(async () => this.handlePasteMedia(message));
        break;
      case 'openLink':
        if (message.binding !== this.id) return;
        void this.openLink(message.href);
        break;
      case 'renderError':
        if (message.binding !== this.id) return;
        vscode.window.showWarningMessage(
          `Live Preview のレンダリングに失敗しました: ${message.message}`,
        );
        break;
    }
  }

  // --- Pending edit lifecycle (R-03-08 / R-04-01) ----------------------------

  /** Buffer the latest Webview edit and (re)arm the debounce timer. */
  private queuePendingEdit(text: string, version: number): void {
    this.pendingEdit = { text, version };
    this.log('pending-edit-updated', { version, chars: text.length });
    if (this.editDebounceTimer) clearTimeout(this.editDebounceTimer);
    this.editDebounceTimer = setTimeout(() => {
      this.enqueue(async () => this.flushPendingEdit());
    }, EDIT_APPLY_DEBOUNCE_MS);
  }

  /** Clear the debounce timer and apply the buffered edit, if any. Never saves. */
  private async flushPendingEdit(): Promise<void> {
    if (this.editDebounceTimer) {
      clearTimeout(this.editDebounceTimer);
      this.editDebounceTimer = undefined;
    }
    if (!this.pendingEdit) return;
    this.log('pending-flush', { version: this.pendingEdit.version });
    await this.applyPendingEdit();
  }

  /** Apply the buffered edit to the TextDocument as a minimal WorkspaceEdit. */
  private async applyPendingEdit(): Promise<void> {
    const pending = this.pendingEdit;
    if (!pending) return;
    this.pendingEdit = undefined;
    if (
      typeof pending.version !== 'number' ||
      !Number.isSafeInteger(pending.version) ||
      pending.version <= this.lastReceivedVersion
    ) {
      return;
    }
    this.lastReceivedVersion = pending.version;

    const eol = this.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const current = this.document.getText();
    const target = fromLFPreserving(pending.text, current, eol);
    this.webviewText = pending.text;

    const diff = diffRange(current, target);
    if (!diff) {
      this.lastAckVersion = appliedEditVersion({
        previousVersion: this.lastAckVersion,
        receivedVersion: pending.version,
        completed: true,
      });
      await this.postAck(pending.version);
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      this.uri,
      new vscode.Range(
        diff.range.start.line,
        diff.range.start.character,
        diff.range.end.line,
        diff.range.end.character,
      ),
      diff.newText,
    );
    // Register the expected self echo before applyEdit: onDidChangeTextDocument
    // can fire before the promise resolves, and only this text/version pair is a
    // self echo that must not be reflected back to the Webview.
    this.expectedChanges.set(pending.version, {
      editVersion: pending.version,
      documentVersion: this.document.version + 1,
      text: toLF(target),
    });
    this.log('workspace-edit-start', {
      version: pending.version,
      range: `${diff.range.start.line}:${diff.range.start.character}-${diff.range.end.line}:${diff.range.end.character}`,
    });
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      this.expectedChanges.delete(pending.version);
      this.webviewText = toLF(this.document.getText());
      this.log('workspace-edit-failed', { version: pending.version });
      vscode.window.showWarningMessage('Live Preview の編集をドキュメントへ適用できませんでした。');
      if (!this.disposed) {
        await this.panel.webview.postMessage({
          type: 'update',
          text: this.webviewText,
          binding: this.id,
          baseVersion: Math.max(this.lastAckVersion, pending.version),
          rollback: true,
        });
      }
      return;
    }
    this.log('workspace-edit-complete', { version: pending.version, dirty: this.document.isDirty });
    this.lastAckVersion = appliedEditVersion({
      previousVersion: this.lastAckVersion,
      receivedVersion: pending.version,
      completed: true,
    });
    await this.postAck(pending.version);
    await this.postDirtyState();
  }

  /** Flush any buffered edit, then persist the document (explicit save only). */
  private async saveDocument(): Promise<void> {
    await this.flushPendingEdit();
    if (this.document.isDirty) {
      const saved = await this.document.save();
      if (!saved) {
        vscode.window.showWarningMessage('Live Preview の編集をドキュメントへ保存できませんでした。');
        return;
      }
      this.log('document-saved', { dirty: this.document.isDirty });
    }
    await this.postDirtyState();
  }

  /** Flush the buffered edit, then delegate Undo/Redo to VS Code (R-33-02 / R-33-03). */
  private async runHistoryCommand(kind: 'undo' | 'redo'): Promise<void> {
    this.log(`${kind}-request`, {});
    await this.flushPendingEdit();
    await vscode.commands.executeCommand(kind);
    this.log(`${kind}-complete`, { version: this.document.version, dirty: this.document.isDirty });
    // The command mutates the TextDocument; onDidChangeTextDocument then reflects
    // the result to the Webview as an external change.
  }

  // --- Document change reconciliation ----------------------------------------

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (event.document.uri.toString() !== this.uri.toString()) return;
    const documentVersion = event.document.version;
    const documentText = toLF(event.document.getText());

    const selfVersion = consumeExpectedWorkspaceEditChange({
      ledger: this.expectedChanges,
      documentVersion,
      documentText,
    });
    if (selfVersion !== undefined) {
      this.expectedChanges.delete(selfVersion);
      this.webviewText = documentText;
      this.log('self-echo-consumed', { version: selfVersion, documentVersion });
      if (!this.disposed) this.enqueue(async () => this.postDirtyState());
      return;
    }

    // Any change we did not originate (VS Code Undo/Redo, standard editing,
    // save participants, Git, other extensions, autoSave normalization) is an
    // external change reflected one-directionally into the Webview (R-33-04).
    this.log('external-change', { documentVersion, chars: documentText.length });
    this.enqueue(async () => this.reconcileExternalChange());
  }

  private async reconcileExternalChange(): Promise<void> {
    if (this.disposed) return;
    // Preserve any confirmed-but-unapplied local input before adopting the
    // external document text, so keystrokes are never dropped (R-33-02).
    if (this.pendingEdit) await this.applyPendingEdit();
    const text = toLF(this.document.getText());
    if (text === this.webviewText) {
      await this.postDirtyState();
      return;
    }
    this.webviewText = text;
    if (!this.disposed) {
      this.log('webview-update', { chars: text.length, baseVersion: this.lastAckVersion });
      await this.panel.webview.postMessage({
        type: 'update',
        text,
        binding: this.id,
        baseVersion: this.lastAckVersion,
      });
    }
    await this.postDirtyState();
  }

  // --- Webview <- host bookkeeping messages ----------------------------------

  private async postAck(version: number): Promise<void> {
    if (this.disposed) return;
    await this.panel.webview.postMessage({ type: 'ack', binding: this.id, version });
  }

  private async postDirtyState(): Promise<void> {
    if (this.disposed) return;
    await this.panel.webview.postMessage({
      type: 'dirty',
      dirty: this.document.isDirty,
      binding: this.id,
    });
  }

  private postInit(): void {
    if (this.disposed) return;
    this.webviewText = toLF(this.document.getText());
    const resourceBase = this.panel.webview
      .asWebviewUri(vscode.Uri.joinPath(this.uri, '..'))
      .toString();
    void this.panel.webview.postMessage({
      type: 'init',
      text: this.webviewText,
      fontSize: this.currentFontSize(),
      resourceBase,
      binding: this.id,
    });
    void this.panel.webview.postMessage({
      type: 'dirty',
      dirty: this.document.isDirty,
      binding: this.id,
    });
  }

  // --- Media paste / drop (R-29) ---------------------------------------------

  private async handlePasteMedia(message: {
    binding: number;
    requestId?: unknown;
    selectedText?: unknown;
    files?: { name: string; data: Uint8Array }[];
    uris?: string[];
  }): Promise<void> {
    if (typeof message.requestId !== 'number' || !Number.isSafeInteger(message.requestId)) return;
    const documentFolder = vscode.Uri.joinPath(this.uri, '..');
    const destFolder = this.mediaDestinationFolder();
    const targetDir = vscode.Uri.joinPath(documentFolder, destFolder);

    const targets: { relative: string; isImage: boolean }[] = [];
    const files = Array.isArray(message.files) ? message.files : [];
    const suppliedFiles = files.filter(
      (file): file is { name: string; data: Uint8Array } =>
        !!file && typeof file.name === 'string' && !!file.data,
    );
    const uriTargets = parseUriList(Array.isArray(message.uris) ? message.uris.join('\n') : '');
    const validFiles = dedupeFilesAgainstUris(suppliedFiles, uriTargets);
    let assetNames: Set<string> | undefined;
    let documentNames: Set<string> | undefined;

    const saveToAssets = async (name: string, data: Uint8Array): Promise<string> => {
      if (!assetNames) {
        assetNames = await this.directoryNames(targetDir);
        await this.ensureDirectory(targetDir);
      }
      const unique = uniqueMediaName(sanitizeFileName(name), (candidate) => assetNames!.has(candidate));
      assetNames.add(unique);
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(targetDir, unique), data);
      return joinRelative(destFolder, unique);
    };
    const saveMarkdownBesideDocument = async (name: string, data: Uint8Array): Promise<string> => {
      if (!documentNames) documentNames = await this.directoryNames(documentFolder);
      const unique = uniqueMediaName(sanitizeFileName(name), (candidate) => documentNames!.has(candidate));
      documentNames.add(unique);
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(documentFolder, unique), data);
      return unique;
    };
    for (const raw of uriTargets) {
      const resolved = await this.relativizeUri(raw, documentFolder);
      if (!resolved) continue;
      const name = path.basename(resolved.uri.fsPath || resolved.uri.path);
      targets.push({ relative: resolved.relative, isImage: isImageFile(name) });
    }

    if (validFiles.length > 0) {
      for (const file of validFiles) {
        try {
          const isImage = isImageFile(file.name);
          const isMarkdown = /\.md$/i.test(file.name);
          const relative = isMarkdown
            ? await saveMarkdownBesideDocument(file.name, new Uint8Array(file.data))
            : await saveToAssets(file.name, new Uint8Array(file.data));
          targets.push({ relative, isImage });
        } catch {
          vscode.window.showWarningMessage(`Live Preview: file could not be saved: ${file.name}`);
        }
      }
    }

    if (targets.length === 0) return;
    if (this.disposed) return;

    const selectedText = typeof message.selectedText === 'string' ? message.selectedText : undefined;
    const combined = combineWithSpace(
      targets.map((target) =>
        buildMediaSnippet({
          isImage: target.isImage,
          target: formatMarkdownLinkTarget(target.relative),
          selectedText,
        }),
      ),
    );
    await this.panel.webview.postMessage({
      type: 'insertMedia',
      binding: this.id,
      requestId: message.requestId,
      text: combined.text,
      placeholderFrom: combined.placeholderFrom,
      placeholderTo: combined.placeholderTo,
    });
  }

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

  private async relativizeUri(
    raw: unknown,
    documentFolder: vscode.Uri,
  ): Promise<{ uri: vscode.Uri; relative: string } | undefined> {
    if (typeof raw !== 'string' || !raw) {
      vscode.window.showWarningMessage('Live Preview: invalid dropped URI.');
      return undefined;
    }
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(raw.trim());
    } catch {
      vscode.window.showWarningMessage(`Live Preview: invalid dropped URI: ${raw}`);
      return undefined;
    }
    if (uri.scheme !== 'file') {
      vscode.window.showWarningMessage(`Live Preview: unsupported dropped URI: ${raw}`);
      return undefined;
    }
    const inWorkspace = (vscode.workspace.workspaceFolders ?? []).some((folder) => {
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
    });
    if (!inWorkspace) {
      vscode.window.showWarningMessage('Live Preview: ワークスペース外のファイルはリンクに挿入できません。');
      return undefined;
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.File) === 0) throw new Error('not a file');
    } catch {
      vscode.window.showWarningMessage(`Live Preview: dropped URI could not be read: ${raw}`);
      return undefined;
    }
    const relative = path.relative(documentFolder.fsPath, uri.fsPath);
    if (!relative || path.isAbsolute(relative)) return undefined;
    return { uri, relative: relative.split(path.sep).join('/') };
  }

  // --- Link handling ----------------------------------------------------------

  private async openLink(rawHref: unknown): Promise<void> {
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

    const target = vscode.Uri.joinPath(this.uri, '..', relative);
    if (!(await this.fileExists(target))) {
      vscode.window.showWarningMessage(`リンク先が見つかりません: ${href}`);
      return;
    }
    if (/\.md$/i.test(target.path)) {
      await vscode.commands.executeCommand('livePreview.openWith', target);
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

  // --- Webview configuration --------------------------------------------------

  private configureWebview(): void {
    const documentFolder = vscode.Uri.joinPath(this.uri, '..');
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        documentFolder,
        ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []),
      ],
    };
  }

  private currentFontSize(): number {
    return resolveSettings({
      fontSize: vscode.workspace.getConfiguration('livePreview').get('fontSize'),
    }).fontSize;
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css'),
    );
    const katexStyleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'katex', 'katex.min.css'),
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
  <link href="${katexStyleUri}" rel="stylesheet" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Live Preview</title>
</head>
<body>
  <div id="editor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  // --- Lifecycle --------------------------------------------------------------

  private enqueue(operation: () => Promise<void>): void {
    this.operationQueue = this.operationQueue
      .then(() => operation())
      .catch((error) => {
        this.output.appendLine(`[error] ${String(error)}`);
      });
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.log('editor-dispose', { pending: this.pendingEdit !== undefined });
    // Apply any buffered edit so a keystroke made just before closing the editor
    // is not lost. The panel is gone, so no ack/update is posted afterwards, and
    // the document is never saved here (R-33-04).
    this.enqueue(async () => this.flushPendingEdit());
    if (this.editDebounceTimer) {
      clearTimeout(this.editDebounceTimer);
      this.editDebounceTimer = undefined;
    }
    for (const subscription of this.subscriptions) subscription.dispose();
    this.sessionHost.onDispose(this);
  }

  private log(event: string, info: Record<string, unknown>): void {
    const parts = Object.entries(info).map(([key, value]) => `${key}=${String(value)}`);
    this.output.appendLine(
      `[${event}] uri=${this.uri.toString()} docVersion=${this.document.version} ` +
        `editVersion=${this.lastReceivedVersion} ${parts.join(' ')}`.trimEnd(),
    );
  }
}

/**
 * Combine snippets with a single space (the historical drag/drop-paste join),
 * keeping the first link's placeholder range so the Webview selects its label.
 */
function combineWithSpace(snippets: MediaSnippet[]): MediaSnippet {
  const first = snippets[0];
  return {
    text: snippets.map((snippet) => snippet.text).join(' '),
    placeholderFrom: first.placeholderFrom,
    placeholderTo: first.placeholderTo,
  };
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
