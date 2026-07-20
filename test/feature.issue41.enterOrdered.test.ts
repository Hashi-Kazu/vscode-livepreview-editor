import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { computeListEnterEdit } from '../src/core/editing';

// R-23 / R-23-02 (Issue #41): 番号付きリストの4階層目(indent 6)末尾で Enter を
// 押すと「同一階層に番号+1の項目が追加されない」という不具合の回帰テスト。
//
// Issue #41 の再現は 4階層目で失敗し 5階層目(indent 8)では成功する、という症状。
// 継続を決める純粋部 computeListEnterEdit は indent 6/8 のいずれでも正しい継続を
// 返すことが検証済みなので、本テストは Webview の Enter キーマップ(handleEnter)と
// 同じ「選択→lineAt→computeListEnterEdit→dispatch」経路を、実 Webview と同一の
// markdown() パーサを載せた EditorState 上で再現し、4・5階層目の両方で同一階層に
// 番号+1の項目が挿入されることを固定する（パーサの存在が Enter の doc/selection
// ベース編集へ影響しないことも併せて確認する）。
describe('R-23-02 番号付きリスト深階層 Enter エンドツーエンド(markdown()パーサ込み)', () => {
  /** makeState(main.ts) と同じ拡張(markdown パーサ)を載せた EditorState。 */
  const makeState = (doc: string, anchor: number) =>
    EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown()],
    });

  /** handleEnter(main.ts) と同一ロジックを EditorState 上で再現する。 */
  const runEnter = (state: EditorState) => {
    const { from, to } = state.selection.main;
    const line = state.doc.lineAt(from);
    const edit = computeListEnterEdit(line.text, line.from, from, to);
    if (!edit) return { handled: false, state };
    const next = state.update({ changes: edit.changes, selection: edit.selection }).state;
    return { handled: true, state: next };
  };

  it('4階層目(indent 6)末尾の Enter で同一階層・番号+1(      2. )が挿入される', () => {
    const doc = ['1. a', '  1. b', '    1. c', '      1. d'].join('\n');
    const result = runEnter(makeState(doc, doc.length));
    expect(result.handled).toBe(true);
    const lines = result.state.doc.toString().split('\n');
    expect(lines[4]).toBe('      2. ');
    expect(result.state.selection.main.anchor).toBe(doc.length + '\n      2. '.length);
  });

  it('5階層目(indent 8)末尾の Enter で同一階層・番号+1(        2. )が挿入される', () => {
    const doc = ['1. a', '  1. b', '    1. c', '      1. d', '        1. e'].join('\n');
    const result = runEnter(makeState(doc, doc.length));
    expect(result.handled).toBe(true);
    const lines = result.state.doc.toString().split('\n');
    expect(lines[5]).toBe('        2. ');
    expect(result.state.selection.main.anchor).toBe(doc.length + '\n        2. '.length);
  });

  it('4階層目で `)` 区切りでも同一階層・番号+1(      2) )が挿入される', () => {
    const doc = ['1) a', '  1) b', '    1) c', '      1) d'].join('\n');
    const result = runEnter(makeState(doc, doc.length));
    expect(result.handled).toBe(true);
    const lines = result.state.doc.toString().split('\n');
    expect(lines[4]).toBe('      2) ');
  });

  it('4階層目の空項目末尾 Enter はマーカーを除去してリストを抜ける', () => {
    const doc = '      1. ';
    const result = runEnter(makeState(doc, doc.length));
    expect(result.handled).toBe(true);
    expect(result.state.doc.toString()).toBe('');
    expect(result.state.selection.main.anchor).toBe(0);
  });
});
