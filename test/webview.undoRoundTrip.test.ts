import { history, isolateHistory, undo } from '@codemirror/commands';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  acceptsWebviewEditVersion,
  appliedEditVersion,
  classifyDocumentChange,
  computeRemotePatch,
  consumeExpectedWorkspaceEditChange,
  diffRange,
  fromLFPreserving,
  isSaveParticipantNormalization,
  isTrailingNewlineOnlyDifference,
  planDocumentChangeSync,
  shouldApplyRemoteUpdate,
  toLF,
  type ExpectedWorkspaceEditChange,
} from '../src/core/sync';

/**
 * Deterministic host <-> webview round-trip harness (R-04-01/R-04-02/R-04-03,
 * R-03-08). It replicates the exact decision logic of the extension host
 * (`LivePreviewViewerManager.applyEdit` + `onDidChangeTextDocument`) and the
 * Webview message handling (`setText` / `applyPendingRemote` / ack protocol)
 * around a *real* CodeMirror `history()` state, so undo behaviour is exercised
 * end-to-end without a live VS Code or DOM.
 *
 * Regression target: connected typing then repeated undo must decrease
 * monotonically without inserting blank lines or bouncing back to more lines
 * (the reported "undo #4 returns to 3 lines" defect). The trigger was a
 * `files.insertFinalNewline` save participant echoing a boundary newline into
 * CodeMirror as an out-of-history change, which strands the newline when an
 * earlier edit is undone.
 */

type Eol = '\n' | '\r\n';

interface Combo {
  insertFinalNewline: boolean;
  trimTrailingWhitespace: boolean;
  saveDuringUndo: boolean;
  trailingNewlineInput: boolean;
  eol: Eol;
}

interface HostEndpoint {
  applyEdit(newLF: string, receivedVersion: number): void;
}

class Host {
  version = 1;
  text = '';
  webviewText = '';
  lastReceivedVersion = 0;
  lastAckVersion = 0;
  ledger = new Map<number, ExpectedWorkspaceEditChange>();
  saveActive = false;
  pendingEdit: { text: string; version: number } | undefined;
  webview!: Webview;
  /** True if any host update ever pushed a setText into the Webview. */
  sentWebviewUpdate = false;

  constructor(
    private readonly combo: Combo,
    private readonly debounceEdits = false,
  ) {}

  private fireDidChange() {
    const eventDocumentVersion = this.version;
    const documentText = toLF(this.text);
    const selfVersion = consumeExpectedWorkspaceEditChange({
      ledger: this.ledger,
      documentVersion: eventDocumentVersion,
      documentText,
    });
    if (selfVersion !== undefined) {
      this.ledger.delete(selfVersion);
      this.webviewText = documentText;
      return;
    }

    const syncPlan = planDocumentChangeSync({
      hasPendingEdit: this.pendingEdit !== undefined,
      isDuringOwnSave: this.saveActive,
      webviewText: this.webviewText,
      documentText,
    });
    if (syncPlan.flushPendingEdit && this.pendingEdit) this.flushPendingEdit();
    const syncDocumentText =
      syncPlan.snapshotSource === 'document-after-flush' ? toLF(this.text) : documentText;
    const { resync, preserveHistory } = classifyDocumentChange({
      isFromWebview: false,
      webviewText: this.webviewText,
      documentText: syncDocumentText,
      isSaveNormalization: syncPlan.isSaveNormalization,
    });
    if (!resync) return;
    // The fix under test: a final-newline-only save normalization reconciles
    // host bookkeeping without pushing an update into CodeMirror.
    if (preserveHistory && isTrailingNewlineOnlyDifference(this.webviewText, syncDocumentText)) {
      return;
    }
    this.webviewText = syncDocumentText;
    this.sentWebviewUpdate = true;
    this.webview.onUpdate(syncDocumentText, this.lastAckVersion, false, preserveHistory);
  }

  applyEdit(newLF: string, receivedVersion: number) {
    if (this.debounceEdits) {
      this.pendingEdit = { text: newLF, version: receivedVersion };
      return;
    }
    this.applyEditNow(newLF, receivedVersion);
  }

  private applyEditNow(newLF: string, receivedVersion: number) {
    if (!acceptsWebviewEditVersion({ lastReceivedVersion: this.lastReceivedVersion, receivedVersion })) return;
    const version = receivedVersion;
    this.lastReceivedVersion = version;
    const current = this.text;
    const target = fromLFPreserving(newLF, current, this.combo.eol);
    this.webviewText = newLF;
    const diff = diffRange(current, target);
    if (!diff) {
      this.lastAckVersion = appliedEditVersion({ previousVersion: this.lastAckVersion, receivedVersion: version, completed: true });
      this.webview.onAck(version);
      return;
    }
    this.ledger.set(version, { editVersion: version, documentVersion: this.version + 1, text: toLF(target) });
    this.text = target;
    this.version += 1;
    this.fireDidChange();
    this.lastAckVersion = appliedEditVersion({ previousVersion: this.lastAckVersion, receivedVersion: version, completed: true });
    this.webview.onAck(version);
  }

  flushPendingEdit() {
    const pending = this.pendingEdit;
    if (pending) {
      this.pendingEdit = undefined;
      this.applyEditNow(pending.text, pending.version);
    }
    this.save();
  }

  save() {
    const wasSaveActive = this.saveActive;
    this.saveActive = true;
    let normalized = toLF(this.text);
    if (this.combo.trimTrailingWhitespace) {
      normalized = normalized.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
    }
    if (this.combo.insertFinalNewline && normalized.length > 0 && !normalized.endsWith('\n')) {
      normalized += '\n';
    }
    const normalizedEol = this.combo.eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
    if (normalizedEol !== this.text) {
      this.text = normalizedEol;
      this.version += 1;
      this.fireDidChange();
    }
    this.saveActive = wasSaveActive;
  }

  fireSaveParticipantEvent(transform: (text: string) => string) {
    const normalized = transform(toLF(this.text));
    const nextText = this.combo.eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
    if (nextText === this.text) return;
    const wasSaveActive = this.saveActive;
    this.saveActive = true;
    this.text = nextText;
    this.version += 1;
    this.fireDidChange();
    this.saveActive = wasSaveActive;
  }
}

/**
 * Promise-queued host harness for pending-edit/document-event races. Unlike the
 * legacy synchronous harness above, listener callbacks are captured now and
 * reconciled later, matching the extension host's operationQueue ordering.
 */
class QueuedHost implements HostEndpoint {
  version = 1;
  documentText = '';
  diskText = '';
  webviewText = '';
  lastReceivedVersion = 0;
  lastAckVersion = 0;
  pendingEdit: { text: string; version: number } | undefined;
  ledger = new Map<number, ExpectedWorkspaceEditChange>();
  expectedAuthoritativeChange: { documentVersion: number; text: string } | undefined;
  origins = new Map<number, { isSaveNormalization: boolean; text: string }>();
  saveActive = false;
  saveParticipant: ((text: string) => string) | undefined;
  beforeNormalizationReread: (() => void | Promise<void>) | undefined;
  updates: { text: string; preserveHistory: boolean }[] = [];
  webview!: Webview;
  private operationQueue: Promise<void> = Promise.resolve();

  applyEdit(newLF: string, receivedVersion: number): void {
    this.pendingEdit = { text: newLF, version: receivedVersion };
  }

  requestFlush(): void {
    this.enqueue(async () => this.flushPendingEdit());
  }

  emitExternal(text: string): void {
    this.documentText = text;
    this.diskText = text;
    this.version += 1;
    this.fireDidChange();
  }

  emitSaveNormalization(transform: (text: string) => string): void {
    const next = transform(this.documentText);
    if (next === this.documentText) return;
    const wasSaveActive = this.saveActive;
    this.saveActive = true;
    this.documentText = next;
    this.diskText = next;
    this.version += 1;
    this.fireDidChange();
    this.saveActive = wasSaveActive;
  }

  async drain(): Promise<void> {
    for (;;) {
      const queued = this.operationQueue;
      await queued;
      if (queued === this.operationQueue) return;
    }
  }

  private enqueue(operation: () => void | Promise<void>): void {
    this.operationQueue = this.operationQueue.then(async () => {
      await operation();
    });
  }

  private applyPendingEdit(): void {
    const pending = this.pendingEdit;
    if (!pending) return;
    this.pendingEdit = undefined;
    if (
      !acceptsWebviewEditVersion({
        lastReceivedVersion: this.lastReceivedVersion,
        receivedVersion: pending.version,
      })
    ) {
      return;
    }
    this.lastReceivedVersion = pending.version;
    this.webviewText = pending.text;
    if (this.documentText === pending.text) {
      this.lastAckVersion = pending.version;
      this.webview.onAck(pending.version);
      return;
    }
    this.ledger.set(pending.version, {
      editVersion: pending.version,
      documentVersion: this.version + 1,
      text: pending.text,
    });
    this.documentText = pending.text;
    this.version += 1;
    this.fireDidChange();
    this.lastAckVersion = pending.version;
    this.webview.onAck(pending.version);
  }

  private async flushPendingEdit(): Promise<void> {
    this.applyPendingEdit();
    await this.save();
  }

  private async save(): Promise<void> {
    const wasSaveActive = this.saveActive;
    this.saveActive = true;
    const normalized = this.saveParticipant?.(this.documentText) ?? this.documentText;
    if (normalized !== this.documentText) {
      this.documentText = normalized;
      this.version += 1;
      this.fireDidChange();
    }
    await Promise.resolve();
    this.diskText = this.documentText;
    this.saveActive = wasSaveActive;
  }

  private async restoreAuthoritativeSnapshot(target: string): Promise<string> {
    if (this.documentText === target) return target;
    this.expectedAuthoritativeChange = {
      documentVersion: this.version + 1,
      text: target,
    };
    this.documentText = target;
    this.version += 1;
    this.fireDidChange();
    await this.save();
    return this.documentText;
  }

  private fireDidChange(): void {
    const eventDocumentVersion = this.version;
    const documentText = this.documentText;
    const expectedAuthoritativeChange = this.expectedAuthoritativeChange;
    if (
      expectedAuthoritativeChange?.documentVersion === eventDocumentVersion &&
      expectedAuthoritativeChange.text === documentText
    ) {
      this.expectedAuthoritativeChange = undefined;
      return;
    }
    const selfVersion = consumeExpectedWorkspaceEditChange({
      ledger: this.ledger,
      documentVersion: eventDocumentVersion,
      documentText,
    });
    if (selfVersion !== undefined) {
      this.ledger.delete(selfVersion);
      this.webviewText = documentText;
      return;
    }

    const syncPlan = planDocumentChangeSync({
      hasPendingEdit: this.pendingEdit !== undefined,
      isDuringOwnSave: this.saveActive,
      webviewText: this.webviewText,
      documentText,
    });
    this.origins.set(eventDocumentVersion, {
      isSaveNormalization: syncPlan.isSaveNormalization,
      text: documentText,
    });
    this.enqueue(async () => {
      try {
        if (syncPlan.flushPendingEdit && this.pendingEdit) await this.flushPendingEdit();

        let syncDocumentText = documentText;
        let syncIsSaveNormalization = syncPlan.isSaveNormalization;
        if (syncPlan.snapshotSource === 'document-after-flush') {
          await Promise.resolve();
          const hook = this.beforeNormalizationReread;
          this.beforeNormalizationReread = undefined;
          if (hook) await hook();

          const currentVersion = this.version;
          syncDocumentText = this.documentText;
          const currentOrigin = this.origins.get(currentVersion);
          if (currentVersion !== eventDocumentVersion && currentOrigin?.text === syncDocumentText) {
            if (!currentOrigin.isSaveNormalization) return;
            syncIsSaveNormalization = true;
          } else if (currentVersion !== eventDocumentVersion) {
            syncIsSaveNormalization = isSaveParticipantNormalization(
              this.webviewText,
              syncDocumentText,
            );
          }
        }

        const { resync, preserveHistory } = classifyDocumentChange({
          isFromWebview: false,
          webviewText: this.webviewText,
          documentText: syncDocumentText,
          isSaveNormalization: syncIsSaveNormalization,
        });
        if (!resync) return;
        if (preserveHistory && isTrailingNewlineOnlyDifference(this.webviewText, syncDocumentText)) {
          return;
        }
        if (!preserveHistory) {
          syncDocumentText = await this.restoreAuthoritativeSnapshot(syncDocumentText);
        }
        this.webviewText = syncDocumentText;
        this.updates.push({ text: syncDocumentText, preserveHistory });
        this.webview.onUpdate(syncDocumentText, this.lastAckVersion, false, preserveHistory);
      } finally {
        this.origins.delete(eventDocumentVersion);
      }
    });
  }
}

class Webview {
  state = EditorState.create({ doc: '', extensions: [history()] });
  editVersion = 0;
  ackVersion = 0;
  applyingRemote = false;
  pendingRemote: { text: string; baseVersion: number; rollback: boolean; preserveHistory: boolean } | undefined;
  host!: HostEndpoint;

  private postEdit(text: string) {
    this.editVersion++;
    this.host.applyEdit(text, this.editVersion);
  }

  localEdit(spec: TransactionSpec) {
    const before = this.state.doc.toString();
    this.state = this.state.update(spec).state;
    if (!this.applyingRemote && this.state.doc.toString() !== before) this.postEdit(this.state.doc.toString());
  }

  undo() {
    const before = this.state.doc.toString();
    undo({ state: this.state, dispatch: (tr) => { this.state = tr.state; } });
    if (this.state.doc.toString() !== before) this.postEdit(this.state.doc.toString());
  }

  onAck(version: number) {
    if (Number.isSafeInteger(version) && version > this.ackVersion && version <= this.editVersion) this.ackVersion = version;
    this.applyPendingRemote();
  }

  onUpdate(text: string, baseVersion: number, rollback: boolean, preserveHistory: boolean) {
    if (!shouldApplyRemoteUpdate({ baseVersion, editVersion: this.editVersion, ackVersion: this.ackVersion, composing: false, pendingLocalChange: false, rollback })) {
      this.pendingRemote = { text, baseVersion, rollback, preserveHistory };
      return;
    }
    if (text !== this.state.doc.toString()) this.setText(text, rollback, preserveHistory);
  }

  applyPendingRemote() {
    if (this.applyingRemote || this.pendingRemote === undefined) return;
    const remote = this.pendingRemote;
    this.pendingRemote = undefined;
    if (shouldApplyRemoteUpdate({ baseVersion: remote.baseVersion, editVersion: this.editVersion, ackVersion: this.ackVersion, composing: false, pendingLocalChange: false, rollback: remote.rollback })) {
      if (remote.text !== this.state.doc.toString()) this.setText(remote.text, remote.rollback, remote.preserveHistory);
      else if (remote.rollback) this.ackVersion = this.editVersion;
    } else {
      this.pendingRemote = remote;
    }
  }

  setText(text: string, rollback = false, preserveHistory = false) {
    const doc = this.state.doc.toString();
    if (doc === text) return;
    const sel = this.state.selection.main;
    const patch = computeRemotePatch(doc, text, { anchor: sel.anchor, head: sel.head });
    this.applyingRemote = true;
    try {
      if (preserveHistory) {
        this.state = this.state.update({
          changes: { from: patch.from, to: patch.to, insert: patch.insert },
          selection: { anchor: patch.anchor, head: patch.head },
          annotations: Transaction.addToHistory.of(false),
        }).state;
      } else {
        this.state = EditorState.create({ doc: text, selection: { anchor: patch.anchor, head: patch.head }, extensions: [history()] });
      }
      if (rollback) this.ackVersion = this.editVersion;
    } finally {
      this.applyingRemote = false;
    }
  }
}

/** Type three "あいうえお" lines, optionally save, then undo seven times. */
function run(combo: Combo, saveBeforeEveryUndo: boolean): { states: string[]; sentWebviewUpdate: boolean } {
  const host = new Host(combo);
  const wv = new Webview();
  host.webview = wv;
  wv.host = host;

  const composeLine = (withNewline: boolean) =>
    wv.localEdit({
      changes: { from: wv.state.doc.length, insert: 'あいうえお' + (withNewline ? '\n' : '') },
      annotations: isolateHistory.of('full'),
    });
  composeLine(true);
  composeLine(true);
  composeLine(combo.trailingNewlineInput);

  if (combo.saveDuringUndo && !saveBeforeEveryUndo) host.save();

  const states = [wv.state.doc.toString()];
  for (let i = 0; i < 7; i++) {
    if (combo.saveDuringUndo && saveBeforeEveryUndo) host.save();
    wv.undo();
    states.push(wv.state.doc.toString());
  }
  return { states, sentWebviewUpdate: host.sentWebviewUpdate };
}

const BOOLS = [false, true];
const EOLS: Eol[] = ['\n', '\r\n'];

function contentLineCount(text: string): number {
  // Count lines of actual content, ignoring a single trailing final newline.
  const trimmed = text.replace(/\n$/, '');
  if (trimmed === '') return 0;
  return trimmed.split('\n').length;
}

describe('Live Preview undo round trip (R-04-01/R-04-02/R-04-03/R-03-04)', () => {
  it('reproduced trigger: insertFinalNewline + input without trailing newline + save is now monotonic', () => {
    // This exact combo produced blank-line insertion and a non-monotonic
    // "undo returns to 3 lines" before the fix.
    const combo: Combo = {
      insertFinalNewline: true,
      trimTrailingWhitespace: false,
      saveDuringUndo: true,
      trailingNewlineInput: false,
      eol: '\n',
    };
    const { states } = run(combo, /* saveBeforeEveryUndo */ true);
    // No blank line anywhere (no leading newline, no doubled internal newline).
    for (const s of states) expect(/^\n|\n\n/.test(s)).toBe(false);
    // Content line counts decrease monotonically down to zero.
    const counts = states.map(contentLineCount);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[0]).toBe(3);
    expect(counts[counts.length - 1]).toBe(0);
  });

  it('a final-newline-only save normalization is never pushed into CodeMirror', () => {
    const combo: Combo = {
      insertFinalNewline: true,
      trimTrailingWhitespace: true,
      saveDuringUndo: true,
      trailingNewlineInput: false,
      eol: '\n',
    };
    const { sentWebviewUpdate } = run(combo, true);
    expect(sentWebviewUpdate).toBe(false);
  });

  it('pending English input is not rolled back by an intervening save-normalization event', () => {
    const scenarios = [
      {
        name: 'insert final newline',
        initial: 'a',
        normalize: (text: string) => (text.endsWith('\n') ? text : `${text}\n`),
      },
      {
        name: 'trim trailing whitespace',
        initial: 'a  ',
        normalize: (text: string) => text.replace(/[ \t]+(?=\n|$)/g, ''),
      },
      {
        name: 'format on save',
        initial: 'a',
        normalize: (text: string) => text.toUpperCase(),
      },
    ];

    for (const scenario of scenarios) {
      const combo: Combo = {
        insertFinalNewline: false,
        trimTrailingWhitespace: false,
        saveDuringUndo: false,
        trailingNewlineInput: false,
        eol: '\n',
      };
      const host = new Host(combo, true);
      const wv = new Webview();
      host.webview = wv;
      wv.host = host;

      const append = (text: string) => {
        const from = wv.state.doc.length;
        wv.localEdit({
          changes: { from, insert: text },
          selection: { anchor: from + text.length },
          annotations: isolateHistory.of('full'),
        });
      };

      append(scenario.initial);
      host.flushPendingEdit(); // Confirm `a` before the next debounce batch.
      append('\nb');
      append('\nc');

      const latestText = wv.state.doc.toString();
      const caretBeforeNormalization = wv.state.selection.main.head;
      host.fireSaveParticipantEvent(scenario.normalize);

      expect(wv.state.doc.toString(), scenario.name).toBe(latestText);
      expect(wv.state.doc.toString(), scenario.name).toContain('\nb\nc');
      expect(wv.state.selection.main.head, scenario.name).toBeGreaterThanOrEqual(caretBeforeNormalization);
      expect(host.sentWebviewUpdate, scenario.name).toBe(false);

      const counts = [contentLineCount(wv.state.doc.toString())];
      for (let i = 0; i < 3; i++) {
        wv.undo();
        host.flushPendingEdit();
        counts.push(contentLineCount(wv.state.doc.toString()));
      }
      expect(counts, scenario.name).toEqual([3, 2, 1, 0]);
    }
  });

  it('restores a true external snapshot to document, disk, binding, and Webview after pending flush', async () => {
    const host = new QueuedHost();
    const wv = new Webview();
    host.webview = wv;
    wv.host = host;

    wv.localEdit({ changes: { from: 0, insert: 'a' }, selection: { anchor: 1 } });
    host.requestFlush();
    await host.drain();

    wv.localEdit({ changes: { from: 1, insert: 'b' }, selection: { anchor: 2 } });
    host.emitExternal('X');
    await host.drain();

    expect(host.documentText).toBe('X');
    expect(host.diskText).toBe('X');
    expect(host.webviewText).toBe('X');
    expect(wv.state.doc.toString()).toBe('X');
    expect(host.updates).toEqual([{ text: 'X', preserveHistory: false }]);
  });

  it('defers to a later authoritative external event that lands during normalization re-read', async () => {
    const host = new QueuedHost();
    const wv = new Webview();
    host.webview = wv;
    wv.host = host;

    wv.localEdit({ changes: { from: 0, insert: 'a' }, selection: { anchor: 1 } });
    host.requestFlush();
    await host.drain();
    wv.localEdit({ changes: { from: 1, insert: 'b' }, selection: { anchor: 2 } });

    host.beforeNormalizationReread = () => host.emitExternal('X');
    host.emitSaveNormalization((text) => `${text}\n`);
    await host.drain();

    expect(host.documentText).toBe('X');
    expect(host.diskText).toBe('X');
    expect(host.webviewText).toBe('X');
    expect(wv.state.doc.toString()).toBe('X');
    expect(host.updates).toEqual([{ text: 'X', preserveHistory: false }]);
  });

  it('uses the latest post-flush format result without stale rollback and preserves caret and undo', async () => {
    const host = new QueuedHost();
    const wv = new Webview();
    host.webview = wv;
    wv.host = host;
    const baseline = 'prefix  ';
    host.documentText = baseline;
    host.diskText = baseline;
    host.webviewText = baseline;
    wv.state = EditorState.create({
      doc: baseline,
      selection: { anchor: baseline.length },
      extensions: [history()],
    });

    const append = (text: string) => {
      const from = wv.state.doc.length;
      wv.localEdit({
        changes: { from, insert: text },
        selection: { anchor: from + text.length },
        annotations: isolateHistory.of('full'),
      });
    };

    append('\na');
    host.requestFlush();
    await host.drain();

    host.saveParticipant = (text) => text.replace(/[ \t]+(?=\n|$)/g, '');
    append('\nb');
    append('\nc');
    const caretBeforeNormalization = wv.state.selection.main.head;

    // This stale event starts the queued flush. The flush's own save then
    // formats the latest a/b/c snapshot before the original callback re-reads.
    host.emitSaveNormalization((text) => (text.endsWith('\n') ? text : `${text}\n`));
    await host.drain();

    expect(wv.state.doc.toString()).toBe('prefix\na\nb\nc');
    expect(wv.state.selection.main.head).toBe(wv.state.doc.length);
    expect(wv.state.selection.main.head).toBeGreaterThanOrEqual(caretBeforeNormalization - 2);
    expect(host.documentText).toBe('prefix\na\nb\nc');
    expect(host.diskText).toBe('prefix\na\nb\nc');
    expect(host.updates).toEqual([{ text: 'prefix\na\nb\nc', preserveHistory: true }]);

    const typedLineCount = (text: string) => Math.max(0, text.split('\n').length - 1);
    const counts = [typedLineCount(wv.state.doc.toString())];
    for (let i = 0; i < 3; i++) {
      wv.undo();
      host.requestFlush();
      await host.drain();
      counts.push(typedLineCount(wv.state.doc.toString()));
    }
    expect(counts).toEqual([3, 2, 1, 0]);
    expect(host.documentText).toBe('prefix');
    expect(host.diskText).toBe('prefix');
  });

  it('undo stays clean and monotonic across every save/EOL/trailing-newline combination', () => {
    for (const insertFinalNewline of BOOLS)
      for (const trimTrailingWhitespace of BOOLS)
        for (const saveDuringUndo of BOOLS)
          for (const trailingNewlineInput of BOOLS)
            for (const eol of EOLS)
              for (const saveBeforeEveryUndo of BOOLS) {
                const combo: Combo = {
                  insertFinalNewline,
                  trimTrailingWhitespace,
                  saveDuringUndo,
                  trailingNewlineInput,
                  eol,
                };
                const { states } = run(combo, saveBeforeEveryUndo);
                const label = JSON.stringify({ ...combo, saveBeforeEveryUndo });
                for (const s of states) {
                  expect(/^\n|\n\n/.test(s), `blank line inserted for ${label}: ${JSON.stringify(states)}`).toBe(false);
                }
                const counts = states.map(contentLineCount);
                for (let i = 1; i < counts.length; i++) {
                  expect(
                    counts[i] <= counts[i - 1],
                    `non-monotonic undo for ${label}: counts=${JSON.stringify(counts)} states=${JSON.stringify(states)}`,
                  ).toBe(true);
                }
                expect(counts[counts.length - 1], `did not fully undo for ${label}`).toBe(0);
              }
  });
});
