import * as vscode from 'vscode';
import { shouldResync, diffRange, toggleTaskAt, toLF, fromLF } from './core/sync';
import { resolveSettings } from './core/viewport';

/**
 * CustomTextEditorProvider that renders a Markdown document with an embedded
 * CodeMirror 6 "live preview" editor inside a Webview, and keeps it in sync with
 * the underlying {@link vscode.TextDocument}.
 */
export class LivePreviewEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'livePreview.markdown';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      LivePreviewEditorProvider.viewType,
      this,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  /** The webview for the most-recently focused editor, for command routing. */
  private activePanel: vscode.WebviewPanel | undefined;
  /** The document backing the most-recently focused Live editor. */
  private activeDocument: vscode.TextDocument | undefined;

  /**
   * Switch the active Live editor back to VS Code's standard text editor for the
   * same document (Markdown All in One style). Replaces the Live editor in the
   * current tab; the standard editor is the plain Markdown source view, so we do
   * not ship our own in-webview source view.
   */
  public toggleActiveSource() {
    if (this.activeDocument) void this.switchEditor(this.activeDocument.uri, 'source');
  }

  /** Open the given document in the Live editor, replacing the source tab. */
  public openLive(uri: vscode.Uri) {
    return this.switchEditor(uri, 'live');
  }

  /**
   * Switch the active tab between the Live editor and VS Code's standard text
   * editor for `uri`, presenting the result in a single tab (no duplicates).
   *
   * `vscode.openWith` treats the custom editor (`viewType ===
   * 'livePreview.markdown'`) and the standard text editor (`'default'`) as
   * *different* editor inputs, so it opens a NEW tab instead of replacing the
   * existing one in place. To keep R-03's "same tab" contract we therefore:
   *   1. find the existing tab showing `uri` in the *source* view type,
   *   2. open the target view (active column),
   *   3. close that stale tab if it is still around and is not the tab we just
   *      opened.
   *
   * Closing the stale tab does NOT pop VS Code's "保存しますか？" dialog: the new
   * editor references the *same* `TextDocument`, so the document is never the
   * last editor being closed — a dirty buffer stays open and unsaved without a
   * prompt.
   */
  private async switchEditor(uri: vscode.Uri, target: 'live' | 'source'): Promise<void> {
    const targetViewType = target === 'live' ? LivePreviewEditorProvider.viewType : 'default';
    const oldTab = this.findTab(uri, target === 'live' ? 'source' : 'live');

    await vscode.commands.executeCommand('vscode.openWith', uri, targetViewType, {
      viewColumn: vscode.ViewColumn.Active,
    });

    // If openWith replaced the tab in place, `oldTab` is already gone and the
    // existence check below makes the close a no-op (safe in both cases).
    if (oldTab) {
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const stillOpen = vscode.window.tabGroups.all.some((g) => g.tabs.includes(oldTab));
      if (stillOpen && oldTab !== activeTab) {
        await vscode.window.tabGroups.close(oldTab);
      }
    }
  }

  /**
   * Locate the tab currently showing `uri` in the given editor flavor:
   * `'live'` → our custom editor input, `'source'` → the standard text input.
   */
  private findTab(uri: vscode.Uri, flavor: 'live' | 'source'): vscode.Tab | undefined {
    const wanted = uri.toString();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (flavor === 'live') {
          if (
            input instanceof vscode.TabInputCustom &&
            input.viewType === LivePreviewEditorProvider.viewType &&
            input.uri.toString() === wanted
          ) {
            return tab;
          }
        } else {
          if (input instanceof vscode.TabInputText && input.uri.toString() === wanted) {
            return tab;
          }
        }
      }
    }
    return undefined;
  }

  /** Route a formatting command (bold/italic/…) to the active webview editor. */
  public runFormat(kind: string) {
    this.activePanel?.webview.postMessage({ type: 'format', kind });
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.activePanel = webviewPanel;
    this.activeDocument = document;
    const webview = webviewPanel.webview;
    const docFolder = vscode.Uri.joinPath(document.uri, '..');
    // Must include the extension's own dir (dist/webview.js, media/editor.css);
    // setting localResourceRoots explicitly overrides the default that contains it.
    const roots = [
      this.context.extensionUri,
      docFolder,
      ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
    ];
    webview.options = { enableScripts: true, localResourceRoots: roots };
    webview.html = this.getHtml(webview);
    // Base URI the webview prefixes onto relative image paths.
    const resourceBase = webview.asWebviewUri(docFolder).toString();

    // What the webview currently believes the text is (LF-normalised, since
    // CodeMirror always works in LF) — used to suppress echoes.
    let webviewText = toLF(document.getText());

    const settings = resolveSettings({
      fontSize: vscode.workspace.getConfiguration('livePreview').get('fontSize'),
    });

    const postInit = () => {
      webviewText = toLF(document.getText());
      webview.postMessage({
        type: 'init',
        text: webviewText,
        fontSize: settings.fontSize,
        resourceBase,
      });
    };

    // Apply a webview edit (LF text) to the TextDocument as a minimal range
    // replace so VS Code's own undo history stays granular. The LF text is
    // converted to the document's EOL first, so a CRLF file keeps its endings
    // and the diff stays minimal (not a whole-document rewrite).
    const applyEditFromWebview = async (newLF: string) => {
      const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      const current = document.getText();
      const target = fromLF(newLF, eol);
      webviewText = newLF;
      const diff = diffRange(current, target);
      if (!diff) return;
      const edit = new vscode.WorkspaceEdit();
      const range = new vscode.Range(
        diff.range.start.line,
        diff.range.start.character,
        diff.range.end.line,
        diff.range.end.character,
      );
      edit.replace(document.uri, range, diff.newText);
      await vscode.workspace.applyEdit(edit);
    };

    // --- Inbound messages from the webview ---------------------------------
    const msgSub = webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          postInit();
          break;
        case 'edit':
          await applyEditFromWebview(msg.text);
          break;
        case 'toggleTask': {
          // Operate in the LF domain the webview uses, then re-apply EOL-aware.
          const result = toggleTaskAt(webviewText, msg.line);
          if (result.changed) await applyEditFromWebview(result.text);
          break;
        }
        case 'openLink':
          await this.openLink(document, msg.href);
          break;
        case 'renderError':
          vscode.window.showWarningMessage(
            `Live Preview のレンダリングに失敗したため標準エディタに切り替えました: ${msg.message}`,
          );
          // Reuse the single-tab switch so the fallback does not spawn a
          // duplicate tab (same active column + stale-tab cleanup).
          void this.switchEditor(document.uri, 'source');
          break;
      }
    });

    // --- Live settings changes (settings.json) -----------------------------
    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('livePreview')) return;
      const cfg = vscode.workspace.getConfiguration('livePreview');
      const next = resolveSettings({
        fontSize: cfg.get('fontSize'),
      });
      settings.fontSize = next.fontSize;
      webview.postMessage({ type: 'settings', fontSize: next.fontSize });
    });

    // --- External document changes (Git pull, other editors, …) ------------
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      // Compare in the LF domain so EOL differences don't trigger false resyncs.
      const docLF = toLF(document.getText());
      const fromWebview = docLF === webviewText;
      if (shouldResync({ isFromWebview: fromWebview, webviewText, documentText: docLF })) {
        webviewText = docLF;
        webview.postMessage({ type: 'update', text: docLF });
      } else {
        webviewText = docLF;
      }
    });

    const focusSub = webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        this.activePanel = webviewPanel;
        this.activeDocument = document;
      }
    });

    webviewPanel.onDidDispose(() => {
      msgSub.dispose();
      changeSub.dispose();
      focusSub.dispose();
      configSub.dispose();
      if (this.activePanel === webviewPanel) {
        this.activePanel = undefined;
        this.activeDocument = undefined;
      }
    });
  }

  /** Open a standard Markdown link: external URLs in the browser, relative paths as files. */
  private async openLink(document: vscode.TextDocument, href: string): Promise<void> {
    if (!href) return;
    if (/^(https?|mailto):/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    // Relative path → resolve against the document folder and open. Strip any
    // #fragment / ?query, normalise Windows separators, and decode %20 etc.
    let rel = href.split('#')[0].split('?')[0].replace(/\\/g, '/');
    try {
      rel = decodeURIComponent(rel);
    } catch {
      /* keep the raw path if it is not valid percent-encoding */
    }
    if (!rel) return;
    const target = vscode.Uri.joinPath(document.uri, '..', rel);
    if (!(await this.fileExists(target))) {
      vscode.window.showWarningMessage(`リンク先が見つかりません: ${href}`);
      return;
    }
    // Open Markdown targets in this Live Preview viewer (separate, persistent
    // tab in Live state); others in the default editor. `preview: false` makes
    // the tab persistent so it is not overwritten by the next ephemeral preview
    // tab. The current Live tab's view type is left untouched (stays Live).
    if (/\.md$/i.test(target.path)) {
      await vscode.commands.executeCommand('vscode.openWith', target, LivePreviewEditorProvider.viewType, {
        preview: false,
        viewColumn: vscode.ViewColumn.Active,
      });
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
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
