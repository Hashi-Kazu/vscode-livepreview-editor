import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  continueList,
  changeIndent,
  changeListIndent,
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

// R-24-03/04: リストマーカー幅に沿ったインデント（Issue #53）
describe('R-24-03/04 changeListIndent', () => {
  it('リスト行でなければ null を返す', () => {
    expect(changeListIndent('plain text', 1, [])).toBeNull();
  });

  it('直前の項目が無ければインデントしない', () => {
    expect(changeListIndent('- item', 1, [])).toEqual({ text: '- item', shift: 0 });
  });

  it('箇条書き(-/*/+)は直前項目の本文開始位置(2スペース)に揃える', () => {
    expect(changeListIndent('- child', 1, ['- item1', '- item2'])).toEqual({ text: '  - child', shift: 2 });
    expect(changeListIndent('* child', 1, ['* item1', '* item2'])).toEqual({ text: '  * child', shift: 2 });
    expect(changeListIndent('+ child', 1, ['+ item1', '+ item2'])).toEqual({ text: '  + child', shift: 2 });
  });

  it('番号付きリスト "1. " は3スペースに揃える', () => {
    expect(changeListIndent('1. child', 1, ['1. a', '2. b'])).toEqual({ text: '   1. child', shift: 3 });
  });

  it('番号付きリスト "10. " は4スペースに揃える（桁数が増えても本文開始位置に揃う）', () => {
    expect(changeListIndent('1. detail', 1, ['9. step', '10. step'])).toEqual({ text: '    1. detail', shift: 4 });
  });

  it('"1) " 形式も同様に3スペースに揃える', () => {
    expect(changeListIndent('1) child', 1, ['1) a', '2) b'])).toEqual({ text: '   1) child', shift: 3 });
  });

  it('Issue再現例1: 番号付きリスト3行目のTabは3階層目の内容位置に揃う', () => {
    expect(changeListIndent('1. 詳細手順', 1, ['1. 手順1', '2. 手順2'])).toEqual({
      text: '   1. 詳細手順',
      shift: 3,
    });
  });

  it('Issue再現例2: 箇条書き3行目のTabは子項目になる', () => {
    expect(changeListIndent('- 子項目', 1, ['- 項目1', '- 項目2'])).toEqual({ text: '  - 子項目', shift: 2 });
  });

  it('既にインデントされた項目も現在位置から1段だけ深くする', () => {
    expect(changeListIndent('   1. b', 1, ['1. a'])).toEqual({ text: '      1. b', shift: 3 });
  });

  it('直前項目が深い階層でも箇条書きを現在位置から1段だけ深くする', () => {
    expect(changeListIndent('- C', 1, ['- A', '  - B'])).toEqual({ text: '  - C', shift: 2 });
  });

  it('直前項目が深い階層でも番号付きリストを現在位置から1段だけ深くする', () => {
    expect(changeListIndent('1. C', 1, ['1. A', '   2. B'])).toEqual({ text: '   1. C', shift: 3 });
  });

  it('番号の桁数を1段幅として現在位置へ加算する', () => {
    expect(changeListIndent('  1. detail', 1, ['    10. step'])).toEqual({ text: '      1. detail', shift: 4 });
  });

  it('直前の非空行がリストでなければインデントしない', () => {
    expect(changeListIndent('- item', 1, ['plain text'])).toEqual({ text: '- item', shift: 0 });
  });

  it('空行を挟んでも直前のリスト項目を参照する', () => {
    expect(changeListIndent('- child', 1, ['- item', ''])).toEqual({ text: '  - child', shift: 2 });
  });

  it('Shift+Tabで1階層戻す', () => {
    expect(changeListIndent('   1. detail', -1, ['1. step1', '2. step2'])).toEqual({
      text: '1. detail',
      shift: -3,
    });
  });

  it('Shift+Tabはより浅い項目まで遡って階層を戻す', () => {
    expect(changeListIndent('      1. c', -1, ['1. a', '   1. b'])).toEqual({ text: '   1. c', shift: -3 });
  });

  it('最上位項目でのShift+Tabは変化しない', () => {
    expect(changeListIndent('- item', -1, [])).toEqual({ text: '- item', shift: 0 });
  });

  it('複数階層でTab/Shift-Tabを繰り返しても崩れない', () => {
    const step1 = changeListIndent('1. child', 1, ['1. parent']);
    expect(step1).toEqual({ text: '   1. child', shift: 3 });
    const step2 = changeListIndent(step1!.text, -1, ['1. parent']);
    expect(step2).toEqual({ text: '1. child', shift: -3 });
  });
});

// Issue #53: main.ts の indentCommand（Tab/Shift-Tab）エンドツーエンド回帰。
// indentCommand は DOM 依存(EditorView)なので import できず、R-23 handleEnter と同じ
// 方式で、EditorState + 同一ロジックの再現(runIndent)により検証する。
describe('Issue#53 indentCommand エンドツーエンド(EditorState 経由)', () => {
  const runIndent = (state: EditorState, delta: number) => {
    const doc = state.doc;
    const sel = state.selection.main;
    const startLine = doc.lineAt(sel.from).number;
    const endLine = doc.lineAt(sel.to).number;
    const allLines: string[] = [];
    for (let n = 1; n <= doc.lines; n++) allLines.push(doc.line(n).text);

    const changes: { from: number; to: number; insert: string }[] = [];
    let anyListLine = false;
    let singleShift = 0;
    for (let n = startLine; n <= endLine; n++) {
      const line = doc.line(n);
      const precedingLines = allLines.slice(0, n - 1);
      const listEdit = changeListIndent(line.text, delta, precedingLines);
      let editText = line.text;
      let editShift = 0;
      if (listEdit) {
        anyListLine = true;
        editText = listEdit.text;
        editShift = listEdit.shift;
      } else if (delta < 0) {
        const fallback = changeIndent(line.text, delta);
        editText = fallback.text;
        editShift = fallback.shift;
      }
      if (editText !== line.text) changes.push({ from: line.from, to: line.from + line.text.length, insert: editText });
      if (n === startLine) singleShift = editShift;
    }

    if (delta > 0 && !anyListLine) return { handled: false, state };
    if (changes.length === 0) return { handled: true, state };

    const spec =
      startLine === endLine
        ? { changes, selection: { anchor: Math.max(doc.line(startLine).from, sel.from + singleShift) } }
        : { changes };
    return { handled: true, state: state.update(spec).state };
  };

  it('番号付きリストの3行目でTabすると3階層目の内容位置に揃う（Issue再現例1）', () => {
    const doc = ['1. 手順1', '2. 手順2', '1. 詳細手順'].join('\n');
    const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('1. 詳細手順') } });
    const result = runIndent(state, 1);
    expect(result.handled).toBe(true);
    expect(result.state.doc.toString()).toBe(['1. 手順1', '2. 手順2', '   1. 詳細手順'].join('\n'));
  });

  it('箇条書きの3行目でTabすると子項目になる（Issue再現例2）', () => {
    const doc = ['- 項目1', '- 項目2', '- 子項目'].join('\n');
    const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('- 子項目') } });
    const result = runIndent(state, 1);
    expect(result.handled).toBe(true);
    expect(result.state.doc.toString()).toBe(['- 項目1', '- 項目2', '  - 子項目'].join('\n'));
  });

  it('Issue #61: 直前項目が深い階層でも箇条書き・番号付きリストを現在位置から1段だけインデントする', () => {
    const bulletDoc = ['- 項目A', '  - 項目B', '- 項目C'].join('\n');
    const bulletState = EditorState.create({
      doc: bulletDoc,
      selection: { anchor: bulletDoc.indexOf('- 項目C') },
    });
    const bulletResult = runIndent(bulletState, 1);
    expect(bulletResult.handled).toBe(true);
    expect(bulletResult.state.doc.toString()).toBe(['- 項目A', '  - 項目B', '  - 項目C'].join('\n'));

    const orderedDoc = ['1. 項目A', '   2. 項目B', '1. 項目C'].join('\n');
    const orderedStart = orderedDoc.indexOf('1. 項目C');
    const orderedState = EditorState.create({
      doc: orderedDoc,
      selection: { anchor: orderedStart, head: orderedStart + '1. 項目C'.length },
    });
    const orderedResult = runIndent(orderedState, 1);
    expect(orderedResult.handled).toBe(true);
    expect(orderedResult.state.doc.toString()).toBe(['1. 項目A', '   2. 項目B', '   1. 項目C'].join('\n'));
  });

  it('異なる階層の複数行を編集前スナップショットから各々1段だけインデントする', () => {
    const doc = ['- item1', '  - item2', '- item3'].join('\n');
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf('  - item2'), head: doc.length },
    });
    const result = runIndent(state, 1);
    expect(result.handled).toBe(true);
    expect(result.state.doc.toString()).toBe(['- item1', '    - item2', '  - item3'].join('\n'));
  });

  it('複数行選択の兄弟項目をまとめてTabすると同じ階層へ揃う', () => {
    const doc = ['- item1', '- item2', '- item3'].join('\n');
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf('- item2'), head: doc.length },
    });
    const result = runIndent(state, 1);
    expect(result.handled).toBe(true);
    expect(result.state.doc.toString()).toBe(['- item1', '  - item2', '  - item3'].join('\n'));
  });

  it('複数行選択でTabのあとShift-Tabすると元に戻る', () => {
    const doc = ['- item1', '  - item2', '  - item3'].join('\n');
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf('- item2'), head: doc.length },
    });
    const result = runIndent(state, -1);
    expect(result.handled).toBe(true);
    expect(result.state.doc.toString()).toBe(['- item1', '- item2', '- item3'].join('\n'));
  });

  it('リスト以外の行だけの選択ではTabを処理せず既定Tabに委ねる', () => {
    const doc = 'plain paragraph';
    const state = EditorState.create({ doc, selection: { anchor: 0 } });
    expect(runIndent(state, 1).handled).toBe(false);
  });

  it('リスト以外の行はShift-Tabで既存どおり固定幅(最大2スペース)を除去する', () => {
    const doc = '    plain text';
    const state = EditorState.create({ doc, selection: { anchor: 4 } });
    const result = runIndent(state, -1);
    expect(result.handled).toBe(true);
    expect(result.state.doc.toString()).toBe('  plain text');
  });

  it('空行・コードブロック行はリスト扱いされず変更されない', () => {
    const doc = ['- item', '', '```', 'code', '```'].join('\n');
    const state = EditorState.create({ doc, selection: { anchor: 0, head: doc.length } });
    const result = runIndent(state, 1);
    expect(result.handled).toBe(true);
    // 先頭のリスト行は直前項目が無いため変化なし。他の非リスト行も不変。
    expect(result.state.doc.toString()).toBe(doc);
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
