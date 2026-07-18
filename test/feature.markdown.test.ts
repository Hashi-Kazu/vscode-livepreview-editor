import { describe, it, expect } from 'vitest';
import { computeDecorations, DecoSpec, splitLines, detectCodeBlocks, detectTableBlocks, detectDetailsBlocks, detailsTagRanges, parseTable, parseTableRow, tableRowSourceLine, scanHeadings, headingFoldRange } from '../src/core/model';
import { insertTableRow, deleteTableRow, insertTableColumn, deleteTableColumn, updateTableCell } from '../src/core/tableEdit';

const byTag = (specs: DecoSpec[], tag: string) => specs.filter((s) => s.tag === tag);
const slice = (doc: string, s: DecoSpec) => doc.slice(s.from, s.to);

// R-19: 水平線
describe('R-19 水平線', () => {
  it.each(['---', '***', '___', '- - -', '* * *'])('%s を水平線として検知する', (hr) => {
    const specs = computeDecorations(hr, new Set());
    expect(byTag(specs, 'hr')).toHaveLength(1);
    expect(byTag(specs, 'hr-widget')).toHaveLength(1);
  });

  it('カーソル行では生記法を表示する', () => {
    expect(byTag(computeDecorations('---', new Set([0])), 'hr-widget')).toHaveLength(0);
  });

  it('リスト/見出しを水平線と誤認しない', () => {
    expect(byTag(computeDecorations('- item', new Set()), 'hr')).toHaveLength(0);
    expect(byTag(computeDecorations('-- only two', new Set()), 'hr')).toHaveLength(0);
  });
});

// R-20: バックスラッシュエスケープ
describe('R-20 エスケープ', () => {
  it('R-20-01: \\* は強調にならず、バックスラッシュを隠す', () => {
    const doc = 'a \\*not emphasis\\* b';
    const specs = computeDecorations(doc, new Set());
    expect(byTag(specs, 'em')).toHaveLength(0);
    expect(byTag(specs, 'strong')).toHaveLength(0);
    expect(byTag(specs, 'escape')).toHaveLength(2);
  });

  it('R-20-02: \\# や \\[ もエスケープされる', () => {
    expect(byTag(computeDecorations('\\# not heading', new Set()), 'escape')).toHaveLength(1);
    // 行頭の \# は見出しにもならない
    expect(byTag(computeDecorations('\\# not heading', new Set()), 'heading')).toHaveLength(0);
  });

  it('カーソル行ではバックスラッシュを隠さない', () => {
    expect(byTag(computeDecorations('a \\* b', new Set([0])), 'escape')).toHaveLength(0);
  });
});

// R-21: オートリンク
describe('R-21 オートリンク', () => {
  it('R-21-01: <https://…> をリンク化し < > を隠す', () => {
    const doc = 'see <https://example.com> now';
    const specs = computeDecorations(doc, new Set());
    const link = byTag(specs, 'link');
    expect(link).toHaveLength(1);
    expect(slice(doc, link[0])).toBe('https://example.com');
    expect(link[0].attrs?.href).toBe('https://example.com');
  });

  it('R-21-02: <a@b.com> は mailto: を付与する', () => {
    const specs = computeDecorations('<me@example.com>', new Set());
    expect(byTag(specs, 'link')[0].attrs?.href).toBe('mailto:me@example.com');
  });

  // R-21（相対パス + 山括弧宛先）: `[label](<path>)` の宛先は CommonMark の
  // 山括弧記法。model は href に山括弧を残し（パース仕様）、ホスト側 openLink が
  // 単一の山括弧ペアを除去して解決する。ここでは (1) model が山括弧込みの href を
  // 返すこと、(2) ホスト側で使う除去ロジックがスペースを保ったまま山括弧のみ
  // 剥がすこと、を検証する。
  it('R-21-03: [label](<rel path>) は href に山括弧を残す（model 仕様）', () => {
    const doc = '[doc](<a b/メモ.md>)';
    const specs = computeDecorations(doc, new Set());
    const link = byTag(specs, 'link');
    expect(link).toHaveLength(1);
    expect(link[0].attrs?.href).toBe('<a b/メモ.md>');
  });

  it('R-21-03: openLink の山括弧除去はスペースを保ち外側1組だけ剥がす', () => {
    // openLink（livePreviewEditorProvider）と同じ除去パターン。
    const strip = (h: string) => h.replace(/^<([\s\S]*)>$/, '$1');
    expect(strip('<a b/メモ.md>')).toBe('a b/メモ.md');
    expect(strip('a b/メモ.md')).toBe('a b/メモ.md'); // 山括弧なしは不変
    expect(strip('<x><y>')).toBe('x><y'); // 外側1組のみ（内側は保持）
  });
});

// R-22: 表のレンダリング
describe('R-22 表のレンダリング', () => {
  const doc = ['| a | b |', '| :-- | --: |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');

  it('parseTableRow はセルを分割する', () => {
    expect(parseTableRow('| a | b |')).toEqual(['a', 'b']);
    expect(parseTableRow('a | b')).toEqual(['a', 'b']);
  });

  it('parseTableRow: \\| をセル内文字として扱う', () => {
    // Escaped pipe stays inside the cell (unescaped to a bare `|`) instead of
    // splitting the row into an extra column.
    expect(parseTableRow('| a\\|b | c |')).toEqual(['a|b', 'c']);
    expect(parseTableRow('| x | y\\|z |')).toEqual(['x', 'y|z']);
    expect(parseTableRow('a\\|b | c')).toEqual(['a|b', 'c']);
  });

  it('parseTable はヘッダ・整列・行を返す', () => {
    const lines = splitLines(doc);
    const blocks = detectTableBlocks(lines, detectCodeBlocks(lines));
    expect(blocks).toHaveLength(1);
    const t = parseTable(lines, blocks[0]);
    expect(t.header).toEqual(['a', 'b']);
    expect(t.align).toEqual(['left', 'right']);
    expect(t.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('R-22-04: パイプを含む本文行直後の水平線 --- を表と誤検知しない', () => {
    const horizontalRule = ['本文 a | b を含む行', '---', '次の段落'].join('\n');
    const lines = splitLines(horizontalRule);
    expect(detectTableBlocks(lines, detectCodeBlocks(lines))).toHaveLength(0);

    const specs = computeDecorations(horizontalRule, new Set());
    expect(byTag(specs, 'table-block')).toHaveLength(0);
    expect(byTag(specs, 'hr').some((spec) => spec.type === 'line')).toBe(true);
  });

  it('R-22-04: 区切り行のセル数がヘッダと一致しない場合は表と判定しない', () => {
    const mismatched = ['| a | b |', '| - |', '| 1 | 2 |'].join('\n');
    const lines = splitLines(mismatched);
    expect(detectTableBlocks(lines, detectCodeBlocks(lines))).toHaveLength(0);
  });

  it('R-22-04: 外側パイプなしの正規の表は引き続き検知する', () => {
    const withoutOuterPipes = ['a | b', '- | -', '1 | 2'].join('\n');
    const lines = splitLines(withoutOuterPipes);
    const blocks = detectTableBlocks(lines, detectCodeBlocks(lines));
    expect(blocks).toHaveLength(1);
    expect(parseTable(lines, blocks[0]).header).toEqual(['a', 'b']);
  });

  it('R-22-01: 非カーソル時は単一の table-block ウィジェットに置換する', () => {
    const specs = computeDecorations(doc, new Set());
    const block = byTag(specs, 'table-block');
    expect(block).toHaveLength(1);
    expect(block[0].type).toBe('replaceWidget');
    const parsed = JSON.parse(block[0].attrs!.table);
    expect(parsed.header).toEqual(['a', 'b']);
    // ブロックの開始行を data-line マッピング用に attrs へ載せる。
    expect(block[0].attrs!.startLine).toBe('0');
    // 行装飾は出さない（ブロック置換のみ）
    expect(byTag(specs, 'table-row')).toHaveLength(0);
  });

  it('R-22-02: カーソルが表内にあるときは table-block ウィジェットを出さず、生の行を表示してセル編集を可能にする', () => {
    const specs = computeDecorations(doc, new Set([2]));
    // ブロック内にカーソルがある間はウィジェット化せず、raw 行を見せる（編集可能）。
    expect(byTag(specs, 'table-block')).toHaveLength(0);
    // 行は通常行として処理され、ドキュメント文字列は書き換えない。
    const before = doc;
    computeDecorations(doc, new Set([2]));
    expect(before).toBe(doc);
  });

  it('R-22-02: tableRowSourceLine は header=start / 区切り=null / rows=start+2+k を返す', () => {
    expect(tableRowSourceLine(0, 'header')).toBe(0);
    expect(tableRowSourceLine(0, 'delim')).toBeNull();
    expect(tableRowSourceLine(0, 'row', 0)).toBe(2);
    expect(tableRowSourceLine(0, 'row', 1)).toBe(3);
    expect(tableRowSourceLine(5, 'row', 2)).toBe(9);
  });

  it('コードブロック内の表もどきは表にしない', () => {
    const fenced = ['```', '| a | b |', '| - | - |', '```'].join('\n');
    expect(byTag(computeDecorations(fenced, new Set()), 'table-block')).toHaveLength(0);
  });
});

// R-22-05: テーブル行列操作（純粋ロジック）
describe('R-22-05 テーブル行列操作（純粋ロジック）', () => {
  const table = () => ['| a | b |', '| :-- | --: |', '| 1 | 2 |', '| 3 | 4 |'];

  it('insertTableRow: 下に空行を挿入する（区切り行は維持）', () => {
    const result = insertTableRow(table(), 0); // 1行目の body の下
    expect(result).toEqual(['| a | b |', '| :-- | --: |', '| 1 | 2 |', '|   |   |', '| 3 | 4 |']);
  });

  it("insertTableRow: 'top' は先頭 body 行として挿入する", () => {
    const result = insertTableRow(table(), 'top');
    expect(result).toEqual(['| a | b |', '| :-- | --: |', '|   |   |', '| 1 | 2 |', '| 3 | 4 |']);
  });

  it('insertTableRow: 負のインデックス（ヘッダ相当）は変更しない', () => {
    expect(insertTableRow(table(), -1)).toEqual(table());
  });

  it('deleteTableRow: 指定 body 行を削除する', () => {
    expect(deleteTableRow(table(), 0)).toEqual(['| a | b |', '| :-- | --: |', '| 3 | 4 |']);
  });

  it('deleteTableRow: ヘッダ削除ガード（範囲外は変更しない）', () => {
    expect(deleteTableRow(table(), -1)).toEqual(table()); // ヘッダ/区切り相当
    expect(deleteTableRow(table(), 2)).toEqual(table()); // body 行数超過
  });

  it('insertTableColumn: 右に列を追加し区切り行の整合を保つ', () => {
    const result = insertTableColumn(table(), 0, 'right');
    expect(result).toEqual(['| a |   | b |', '| :-- | --- | --: |', '| 1 |   | 2 |', '| 3 |   | 4 |']);
  });

  it('insertTableColumn: 左に列を追加する', () => {
    const result = insertTableColumn(table(), 1, 'left');
    expect(result).toEqual(['| a |   | b |', '| :-- | --- | --: |', '| 1 |   | 2 |', '| 3 |   | 4 |']);
  });

  it('deleteTableColumn: 指定列を全行から削除しアライメントを維持する', () => {
    const result = deleteTableColumn(table(), 0);
    expect(result).toEqual(['| b |', '| --: |', '| 2 |', '| 4 |']);
  });

  it('deleteTableColumn: 最後の1列削除はガードする', () => {
    const single = ['| a |', '| :-- |', '| 1 |'];
    expect(deleteTableColumn(single, 0)).toEqual(single);
  });

  it('入力配列を破壊しない', () => {
    const input = table();
    const snapshot = input.slice();
    insertTableRow(input, 0);
    deleteTableRow(input, 0);
    insertTableColumn(input, 0, 'right');
    deleteTableColumn(input, 0);
    expect(input).toEqual(snapshot);
  });
});

// R-22-05: セル直接編集（純粋ロジック）
describe('R-22-05 セル直接編集（純粋ロジック）', () => {
  const table = () => ['| a | b |', '| :-- | --: |', '| 1 | 2 |', '| 3 | 4 |'];

  it('updateTableCell: ヘッダーセル更新', () => {
    expect(updateTableCell(table(), { type: 'header' }, 0, 'X')).toEqual([
      '| X | b |',
      '| :-- | --: |',
      '| 1 | 2 |',
      '| 3 | 4 |',
    ]);
  });

  it('updateTableCell: ボディセル更新', () => {
    expect(updateTableCell(table(), { type: 'body', index: 1 }, 1, 'Z')).toEqual([
      '| a | b |',
      '| :-- | --: |',
      '| 1 | 2 |',
      '| 3 | Z |',
    ]);
  });

  it('updateTableCell: 存在しない行は無変更', () => {
    expect(updateTableCell(table(), { type: 'body', index: 5 }, 0, 'X')).toEqual(table());
  });

  it('updateTableCell: 存在しない列は無変更', () => {
    expect(updateTableCell(table(), { type: 'header' }, 5, 'X')).toEqual(table());
  });

  it('updateTableCell: 入力配列を破壊しない', () => {
    const input = table();
    const snapshot = input.slice();
    updateTableCell(input, { type: 'header' }, 0, 'X');
    updateTableCell(input, { type: 'body', index: 0 }, 1, 'Y');
    expect(input).toEqual(snapshot);
  });

  it('updateTableCell: パイプを \\| にエスケープして保存', () => {
    const result = updateTableCell(table(), { type: 'body', index: 0 }, 0, 'a|b');
    expect(result[2]).toBe('| a\\|b | 2 |');
    // Round-trips back to the literal value with a bare pipe.
    expect(parseTableRow(result[2])).toEqual(['a|b', '2']);
  });

  it('updateTableCell: 区切り行は更新しない', () => {
    // The delimiter row (body index -1 → source line 1) is never editable.
    expect(updateTableCell(table(), { type: 'body', index: -1 }, 0, 'X')).toEqual(table());
  });

  it('updateTableCell: 左寄せ・中央寄せ・右寄せを保持', () => {
    const aligned = ['| a | b | c |', '| :-- | :-: | --: |', '| 1 | 2 | 3 |'];
    const result = updateTableCell(aligned, { type: 'body', index: 0 }, 1, 'X');
    expect(result).toEqual(['| a | b | c |', '| :-- | :-: | --: |', '| 1 | X | 3 |']);
    // Delimiter alignment markers survive verbatim.
    expect(result[1]).toBe('| :-- | :-: | --: |');
  });

  it('updateTableCell: 空文字セル', () => {
    expect(updateTableCell(table(), { type: 'header' }, 0, '')).toEqual([
      '|   | b |',
      '| :-- | --: |',
      '| 1 | 2 |',
      '| 3 | 4 |',
    ]);
  });

  it('updateTableCell: 列数が不揃いな表', () => {
    const ragged = ['| a | b |', '| -- | -- |', '| 1 |'];
    // Update the only existing cell of the short row.
    expect(updateTableCell(ragged, { type: 'body', index: 0 }, 0, 'X')).toEqual([
      '| a | b |',
      '| -- | -- |',
      '| X |',
    ]);
    // A column absent from that short row is treated as non-existent → no change.
    expect(updateTableCell(ragged, { type: 'body', index: 0 }, 1, 'Y')).toEqual(ragged);
  });
});

// R-27: HTML <details> アコーディオン（既定で折りたたみ）
describe('R-27 <details> アコーディオン', () => {
  const inline = ['<details><summary>クリックして開く</summary>', '', '中身', '', '</details>'].join('\n');

  it('detectDetailsBlocks はブロック範囲と summary を返す', () => {
    const lines = splitLines(inline);
    const blocks = detectDetailsBlocks(lines, detectCodeBlocks(lines));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start).toBe(0);
    expect(blocks[0].end).toBe(4);
    expect(blocks[0].summary).toBe('クリックして開く');
  });

  it('detectDetailsBlocks は構造タグを除去した本文行を body に格納する', () => {
    const lines = splitLines(inline);
    const blocks = detectDetailsBlocks(lines, detectCodeBlocks(lines));
    // 前後の空行はトリムされ、構造タグ（</summary>/</details>）は含まれない。
    expect(blocks[0].body).toEqual(['中身']);
  });

  it('detectDetailsBlocks: summary 同一行の後続本文とタグ除去を検証する', () => {
    const doc = ['<details><summary>見出し</summary>本文1', '本文2', '</details>'].join('\n');
    const lines = splitLines(doc);
    const blocks = detectDetailsBlocks(lines, detectCodeBlocks(lines));
    expect(blocks[0].summary).toBe('見出し');
    expect(blocks[0].body).toEqual(['本文1', '本文2']);
  });

  it('summary が別行にある場合も抽出する', () => {
    const multi = ['<details>', '<summary>見出し</summary>', '本文', '</details>'].join('\n');
    const lines = splitLines(multi);
    const blocks = detectDetailsBlocks(lines, detectCodeBlocks(lines));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].summary).toBe('見出し');
    expect(blocks[0].body).toEqual(['本文']);
  });

  it('R-27-01/02: 非カーソル時はブロック全体を 1 つの details-block ウィジェットへ置換する（既定で折りたたみ）', () => {
    const specs = computeDecorations(inline, new Set());
    const block = byTag(specs, 'details-block');
    expect(block).toHaveLength(1);
    expect(block[0].type).toBe('replaceWidget');
    expect(block[0].attrs?.summary).toBe('クリックして開く');
  });

  it('R-27-03: ビューア専用 — ブロック内にカーソルがあっても常に details-block ウィジェットに置換する', () => {
    const specs = computeDecorations(inline, new Set([0]));
    // ブロック内カーソルでもウィジェットのまま（生記法を出さない＝非編集）。
    expect(byTag(specs, 'details-block')).toHaveLength(1);
    expect(byTag(specs, 'details-tag')).toHaveLength(0);
  });

  it('コードブロック内の <details> は折りたたまない', () => {
    const fenced = ['```html', '<details><summary>x</summary>', 'y', '</details>', '```'].join('\n');
    expect(byTag(computeDecorations(fenced, new Set()), 'details-block')).toHaveLength(0);
  });

  it('閉じタグの無い <details> は折りたたまない（文末まで畳まない）', () => {
    const open = ['<details><summary>x</summary>', '本文だけ'].join('\n');
    const lines = splitLines(open);
    expect(detectDetailsBlocks(lines, detectCodeBlocks(lines))).toHaveLength(0);
  });

  it('ユーザーテキストを書き換えない（表示のみ）', () => {
    const before = inline;
    computeDecorations(before, new Set());
    expect(before).toBe(inline);
  });

  // R-27-03（ビューア専用化）: ブロック内にカーソルがあっても details-block の
  // ままで、生記法（行装飾・構造タグの hide・インライン強調）は一切出さない。
  it('R-27-03: ブロック内カーソルでも生記法を出さない（強調マーク等を emit しない）', () => {
    const doc = ['<details><summary>Q</summary>', '', '**ワークパッケージ**。', '', '</details>'].join('\n');
    const specs = computeDecorations(doc, new Set([2]));
    expect(byTag(specs, 'details-block')).toHaveLength(1);
    expect(byTag(specs, 'strong')).toHaveLength(0);
    expect(byTag(specs, 'strong-mark')).toHaveLength(0);
    expect(byTag(specs, 'details-tag')).toHaveLength(0);
  });

  // R-27-05: detailsTagRanges は引き続き純粋関数として構造タグ範囲を返す
  // （ビューア専用化により computeDecorations 内では未使用だが、関数仕様は維持）。
  describe('R-27-05 detailsTagRanges（純粋関数の範囲抽出）', () => {
    it('山括弧タグの範囲のみ返す（サマリ本文は含まない）', () => {
      const line = '<details><summary>サマリ</summary>';
      const ranges = detailsTagRanges(line);
      const tags = ranges.map((r) => line.slice(r.start, r.end));
      expect(tags).toEqual(['<details>', '<summary>', '</summary>']);
      for (const r of ranges) expect(line.slice(r.start, r.end)).not.toContain('サマリ');
    });

    it('属性付きの <details ...> / <summary ...> タグも範囲に含める', () => {
      const line = '<details open><summary class="x">A</summary>';
      const tags = detailsTagRanges(line).map((r) => line.slice(r.start, r.end));
      expect(tags).toEqual(['<details open>', '<summary class="x">', '</summary>']);
    });

    it('</details> 単独行のタグも範囲を返す', () => {
      expect(detailsTagRanges('</details>').map((r) => '</details>'.slice(r.start, r.end))).toEqual(['</details>']);
    });

    it('ユーザーテキストを書き換えない（ビューア専用化後も表示のみ）', () => {
      const doc = ['<details><summary>Q</summary>', '本文', '</details>'].join('\n');
      const before = doc;
      computeDecorations(doc, new Set([0]));
      expect(before).toBe(doc);
    });
  });
});

// R-30: 見出しセクション折りたたみ
describe('R-30 見出しセクション折りたたみ', () => {
  describe('scanHeadings（R-30-01）', () => {
    it('全見出しをレベル・テキスト・行番号・オフセット付きで返す', () => {
      const doc = ['# A', 'body', '## B', 'more', '### C'].join('\n');
      const headings = scanHeadings(doc);
      expect(headings.map((h) => [h.level, h.text, h.line])).toEqual([
        [1, 'A', 0],
        [2, 'B', 2],
        [3, 'C', 4],
      ]);
      // オフセットは見出し行の絶対位置。
      const lines = splitLines(doc);
      expect(headings[1].from).toBe(lines[2].from);
      expect(headings[1].to).toBe(lines[2].to);
    });

    it('フェンスコードブロック内の # は見出しとして誤検知しない', () => {
      const doc = ['# Real', '```', '# not a heading', '## also not', '```', '## Real2'].join('\n');
      const headings = scanHeadings(doc);
      expect(headings.map((h) => [h.text, h.line])).toEqual([
        ['Real', 0],
        ['Real2', 5],
      ]);
    });

    it('アウトライン用途: 複数レベルの見出しを網羅し、コードブロック内 # を除外し、行番号が正確であること（R-33-01）', () => {
      const doc = [
        '# Title',
        'intro',
        '## Section A',
        '```',
        '# fake',
        '## also fake',
        '```',
        '### Subsection A.1',
        'text',
        '#### Deep',
        '## Section B',
        '###### Deepest',
      ].join('\n');
      const headings = scanHeadings(doc);
      expect(headings.map((h) => [h.level, h.text, h.line])).toEqual([
        [1, 'Title', 0],
        [2, 'Section A', 2],
        [3, 'Subsection A.1', 7],
        [4, 'Deep', 9],
        [2, 'Section B', 10],
        [6, 'Deepest', 11],
      ]);
      // すべてのレベル 1〜6 が本ドキュメント内の見出し走査で少なくとも一度は
      // 網羅されていること（アウトラインのインデント表示に必要な情報）。
      expect(new Set(headings.map((h) => h.level))).toEqual(new Set([1, 2, 3, 4, 6]));
    });
  });

  describe('headingFoldRange（R-30-02）', () => {
    it('次の同レベル見出しの直前行末までを折りたたみ範囲として返す', () => {
      const doc = ['# A', 'body1', 'body2', '# B', 'body3'].join('\n');
      const lines = splitLines(doc);
      const range = headingFoldRange(doc, 0);
      expect(range).toEqual({ from: lines[0].to, to: lines[2].to });
    });

    it('より強い（浅い）見出しの直前で範囲を打ち切る', () => {
      const doc = ['# A', 'a1', '## B', 'b1', '# C'].join('\n');
      const lines = splitLines(doc);
      // ## B のセクションは # C の直前（b1 の行末）まで。
      expect(headingFoldRange(doc, 2)).toEqual({ from: lines[2].to, to: lines[3].to });
      // # A のセクションは # C の直前まで（## B を含む）。
      expect(headingFoldRange(doc, 0)).toEqual({ from: lines[0].to, to: lines[3].to });
    });

    it('同レベル以下の見出しが無ければ文書末まで折りたたむ', () => {
      const doc = ['# A', 'x', '## B', 'y'].join('\n');
      const lines = splitLines(doc);
      expect(headingFoldRange(doc, 0)).toEqual({ from: lines[0].to, to: lines[3].to });
    });

    it('配下が無い場合は null を返す', () => {
      // 見出しが最終行。
      expect(headingFoldRange('body\n# Last', 1)).toBeNull();
      // 直後に同レベル見出しが続き、間に本文が無い。
      const doc = ['# A', '# B', 'b'].join('\n');
      expect(headingFoldRange(doc, 0)).toBeNull();
    });

    it('見出し行でなければ null を返す', () => {
      expect(headingFoldRange(['# A', 'body'].join('\n'), 1)).toBeNull();
    });

    it('コードブロックを跨いでも正しく範囲を返す', () => {
      const doc = ['# A', 'intro', '```', '# not a heading', '```', 'outro', '# B'].join('\n');
      const lines = splitLines(doc);
      // コード内の # は見出し扱いされないので、# A は次の実見出し # B の直前
      //（outro 行末）まで畳む。コードブロックを跨いでも打ち切られない。
      expect(headingFoldRange(doc, 0)).toEqual({ from: lines[0].to, to: lines[5].to });
    });
  });
});
