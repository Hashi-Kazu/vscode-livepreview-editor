import { history, isolateHistory, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { fromLFPreserving, shouldApplyRemoteUpdate } from '../src/core/sync';

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
});
