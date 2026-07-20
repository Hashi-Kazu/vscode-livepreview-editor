import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  continueList,
  changeIndent,
  toggleHeading,
  shouldOpenLinkOnMouseDown,
  computeListEnterEdit,
} from '../src/core/editing';

// R-26-02: リンクのマウスボタン別操作
describe('R-26-02 shouldOpenLinkOnMouseDown', () => {
  it('左クリックだけリンク遷移を実行する', () => {
    expect(shouldOpenLinkOnMouseDown(0)).toBe(true);
  });

  it('右クリックはリンク遷移せずコンテキストメニューへ委ねる', () => {
    expect(shouldOpenLinkOnMouseDown(2)).toBe(false);
  });

  it('中クリックも独自リンク遷移を実行しない', () => {
    expect(shouldOpenLinkOnMouseDown(1)).toBe(false);
  });
});

// R-23: リスト継続入力
describe('R-23 continueList', () => {
  it('R-23-01: 箇条書きを次のビュレットで継続する', () => {
    const c = continueList('- item');
    expect(c.isList).toBe(true);
    expect(c.insert).toBe('- ');
    expect(c.removeMarker).toBe(false);
  });

  it('R-23-02: 順序リストは番号をインクリメントする', () => {
    expect(continueList('3. third').insert).toBe('4. ');
    expect(continueList('  2) x').insert).toBe('  3) ');
  });

  it('R-23-03: タスクは未完了チェックボックスで継続する', () => {
    expect(continueList('- [x] done').insert).toBe('- [ ] ');
  });

  it('R-23-04: インデントを維持する', () => {
    expect(continueList('    - nested').insert).toBe('    - ');
  });

  it('R-23-04: 4階層目以降(indent 6/8)でも箇条書きの継続を維持する（回帰: Issue #31）', () => {
    expect(continueList('      - d').insert).toBe('      - ');
    expect(continueList('        - e').insert).toBe('        - ');
  });

  it('R-23-02: 4階層目以降(indent 6/8)でも番号付きリストの継続を維持する（回帰: Issue #31）', () => {
    expect(continueList('      1. d').insert).toBe('      2. ');
    expect(continueList('        3) e').insert).toBe('        4) ');
  });

  it('R-23-03: 4階層目以降(indent 6)でもタスクの継続を維持する（回帰: Issue #31）', () => {
    expect(continueList('      - [ ] d').insert).toBe('      - [ ] ');
    expect(continueList('      - [x] d').insert).toBe('      - [ ] ');
  });

  it('R-23-05: 空項目では removeMarker=true（リスト終了）', () => {
    const c = continueList('- ');
    expect(c.removeMarker).toBe(true);
    expect(c.markerLength).toBe(2);
    const t = continueList('  - [ ] ');
    expect(t.removeMarker).toBe(true);
    expect(t.markerLength).toBe('  - [ ] '.length);
  });

  it('リスト行でなければ isList=false', () => {
    expect(continueList('plain text').isList).toBe(false);
    expect(continueList('# heading').isList).toBe(false);
  });
});

// R-23-01/02/04: Webview の Enter キーマップ(handleEnter)エンドツーエンド回帰。
// main.ts の handleEnter は DOM 依存(acquireVsCodeApi)なので import できない。
// そこで純粋部 computeListEnterEdit を EditorState + モック dispatch で駆動し、
// handleEnter と同じ「選択→lineAt→編集適用」の経路を再現して検証する。
describe('R-23 handleEnter エンドツーエンド(EditorState 経由)', () => {
  /** handleEnter(main.ts) と同一ロジックを EditorState 上で再現する。 */
  const runEnter = (state: EditorState) => {
    const { from, to } = state.selection.main;
    const line = state.doc.lineAt(from);
    const edit = computeListEnterEdit(line.text, line.from, from, to);
    if (!edit) return { handled: false, state };
    const next = state.update({ changes: edit.changes, selection: edit.selection }).state;
    return { handled: true, state: next };
  };

  it('4階層目の番号付きリストで Enter を押すと同一階層・番号+1(      2. )が挿入される', () => {
    const doc = ['1. a', '  1. b', '    1. c', '      1. d'].join('\n');
    let state = EditorState.create({ doc, selection: { anchor: doc.length } });
    const result = runEnter(state);
    expect(result.handled).toBe(true);
    state = result.state;
    const lines = state.doc.toString().split('\n');
    // 新規行が4階層目(indent 6)で番号 2 の項目として挿入される。
    expect(lines[4]).toBe('      2. ');
    // キャレットは挿入した継続マーカーの直後。
    expect(state.selection.main.anchor).toBe(doc.length + '\n      2. '.length);
  });

  it('4階層目の空項目で Enter を押すとマーカーが除去されリストを抜ける', () => {
    const doc = ['      1. '].join('\n');
    let state = EditorState.create({ doc, selection: { anchor: doc.length } });
    const result = runEnter(state);
    expect(result.handled).toBe(true);
    expect(result.state.doc.toString()).toBe('');
  });

  it('リスト外の行では handleEnter は処理せず既定 Enter に委ねる', () => {
    const doc = 'plain paragraph';
    const state = EditorState.create({ doc, selection: { anchor: doc.length } });
    expect(runEnter(state).handled).toBe(false);
  });
});

// R-24: インデント
describe('R-24 changeIndent', () => {
  it('R-24-01: インデントは2スペース追加', () => {
    expect(changeIndent('- a', 1)).toEqual({ text: '  - a', shift: 2 });
  });
  it('R-24-02: アウトデントは先頭スペースを最大2つ除去', () => {
    expect(changeIndent('    - a', -1)).toEqual({ text: '  - a', shift: -2 });
    expect(changeIndent('- a', -1)).toEqual({ text: '- a', shift: 0 });
  });
  it('タブのアウトデントは1文字除去', () => {
    expect(changeIndent('\t- a', -1)).toEqual({ text: '- a', shift: -1 });
  });
});

// R-25: 見出しトグル
describe('R-25 toggleHeading', () => {
  it('R-25-01: 段落を見出しにする', () => {
    expect(toggleHeading('Title', 2)).toBe('## Title');
  });
  it('R-25-02: 同レベルの見出しは段落に戻す', () => {
    expect(toggleHeading('## Title', 2)).toBe('Title');
  });
  it('R-25-03: 別レベルへ変更する', () => {
    expect(toggleHeading('## Title', 4)).toBe('#### Title');
  });
  it('レベルは1〜6にクランプ', () => {
    expect(toggleHeading('x', 9)).toBe('###### x');
  });
});
