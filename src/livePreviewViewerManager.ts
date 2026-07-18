import * as path from 'path';
import * as vscode from 'vscode';
import { SelfSaveGuard } from './core/selfSaveGuard';
import {
  acceptsWebviewEditVersion,
  appliedEditVersion,
  classifyDocumentChange,
  consumeExpectedWorkspaceEditChange,
  diffRange,
  ExpectedWorkspaceEditChange,
  failedEditBaseVersion,
  fromLFPreserving,
  isSaveParticipantNormalization,
  isTrailingNewlineOnlyDifference,
  planDocumentChangeSync,
  toLF,
} from './core/sync';
import {
  decideAutoOpenedTabsToClose,
  decideFileEventAction,
  decideFollow,
  FileEventAction,
  findViewerForUri,
  isCurrentBinding,
  shouldPostDirtyState,
  ViewerState,
} from './core/viewer';
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
 * How long to wait after the last Webview keystroke before applying the
 * buffered edit to the TextDocument and immediately saving it (R-04-01 /
 * R-03-08). Applying on a short post-typing pause instead of per keystroke
 * keeps the document from lingering in a dirty state, which is what let VS
 * Code re-reveal a closed source tab. A module constant, not a setting, to
 * keep the surface minimal.
 */
const EDIT_APPLY_DEBOUNCE_MS = 200;

interface ViewerBinding {
  uri: vscode.Uri;
  key: string;
  generation: number;
  webviewText: string;
  /**
   * Latest Webview edit not yet applied to the TextDocument. Successive
   * keystrokes coalesce here (highest version wins) until the debounce timer
   * or a flush point applies it. Undefined when nothing is buffered.
   */
  pendingEdit?: { text: string; version: number };
  /** Debounce timer that fires {@link flushPendingEdit} after typing pauses. */
  editDebounceTimer?: ReturnType<typeof setTimeout>;
  /** Last fresh edit received from the Webview. */
  lastReceivedVersion: number;
  /** Last Webview edit successfully represented by the TextDocument. */
  lastAckVersion: number;
  /** Expected self echoes, keyed by source Webview version. */
  expectedWorkspaceChanges: Map<number, ExpectedWorkspaceEditChange>;
  /** Exact echo expected while restoring an authoritative external snapshot. */
  expectedAuthoritativeChange?: { documentVersion: number; text: string };
  /** Event-time origins retained until their queued reconciliation completes. */
  documentChangeOrigins: Map<number, { isSaveNormalization: boolean; text: string }>;
  changeSubscription: vscode.Disposable;
  /**
   * Suppresses echoes of any save of this binding's document — including
   * saves initiated by another editor of the same document (autosave, manual
   * save, format on save). Save participants (trim trailing whitespace,
   * insert final newline, format on save, etc.) can rewrite the document
   * after the save resolves; such changes must not be echoed back to the
   * Webview as an external change.
   */
  saveGuard: SelfSaveGuard;
  /** Token from the current save window's `saveGuard.begin()`, if any. */
  saveToken: number;
  /** Subscriptions to the document's will-save/did-save lifecycle. */
  saveLifecycleSubscriptions: vscode.Disposable[];
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
    let viewer: Viewer;
    const binding = this.createBinding(panel, document, 1, () => viewer);
    viewer = {
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
      // Flush any buffered edit and persist whenever the panel loses active
      // focus so nothing stays unapplied/unsaved while the user works
      // elsewhere (durability, R-03-08).
      else this.enqueue(viewer, async () => this.flushPendingEdit(viewer));
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
    // A message received after disposal must not create a new operation, but
    // operations received before disposal remain in the serial queue.
    if (viewer.disposed) return;
    if (message?.type === 'interacted') {
      this.markInteracted(viewer);
      return;
    }

    switch (message?.type) {
      case 'ready':
        this.postInit(viewer);
        break;
      case 'edit': {
        // Buffer the edit and (re)arm the debounce timer instead of applying
        // per keystroke. Coalescing to the latest version keeps the document
        // out of a lingering dirty state; the timer flushes (apply + save)
        // once typing pauses (R-04-01 / R-03-08).
        if (!isCurrentBinding(message.binding, viewer.binding.generation)) return;
        if (typeof message.text !== 'string') return;
        if (typeof message.version !== 'number') return;
        const binding = viewer.binding;
        binding.pendingEdit = { text: message.text, version: message.version };
        if (binding.editDebounceTimer) clearTimeout(binding.editDebounceTimer);
        binding.editDebounceTimer = setTimeout(() => {
          this.enqueue(viewer, async () => this.flushPendingEdit(viewer));
        }, EDIT_APPLY_DEBOUNCE_MS);
        break;
      }
      case 'save':
        // Explicit save (Ctrl+S / Cmd+S) forwarded from the Webview: a
        // WebviewPanel is not a CustomTextEditor, so VS Code's own Ctrl+S does
        // not reach the bound TextDocument (R-03-08). Enqueue behind pending
        // edits so the just-typed text is persisted.
        this.enqueue(viewer, async () => {
          if (!isCurrentBinding(message.binding, viewer.binding.generation)) return;
          await this.flushPendingEdit(viewer);
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
        await operation();
      })
      .catch((error) => {
        console.error('Live Preview viewer operation failed', error);
        vscode.window.showWarningMessage(`Live Preview の更新に失敗しました: ${String(error)}`);
      });
  }

  private async applyEdit(viewer: Viewer, newLF: string, receivedVersion?: unknown): Promise<void> {
    const binding = viewer.binding;
    if (!acceptsWebviewEditVersion({
      lastReceivedVersion: binding.lastReceivedVersion,
      receivedVersion,
    })) {
      return;
    }
    const version = receivedVersion as number;
    binding.lastReceivedVersion = version;
    const document = await vscode.workspace.openTextDocument(binding.uri);
    if (viewer.binding !== binding) return;

    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const current = document.getText();
    const target = fromLFPreserving(newLF, current, eol);
    binding.webviewText = newLF;
    const diff = diffRange(current, target);
    if (!diff) {
      binding.lastAckVersion = appliedEditVersion({
        previousVersion: binding.lastAckVersion,
        receivedVersion: version,
        completed: true,
      });
      await this.postAck(viewer, binding, version);
      return;
    }

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
    // Register the expected event before applyEdit. `onDidChangeTextDocument`
    // can fire before the promise resolves, and only this exact text/version
    // pair is a self echo. A version-keyed ledger also survives queued edits.
    binding.expectedWorkspaceChanges.set(version, {
      editVersion: version,
      documentVersion: document.version + 1,
      text: toLF(target),
    });
    const tabUrisBeforeApply = this.tabUrisSnapshot();
    const applied = await vscode.workspace.applyEdit(edit);
    if (viewer.binding !== binding) return;
    await this.closeAutoOpenedSourceTab(binding.key, tabUrisBeforeApply);
    if (!applied) {
      binding.expectedWorkspaceChanges.delete(version);
      binding.webviewText = toLF(document.getText());
      vscode.window.showWarningMessage('Live Preview の編集をドキュメントへ適用できませんでした。');
      if (!viewer.disposed) {
        await viewer.panel.webview.postMessage({
          type: 'update',
          text: binding.webviewText,
          binding: binding.generation,
          baseVersion: failedEditBaseVersion({
            appliedVersion: binding.lastAckVersion,
            failedVersion: version,
          }),
          rollback: true,
        });
      }
      return;
    }
    binding.lastAckVersion = appliedEditVersion({
      previousVersion: binding.lastAckVersion,
      receivedVersion: version,
      completed: true,
    });
    await this.postAck(viewer, binding, version);
    await this.postDirtyState(viewer);
    // The WorkspaceEdit above applies the buffered edit as a minimal diff
    // (R-04-01). Persistence is driven by the caller (`flushPendingEdit`),
    // which saves immediately after the batch apply so the document does not
    // linger dirty (R-03-08); this is what stops VS Code from re-revealing a
    // closed source tab at the source (R-03-11 remains as a backstop).
  }

  /**
   * Apply the binding's buffered edit (if any) and immediately persist, all in
   * the serial operation queue so apply strictly precedes save (R-04-01 /
   * R-03-08). This is the single choke point every flush site routes through
   * (debounce fire, blur, disposal, binding switch, explicit save, and before
   * reconciling an external change) so no buffered keystroke is ever dropped.
   * Applying and then saving collapses the dirty window to the moment between
   * the two, which keeps a closed source tab from being re-revealed.
   */
  private async flushPendingEdit(viewer: Viewer): Promise<void> {
    const binding = viewer.binding;
    if (binding.editDebounceTimer) {
      clearTimeout(binding.editDebounceTimer);
      binding.editDebounceTimer = undefined;
    }
    const pending = binding.pendingEdit;
    if (pending) {
      binding.pendingEdit = undefined;
      await this.applyEdit(viewer, pending.text, pending.version);
    }
    // Re-read the binding: a switch inside `applyEdit` cannot happen (it is
    // synchronous with respect to the queue), but guarding keeps save bound to
    // the same generation that owned the pending edit.
    if (viewer.binding !== binding) return;
    await this.performSave(binding, viewer);
  }

  /** Send an acknowledgement only after success or an identical-text no-op. */
  private async postAck(viewer: Viewer, binding: ViewerBinding, version: number): Promise<void> {
    if (viewer.disposed || viewer.binding !== binding) return;
    await viewer.panel.webview.postMessage({
      type: 'ack',
      binding: binding.generation,
      version,
    });
  }

  /**
   * Send the host's authoritative dirty state (`TextDocument.isDirty`, R-31)
   * to the Webview so it can show/hide the unsaved indicator. The Webview
   * never estimates dirty state itself; it only reflects what the host sends.
   */
  private async postDirtyState(viewer: Viewer): Promise<void> {
    const binding = viewer.binding;
    if (!shouldPostDirtyState(viewer.disposed, binding.generation, viewer.binding.generation)) {
      return;
    }
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(binding.uri);
    } catch {
      return;
    }
    if (!shouldPostDirtyState(viewer.disposed, binding.generation, viewer.binding.generation)) {
      return;
    }
    await viewer.panel.webview.postMessage({
      type: 'dirty',
      dirty: document.isDirty,
      binding: binding.generation,
    });
  }

  /**
   * Persist the bound document if it has unsaved changes. Invoked on explicit
   * save (Webview Ctrl+S) and on lifecycle flush points (blur / disposal /
   * binding switch). Re-opens the TextDocument by URI so it works after the
   * source tab is closed; a `false`/failed save warns.
   *
   * `viewer`, when supplied, receives a post-save dirty-state notification
   * (R-31) once the save completes successfully, so the unsaved indicator
   * clears without waiting for `onDidSaveTextDocument` to route through the
   * operation queue.
   */
  private async performSave(binding: ViewerBinding, viewer?: Viewer): Promise<boolean> {
    try {
      const document = await vscode.workspace.openTextDocument(binding.uri);
      if (!document.isDirty) return true;
      const tabUrisBeforeSave = this.tabUrisSnapshot();
      const saved = await document.save();
      await this.closeAutoOpenedSourceTab(binding.key, tabUrisBeforeSave);
      if (!saved) {
        vscode.window.showWarningMessage('Live Preview の編集をドキュメントへ保存できませんでした。');
      } else if (viewer) {
        await this.postDirtyState(viewer);
      }
      return saved;
    } catch (error) {
      console.error('Live Preview deferred save failed', error);
      return false;
    }
  }

  /**
   * Restore an event-time external snapshot after a pending local flush has
   * temporarily overwritten the TextDocument. The exact apply echo is guarded
   * separately from the Webview-edit ledger, then the restored document is
   * saved immediately so TextDocument, disk, binding, and Webview can converge.
   */
  private async restoreAuthoritativeDocumentSnapshot(
    viewer: Viewer,
    binding: ViewerBinding,
    targetLF: string,
  ): Promise<string | undefined> {
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(binding.uri);
    } catch {
      return undefined;
    }
    if (viewer.binding !== binding) return undefined;

    const current = document.getText();
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const target = fromLFPreserving(targetLF, current, eol);
    const diff = diffRange(current, target);
    if (!diff) return toLF(current);

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
    binding.expectedAuthoritativeChange = {
      documentVersion: document.version + 1,
      text: toLF(target),
    };
    const applied = await vscode.workspace.applyEdit(edit);
    if (viewer.binding !== binding) return undefined;
    if (!applied) {
      binding.expectedAuthoritativeChange = undefined;
      vscode.window.showWarningMessage('外部変更を Live Preview の文書へ復元できませんでした。');
      return undefined;
    }

    if (!(await this.performSave(binding, viewer))) return undefined;
    try {
      const finalDocument = await vscode.workspace.openTextDocument(binding.uri);
      if (viewer.binding !== binding) return undefined;
      return toLF(finalDocument.getText());
    } catch {
      return undefined;
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
      requestId?: unknown;
      selectedText?: unknown;
      files?: { name: string; data: Uint8Array }[];
      uris?: string[];
    },
  ): Promise<void> {
    if (typeof message.requestId !== 'number' || !Number.isSafeInteger(message.requestId)) return;
    const binding = viewer.binding;
    const documentFolder = vscode.Uri.joinPath(binding.uri, '..');
    const destFolder = this.mediaDestinationFolder();
    const targetDir = vscode.Uri.joinPath(documentFolder, destFolder);

    const targets: { relative: string; isImage: boolean }[] = [];
    const files = Array.isArray(message.files) ? message.files : [];
    const suppliedFiles = files.filter((file): file is { name: string; data: Uint8Array } =>
      !!file && typeof file.name === 'string' && !!file.data,
    );
    const uriTargets = parseUriList(Array.isArray(message.uris) ? message.uris.join('\n') : '');
    // URI payloads from VS Code Explorer are canonical over duplicate Files.
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

    const selectedText = typeof message.selectedText === 'string' ? message.selectedText : undefined;
    // The drag/drop and paste path keeps its historical multiple-file join
    // (a single space between links).
    await this.postInsertMediaSnippets(
      viewer,
      binding,
      message.requestId,
      targets.map((target) => ({
        isImage: target.isImage,
        target: formatMarkdownLinkTarget(target.relative),
      })),
      selectedText,
    );
  }

  /** Build snippets for resolved DataTransfer targets and insert them together. */
  private async postInsertMediaSnippets(
    viewer: Viewer,
    binding: ViewerBinding,
    requestId: number,
    targets: { isImage: boolean; target: string }[],
    selectedText: string | undefined,
  ): Promise<void> {
    if (targets.length === 0) return;
    if (viewer.disposed || viewer.binding !== binding) return;
    const combined = combineWithSpace(
      targets.map((target) =>
        buildMediaSnippet({
          isImage: target.isImage,
          target: target.target,
          selectedText,
        }),
      ),
    );
    await viewer.panel.webview.postMessage({
      type: 'insertMedia',
      binding: binding.generation,
      requestId,
      text: combined.text,
      placeholderFrom: combined.placeholderFrom,
      placeholderTo: combined.placeholderTo,
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

  /** Resolve a workspace file URI to a document-relative forward-slash target. */
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
    // Flush the outgoing binding's buffered edit and persist before its
    // listeners and URI ownership are replaced, so no unapplied keystroke is
    // carried into the new URI or dropped (durability, R-03-08). `viewer.binding`
    // is still `previous` here, so `flushPendingEdit` targets it.
    await this.flushPendingEdit(viewer);
    this.viewersByUri.delete(previous.key);
    previous.changeSubscription.dispose();
    for (const subscription of previous.saveLifecycleSubscriptions) subscription.dispose();

    const generation = previous.generation + 1;
    viewer.binding = this.createBinding(viewer.panel, document, generation, () => viewer);
    this.viewersByUri.set(targetKey, viewer);
    viewer.panel.title = this.titleFor(uri);
    this.configureWebview(viewer.panel.webview, uri);
    this.postInit(viewer);
  }

  private createBinding(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
    generation: number,
    getViewer: () => Viewer,
  ): ViewerBinding {
    let binding: ViewerBinding;
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== binding.key) return;
      const eventDocumentVersion = event.document.version;
      const documentText = toLF(event.document.getText());
      const expectedAuthoritativeChange = binding.expectedAuthoritativeChange;
      if (
        expectedAuthoritativeChange?.documentVersion === eventDocumentVersion &&
        expectedAuthoritativeChange.text === documentText
      ) {
        binding.expectedAuthoritativeChange = undefined;
        const echoViewer = getViewer();
        if (echoViewer && !echoViewer.disposed) {
          this.enqueue(echoViewer, async () => this.postDirtyState(echoViewer));
        }
        return;
      }
      const selfVersion = consumeExpectedWorkspaceEditChange({
        ledger: binding.expectedWorkspaceChanges,
        documentVersion: eventDocumentVersion,
        documentText,
      });
      if (selfVersion !== undefined) {
        binding.expectedWorkspaceChanges.delete(selfVersion);
        binding.webviewText = documentText;
        const echoViewer = getViewer();
        if (echoViewer && !echoViewer.disposed) {
          this.enqueue(echoViewer, async () => this.postDirtyState(echoViewer));
        }
        return;
      }

      const isDuringOwnSave = binding.saveGuard.isActive;
      const syncPlan = planDocumentChangeSync({
        hasPendingEdit: binding.pendingEdit !== undefined,
        isDuringOwnSave,
        webviewText: binding.webviewText,
        documentText,
      });
      const viewer = getViewer();
      if (!viewer || viewer.disposed) return;
      binding.documentChangeOrigins.set(eventDocumentVersion, {
        isSaveNormalization: syncPlan.isSaveNormalization,
        text: documentText,
      });
      this.enqueue(viewer, async () => {
        try {
          if (viewer.binding !== binding) return;

          // Classify the event origin before entering the queue, then flush the
          // latest coalesced Webview edit in this same queued operation. For a
          // save-normalization event, its captured text is stale after the flush:
          // re-read the bound document and classify the final text instead. A
          // genuine external event keeps its captured authoritative snapshot.
          if (syncPlan.flushPendingEdit && binding.pendingEdit) await this.flushPendingEdit(viewer);
          if (viewer.binding !== binding) return;

          let syncDocumentText = documentText;
          let syncIsSaveNormalization = syncPlan.isSaveNormalization;
          if (syncPlan.snapshotSource === 'document-after-flush') {
            let currentDocument: vscode.TextDocument;
            try {
              currentDocument = await vscode.workspace.openTextDocument(binding.uri);
            } catch {
              return;
            }
            if (viewer.binding !== binding) return;
            syncDocumentText = toLF(currentDocument.getText());

            // A later non-ledger event can land while the pending flush or the
            // re-read is awaiting VS Code. Use its event-time origin as a
            // version fence. A later true external event owns its snapshot and
            // will reconcile in its own queued callback; the older save event
            // must not consume it as a history-preserving update.
            const currentOrigin = binding.documentChangeOrigins.get(currentDocument.version);
            if (
              currentDocument.version !== eventDocumentVersion &&
              currentOrigin?.text === syncDocumentText
            ) {
              if (!currentOrigin.isSaveNormalization) return;
              syncIsSaveNormalization = true;
            } else if (currentDocument.version !== eventDocumentVersion) {
              syncIsSaveNormalization = isSaveParticipantNormalization(
                binding.webviewText,
                syncDocumentText,
              );
            }
          }

          const { resync, preserveHistory } = classifyDocumentChange({
            isFromWebview: false,
            webviewText: binding.webviewText,
            documentText: syncDocumentText,
            isSaveNormalization: syncIsSaveNormalization,
          });
          if (!resync) return;
          // A save participant that only changed the document's trailing final
          // newline (`files.insertFinalNewline` / `files.trimFinalNewlines`) must
          // not be reflected into CodeMirror. Applying it out-of-history strands
          // the boundary newline when the user later undoes an earlier edit,
          // inserting a blank line and making undo non-monotonic (undo appearing
          // to add lines). The Webview owns user content; the final newline is a
          // save-time concern re-applied on each save, so reconcile only the
          // host's dirty state and leave `binding.webviewText` as the content the
          // Webview actually holds (without the boundary newline).
          if (preserveHistory && isTrailingNewlineOnlyDifference(binding.webviewText, syncDocumentText)) {
            if (viewer.disposed) return;
            await this.postDirtyState(viewer);
            return;
          }

          if (!preserveHistory) {
            const restoredText = await this.restoreAuthoritativeDocumentSnapshot(
              viewer,
              binding,
              syncDocumentText,
            );
            if (restoredText === undefined) return;
            syncDocumentText = restoredText;
          }

          binding.webviewText = syncDocumentText;
          if (viewer.disposed) return;
          await panel.webview.postMessage({
            type: 'update',
            text: syncDocumentText,
            binding: binding.generation,
            baseVersion: binding.lastAckVersion,
            ...(preserveHistory ? { preserveHistory: true } : {}),
          });
          await this.postDirtyState(viewer);
        } finally {
          binding.documentChangeOrigins.delete(eventDocumentVersion);
        }
      });
    });
    const willSaveSubscription = vscode.workspace.onWillSaveTextDocument((event) => {
      if (event.document.uri.toString() !== binding.key) return;
      binding.saveToken = binding.saveGuard.begin();
    });
    const didSaveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.toString() !== binding.key) return;
      binding.saveGuard.end(binding.saveToken);
      const viewer = getViewer();
      if (!viewer || viewer.disposed) return;
      this.enqueue(viewer, async () => this.postDirtyState(viewer));
    });
    binding = {
      uri: document.uri,
      key: document.uri.toString(),
      generation,
      webviewText: toLF(document.getText()),
      lastReceivedVersion: 0,
      lastAckVersion: 0,
      expectedWorkspaceChanges: new Map(),
      documentChangeOrigins: new Map(),
      changeSubscription,
      saveGuard: new SelfSaveGuard(),
      saveToken: 0,
      saveLifecycleSubscriptions: [willSaveSubscription, didSaveSubscription],
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
        void panel.webview.postMessage({
          type: 'dirty',
          dirty: document.isDirty,
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
    // Queue a flush behind edits already received from the Webview. The panel
    // is gone, but the buffered edit is still applied and saved.
    this.enqueue(viewer, async () => {
      await this.flushPendingEdit(viewer);
    });
    viewer.binding.changeSubscription.dispose();
    for (const subscription of viewer.binding.saveLifecycleSubscriptions) subscription.dispose();
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

  private suppressSourceAutoOpenEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('livePreview')
      .get<boolean>('suppressSourceAutoOpen', true);
  }

  /** Snapshot every visible tab's underlying document URI (as a string). */
  private tabUrisSnapshot(): string[] {
    const uris: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri) uris.push(input.uri.toString());
      }
    }
    return uris;
  }

  /**
   * Close a source editor tab for `uriKey` if — and only if — it newly
   * appeared as a side effect of the edit/save operation just performed
   * (R-03-08 / R-03-11). A tab already visible before the operation, which may
   * have been opened deliberately by the user, is never touched.
   */
  private async closeAutoOpenedSourceTab(uriKey: string, tabUrisBefore: string[]): Promise<void> {
    if (!this.suppressSourceAutoOpenEnabled()) return;
    const tabUrisAfter = this.tabUrisSnapshot();
    if (!decideAutoOpenedTabsToClose(uriKey, tabUrisBefore, tabUrisAfter)) return;
    const tabsToClose: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri?.toString() === uriKey) tabsToClose.push(tab);
      }
    }
    if (tabsToClose.length > 0) {
      await vscode.window.tabGroups.close(tabsToClose);
    }
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
    // KaTeX stylesheet (R-32). Served from media/katex/; its relative `fonts/…`
    // url()s resolve against this URI's directory (media/katex/fonts/) and are
    // allowed by `font-src ${cspSource}`.
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
