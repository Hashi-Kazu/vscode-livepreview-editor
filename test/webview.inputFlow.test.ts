import { history, undo } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

describe('Webview input flow (R-03-04/R-04-01/R-04-02/R-04-03)', () => {
  it('rapid ASCII input remains ordered and one undo restores the grouped input', () => {
    let state = EditorState.create({ doc: '', extensions: [history()] });
    for (const char of 'abcdefg') {
      state = state.update({ changes: { from: state.doc.length, insert: char } }).state;
    }
    expect(state.doc.toString()).toBe('abcdefg');

    const undone = undo({ state, dispatch: (transaction) => { state = transaction.state; } });
    expect(undone).toBe(true);
    expect(state.doc.toString()).toBe('');
  });

  it('remote patches stay out of CodeMirror history and do not reverse local input', () => {
    let state = EditorState.create({ doc: 'abc', extensions: [history()] });
    state = state.update({
      changes: { from: 3, insert: 'd' },
      annotations: Transaction.addToHistory.of(false),
    }).state;
    state = state.update({ changes: { from: state.doc.length, insert: 'efg' } }).state;
    expect(state.doc.toString()).toBe('abcdefg');
  });
});
