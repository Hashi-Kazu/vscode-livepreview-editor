import { history, isolateHistory, undo } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { computeRemotePatch, fromLFPreserving, shouldApplyRemoteUpdate } from '../src/core/sync';

describe('Webview input flow (R-03-08/R-04-01/R-04-02/R-04-03)', () => {
  it('3-line IME input is undone by CodeMirror alone and matches the host at every step', () => {
    let state = EditorState.create({ doc: '', extensions: [history()] });
    let hostText = '';
    let editVersion = 0;
    let ackVersion = 0;

    const syncToHost = () => {
      const webviewText = state.doc.toString();
      editVersion++;
      // Minimal WorkspaceEdit application is represented by the EOL-preserving
      // pure conversion used by the host. An ack follows only once it matches.
      hostText = fromLFPreserving(webviewText, hostText, '\n');
      ackVersion = editVersion;
      expect(hostText).toBe(webviewText);
    };
    const composeLine = () => {
      state = state.update({
        changes: { from: state.doc.length, insert: 'あいうえお\n' },
        annotations: isolateHistory.of('full'),
      }).state;
      syncToHost();
    };

    composeLine();
    composeLine();
    composeLine();
    expect(state.doc.toString()).toBe('あいうえお\nあいうえお\nあいうえお\n');
    expect(shouldApplyRemoteUpdate({ baseVersion: 2, editVersion, ackVersion, composing: false })).toBe(false);

    for (const expected of ['あいうえお\nあいうえお\n', 'あいうえお\n', '']) {
      expect(undo({ state, dispatch: (transaction) => { state = transaction.state; } })).toBe(true);
      syncToHost();
      expect(state.doc.toString()).toBe(expected);
      expect(hostText).toBe(expected);
    }
  });

  it('preserveHistory update keeps the just-typed edit undoable (R-04-01)', () => {
    let state = EditorState.create({ doc: '', extensions: [history()] });

    // The user types a line that ends with a trailing space.
    state = state.update({
      changes: { from: 0, insert: 'hello \n' },
      selection: { anchor: 7 },
      annotations: isolateHistory.of('full'),
    }).state;
    expect(state.doc.toString()).toBe('hello \n');

    // A debounced self-save trims the trailing whitespace. The host echoes it
    // back as a history-preserving update, mirroring setText(preserveHistory):
    // apply the minimal patch out of history under the applyingRemote guard.
    const doc = state.doc.toString();
    const normalized = 'hello\n';
    const sel = state.selection.main;
    const patch = computeRemotePatch(doc, normalized, { anchor: sel.anchor, head: sel.head });
    state = state.update({
      changes: { from: patch.from, to: patch.to, insert: patch.insert },
      selection: { anchor: patch.anchor, head: patch.head },
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(state.doc.toString()).toBe('hello\n');

    // Undo must revert the user's own typing — not the save normalization,
    // which was deliberately kept off the history stack.
    expect(undo({ state, dispatch: (transaction) => { state = transaction.state; } })).toBe(true);
    expect(state.doc.toString()).toBe('');
  });
});
