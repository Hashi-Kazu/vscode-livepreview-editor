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

class Host {
  version = 1;
  text = '';
  webviewText = '';
  lastReceivedVersion = 0;
  lastAckVersion = 0;
  ledger = new Map<number, ExpectedWorkspaceEditChange>();
  saveActive = false;
  webview!: Webview;
  /** True if any host update ever pushed a setText into the Webview. */
  sentWebviewUpdate = false;

  constructor(private readonly combo: Combo) {}

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
    const { resync, preserveHistory } = classifyDocumentChange({
      isFromWebview: false,
      webviewText: this.webviewText,
      documentText,
      isDuringOwnSave: this.saveActive,
      isSaveNormalization: isSaveParticipantNormalization(this.webviewText, documentText),
    });
    if (!resync) return;
    // The fix under test: a final-newline-only save normalization reconciles
    // host bookkeeping without pushing an update into CodeMirror.
    if (preserveHistory && isTrailingNewlineOnlyDifference(this.webviewText, documentText)) {
      return;
    }
    this.webviewText = documentText;
    this.sentWebviewUpdate = true;
    this.webview.onUpdate(documentText, this.lastAckVersion, false, preserveHistory);
  }

  applyEdit(newLF: string, receivedVersion: number) {
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

  save() {
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
    this.saveActive = false;
  }
}

class Webview {
  state = EditorState.create({ doc: '', extensions: [history()] });
  editVersion = 0;
  ackVersion = 0;
  applyingRemote = false;
  pendingRemote: { text: string; baseVersion: number; rollback: boolean; preserveHistory: boolean } | undefined;
  host!: Host;

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
