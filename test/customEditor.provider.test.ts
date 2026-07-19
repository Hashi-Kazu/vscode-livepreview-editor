import { readFileSync } from 'fs';
import { join } from 'path';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { classifyUndoRedoKey } from '../src/core/editing';
import {
  appliedEditVersion,
  computeRemotePatch,
  consumeExpectedWorkspaceEditChange,
  diffRange,
  ExpectedWorkspaceEditChange,
  fromLFPreserving,
  shouldApplyRemoteUpdate,
  shouldEmitEdit,
  toLF,
} from '../src/core/sync';

/**
 * Deterministic harness for the Custom Text Editor host (R-03-12 custom editor
 * registration, R-33 Undo/Redo delegation & key routing & host sync contract,
 * R-04 self-echo / external reflection). It mirrors
 * {@link LivePreviewEditorSession}'s serial queue and sync decisions around a
 * fake TextDocument and a minimal (history-less) real CodeMirror Webview, so the
 * ordering guarantees can be asserted without a live VS Code / DOM.
 */

type ChangeListener = (version: number, text: string) => void;

class FakeDoc {
  version = 1;
  isDirty = false;
  diskText: string;
  saveParticipant?: (text: string) => string;
  /** Texts a subsequent undo/redo (executeCommand) will produce, in order. */
  historyStack: string[] = [];
  private listeners: ChangeListener[] = [];

  constructor(
    public text: string,
    public readonly eol: '\n' | '\r\n' = '\n',
  ) {
    this.diskText = text;
  }

  onDidChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  getText(): string {
    return this.text;
  }

  private fire(): void {
    for (const listener of this.listeners) listener(this.version, this.text);
  }

  /** Apply the exact text a WorkspaceEdit resolves to (an own edit / self echo). */
  applyEditResult(target: string): void {
    this.text = target;
    this.version += 1;
    this.isDirty = true;
    this.fire();
  }

  /** Apply an authoritative external change (standard editor, Git, etc.). */
  applyExternal(text: string): void {
    this.text = text;
    this.version += 1;
    this.isDirty = true;
    this.fire();
  }

  /** Simulate VS Code's `executeCommand('undo'|'redo')` mutating the document. */
  execHistory(): void {
    const next = this.historyStack.shift();
    if (next !== undefined) this.applyExternal(next);
  }

  async save(): Promise<void> {
    if (this.saveParticipant) {
      const normalized = this.saveParticipant(this.text);
      if (normalized !== this.text) {
        this.text = normalized;
        this.version += 1;
        this.fire();
      }
    }
    this.diskText = this.text;
    this.isDirty = false;
  }
}

class Session {
  ops: string[] = [];
  webviewText: string;
  pendingEdit?: { text: string; version: number };
  lastReceived = 0;
  lastAck = 0;
  expected = new Map<number, ExpectedWorkspaceEditChange>();
  updatesToWebview: string[] = [];
  savedCount = 0;
  disposed = false;
  webview?: Webview;
  private queue: Promise<void> = Promise.resolve();

  constructor(public doc: FakeDoc) {
    this.webviewText = toLF(doc.text);
    doc.onDidChange((version, text) => this.onDocChanged(version, text));
  }

  private enqueue(op: () => Promise<void>): void {
    this.queue = this.queue.then(op).catch(() => {});
  }

  async drain(): Promise<void> {
    for (;;) {
      const queued = this.queue;
      await queued;
      if (queued === this.queue) return;
    }
  }

  // Webview → host messages.
  edit(text: string, version: number): void {
    this.pendingEdit = { text, version };
  }
  requestFlush(): void {
    this.enqueue(() => this.flushPendingEdit());
  }
  save(): void {
    this.enqueue(async () => {
      this.ops.push('save-request');
      await this.saveDocument();
    });
  }
  undo(): void {
    this.enqueue(() => this.runHistory('undo'));
  }
  redo(): void {
    this.enqueue(() => this.runHistory('redo'));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ops.push('dispose');
    this.enqueue(() => this.flushPendingEdit());
  }

  private async flushPendingEdit(): Promise<void> {
    if (!this.pendingEdit) return;
    this.ops.push('flush');
    await this.applyPendingEdit();
  }

  private async applyPendingEdit(): Promise<void> {
    const pending = this.pendingEdit;
    if (!pending) return;
    this.pendingEdit = undefined;
    if (!(pending.version > this.lastReceived)) return;
    this.lastReceived = pending.version;

    const current = this.doc.getText();
    const target = fromLFPreserving(pending.text, current, this.doc.eol);
    this.webviewText = pending.text;
    const diff = diffRange(current, target);
    if (!diff) {
      this.lastAck = appliedEditVersion({
        previousVersion: this.lastAck,
        receivedVersion: pending.version,
        completed: true,
      });
      this.postAck(pending.version);
      return;
    }
    this.expected.set(pending.version, {
      editVersion: pending.version,
      documentVersion: this.doc.version + 1,
      text: toLF(target),
    });
    this.ops.push('workspace-edit');
    this.doc.applyEditResult(target);
    this.lastAck = appliedEditVersion({
      previousVersion: this.lastAck,
      receivedVersion: pending.version,
      completed: true,
    });
    this.postAck(pending.version);
  }

  private async saveDocument(): Promise<void> {
    await this.flushPendingEdit();
    if (this.doc.isDirty) {
      this.ops.push('doc.save');
      this.savedCount += 1;
      await this.doc.save();
    }
  }

  private async runHistory(kind: 'undo' | 'redo'): Promise<void> {
    this.ops.push(`${kind}-request`);
    await this.flushPendingEdit();
    this.ops.push(`exec:${kind}`);
    this.doc.execHistory();
  }

  private onDocChanged(version: number, text: string): void {
    const lf = toLF(text);
    const selfVersion = consumeExpectedWorkspaceEditChange({
      ledger: this.expected,
      documentVersion: version,
      documentText: lf,
    });
    if (selfVersion !== undefined) {
      this.expected.delete(selfVersion);
      this.webviewText = lf;
      this.ops.push('self-echo-consumed');
      return;
    }
    this.ops.push('external-change');
    this.enqueue(() => this.reconcile());
  }

  private async reconcile(): Promise<void> {
    if (this.disposed) return;
    if (this.pendingEdit) await this.applyPendingEdit();
    const text = toLF(this.doc.getText());
    if (text === this.webviewText) return;
    this.webviewText = text;
    this.ops.push('webview-update');
    this.updatesToWebview.push(text);
    this.webview?.onUpdate(text, this.lastAck);
  }

  private postAck(version: number): void {
    this.webview?.onAck(version);
  }
}

/** Minimal history-less Webview mirroring the new src/webview/main.ts sync. */
class Webview {
  state = EditorState.create({ doc: '' });
  editVersion = 0;
  ackVersion = 0;
  applyingRemote = false;
  session!: Session;

  localEdit(spec: TransactionSpec): void {
    const before = this.state.doc.toString();
    this.state = this.state.update(spec).state;
    const after = this.state.doc.toString();
    if (
      shouldEmitEdit({ docChanged: after !== before, composing: false, applyingRemote: this.applyingRemote })
    ) {
      this.postEdit(after);
    }
  }

  private postEdit(text: string): void {
    this.editVersion += 1;
    this.session.edit(text, this.editVersion);
  }

  onAck(version: number): void {
    if (Number.isSafeInteger(version) && version > this.ackVersion && version <= this.editVersion) {
      this.ackVersion = version;
    }
  }

  onUpdate(text: string, baseVersion: number): void {
    if (
      !shouldApplyRemoteUpdate({
        baseVersion,
        editVersion: this.editVersion,
        ackVersion: this.ackVersion,
        composing: false,
        pendingLocalChange: false,
      })
    ) {
      return;
    }
    this.setText(text);
  }

  setText(text: string): void {
    const doc = this.state.doc.toString();
    if (doc === text) return;
    const sel = this.state.selection.main;
    const patch = computeRemotePatch(doc, text, { anchor: sel.anchor, head: sel.head });
    this.applyingRemote = true;
    try {
      this.state = this.state.update({
        changes: { from: patch.from, to: patch.to, insert: patch.insert },
        selection: { anchor: patch.anchor, head: patch.head },
      }).state;
    } finally {
      this.applyingRemote = false;
    }
  }
}

function connect(doc: FakeDoc): { host: Session; wv: Webview } {
  const host = new Session(doc);
  const wv = new Webview();
  host.webview = wv;
  wv.session = host;
  return { host, wv };
}

describe('classifyUndoRedoKey (webview key routing)', () => {
  const base = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false };

  it('classifies Ctrl+Z / Cmd+Z as undo', () => {
    expect(classifyUndoRedoKey({ ...base, key: 'z', ctrlKey: true })).toBe('undo');
    expect(classifyUndoRedoKey({ ...base, key: 'z', metaKey: true })).toBe('undo');
    expect(classifyUndoRedoKey({ ...base, key: 'Z', ctrlKey: true })).toBe('undo');
  });

  it('classifies Ctrl/Cmd+Shift+Z and Ctrl+Y as redo', () => {
    expect(classifyUndoRedoKey({ ...base, key: 'z', ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(classifyUndoRedoKey({ ...base, key: 'z', metaKey: true, shiftKey: true })).toBe('redo');
    expect(classifyUndoRedoKey({ ...base, key: 'y', ctrlKey: true })).toBe('redo');
  });

  it('does not treat Cmd+Y as redo (not a macOS shortcut)', () => {
    expect(classifyUndoRedoKey({ ...base, key: 'y', metaKey: true })).toBeUndefined();
  });

  it('classifies Ctrl/Cmd+S as save', () => {
    expect(classifyUndoRedoKey({ ...base, key: 's', ctrlKey: true })).toBe('save');
    expect(classifyUndoRedoKey({ ...base, key: 's', metaKey: true })).toBe('save');
  });

  it('returns undefined during IME composition', () => {
    expect(classifyUndoRedoKey({ ...base, key: 'z', ctrlKey: true, isComposing: true })).toBeUndefined();
    expect(classifyUndoRedoKey({ ...base, key: 's', metaKey: true, isComposing: true })).toBeUndefined();
  });

  it('returns undefined when Alt is held or no modifier is present', () => {
    expect(classifyUndoRedoKey({ ...base, key: 'z', ctrlKey: true, altKey: true })).toBeUndefined();
    expect(classifyUndoRedoKey({ ...base, key: 'z' })).toBeUndefined();
    expect(classifyUndoRedoKey({ ...base, key: 'a', ctrlKey: true })).toBeUndefined();
  });
});

describe('Custom Text Editor host sync (R-33 / R-04)', () => {
  it('28.1 does not echo a host update back to the host as an edit', async () => {
    const doc = new FakeDoc('');
    const { host, wv } = connect(doc);
    doc.applyExternal('external');
    await host.drain();
    expect(wv.state.doc.toString()).toBe('external');
    // The webview applied under applyingRemote, so no edit was posted back.
    expect(wv.editVersion).toBe(0);
    expect(host.pendingEdit).toBeUndefined();
  });

  it('28.2 does not dispatch when a host update matches the current text', () => {
    const wv = new Webview();
    wv.session = new Session(new FakeDoc(''));
    wv.setText('same');
    const stateAfterFirst = wv.state;
    wv.setText('same');
    expect(wv.state).toBe(stateAfterFirst); // early return, no new transaction
  });

  it('28.3 flushes the pending edit before executing undo', async () => {
    const doc = new FakeDoc('');
    const { host, wv } = connect(doc);
    doc.historyStack = ['']; // undo empties the document again
    wv.localEdit({ changes: { from: 0, insert: 'a' }, selection: { anchor: 1 } });
    host.undo();
    await host.drain();
    const flushIdx = host.ops.indexOf('workspace-edit');
    const execIdx = host.ops.indexOf('exec:undo');
    expect(flushIdx).toBeGreaterThanOrEqual(0);
    expect(execIdx).toBeGreaterThan(flushIdx);
    expect(host.ops).not.toContain('doc.save'); // undo never saves
  });

  it('28.4 flushes the pending edit before executing redo', async () => {
    const doc = new FakeDoc('');
    const { host, wv } = connect(doc);
    doc.historyStack = ['ab'];
    wv.localEdit({ changes: { from: 0, insert: 'a' }, selection: { anchor: 1 } });
    host.redo();
    await host.drain();
    const flushIdx = host.ops.indexOf('workspace-edit');
    const execIdx = host.ops.indexOf('exec:redo');
    expect(flushIdx).toBeGreaterThanOrEqual(0);
    expect(execIdx).toBeGreaterThan(flushIdx);
    expect(host.ops).not.toContain('doc.save');
  });

  it('28.5 flushes the pending edit before saving (flush precedes document.save)', async () => {
    const doc = new FakeDoc('');
    const { host, wv } = connect(doc);
    wv.localEdit({ changes: { from: 0, insert: 'hi' }, selection: { anchor: 2 } });
    host.save();
    await host.drain();
    const editIdx = host.ops.indexOf('workspace-edit');
    const saveIdx = host.ops.indexOf('doc.save');
    expect(editIdx).toBeGreaterThanOrEqual(0);
    expect(saveIdx).toBeGreaterThan(editIdx);
    expect(doc.diskText).toBe('hi');
    expect(doc.isDirty).toBe(false);
  });

  it('28.6 consumes a self echo without re-sending it as a Webview update', async () => {
    const doc = new FakeDoc('');
    const { host, wv } = connect(doc);
    wv.localEdit({ changes: { from: 0, insert: 'x' }, selection: { anchor: 1 } });
    host.requestFlush();
    await host.drain();
    expect(host.ops).toContain('self-echo-consumed');
    expect(host.updatesToWebview).toEqual([]); // no echo back to the Webview
    expect(doc.text).toBe('x');
  });

  it('28.7 reflects an external undo/edit into the Webview as an update', async () => {
    const doc = new FakeDoc('start');
    const { host, wv } = connect(doc);
    wv.setText('start');
    doc.applyExternal('start!');
    await host.drain();
    expect(host.updatesToWebview).toEqual(['start!']);
    expect(wv.state.doc.toString()).toBe('start!');
  });

  it('28.8 a save-participant rewrite is reflected once and never bounces back as an edit', async () => {
    const doc = new FakeDoc('');
    doc.saveParticipant = (text) => text.toUpperCase(); // format-on-save style rewrite
    const { host, wv } = connect(doc);
    wv.localEdit({ changes: { from: 0, insert: 'ab' }, selection: { anchor: 2 } });
    host.save();
    await host.drain();

    // The document was normalized and the Webview reflects it.
    expect(doc.diskText).toBe('AB');
    expect(host.updatesToWebview).toEqual(['AB']);
    expect(wv.state.doc.toString()).toBe('AB');
    // The reflected update did not produce a fresh Webview edit (no loop): the
    // only edit ever posted was the original 'ab'.
    expect(wv.editVersion).toBe(1);
    expect(host.pendingEdit).toBeUndefined();
  });

  it('28.10 applies a buffered edit on dispose but never saves', async () => {
    const doc = new FakeDoc('');
    const { host, wv } = connect(doc);
    wv.localEdit({ changes: { from: 0, insert: 'z' }, selection: { anchor: 1 } });
    host.dispose();
    await host.drain();
    expect(doc.text).toBe('z'); // buffered input applied, not lost
    expect(host.savedCount).toBe(0); // dispose never saves
    expect(host.ops).not.toContain('doc.save');
  });
});

describe('28.9 CodeMirror history is not used by the Webview', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'webview', 'main.ts'), 'utf8');

  it('does not import or register CodeMirror history()/historyKeymap', () => {
    expect(source).not.toMatch(/\bhistory\s*\(\)/);
    expect(source).not.toMatch(/\bhistoryKeymap\b/);
    // The @codemirror/commands import must no longer pull in history helpers.
    const importLine = source.match(/import \{([^}]*)\} from '@codemirror\/commands';/);
    expect(importLine).not.toBeNull();
    expect(importLine![1]).not.toMatch(/\bhistory\b/);
    expect(importLine![1]).not.toMatch(/\bisolateHistory\b/);
  });

  it('forwards undo/redo/save to the host instead of handling them locally', () => {
    expect(source).toMatch(/classifyUndoRedoKey/);
  });
});
