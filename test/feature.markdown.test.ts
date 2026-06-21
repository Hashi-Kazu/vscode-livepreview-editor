import { describe, it, expect } from 'vitest';
import { computeDecorations, DecoSpec, splitLines, detectCodeBlocks, detectTableBlocks, detectDetailsBlocks, detailsTagRanges, parseTable, parseTableRow } from '../src/core/model';

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
});

// R-22: 表のレンダリング
describe('R-22 表のレンダリング', () => {
  const doc = ['| a | b |', '| :-- | --: |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');

  it('parseTableRow はセルを分割する', () => {
    expect(parseTableRow('| a | b |')).toEqual(['a', 'b']);
    expect(parseTableRow('a | b')).toEqual(['a', 'b']);
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

  it('R-22-01: 非カーソル時は単一の table-block ウィジェットに置換する', () => {
    const specs = computeDecorations(doc, new Set());
    const block = byTag(specs, 'table-block');
    expect(block).toHaveLength(1);
    expect(block[0].type).toBe('replaceWidget');
    const parsed = JSON.parse(block[0].attrs!.table);
    expect(parsed.header).toEqual(['a', 'b']);
    // 行装飾は出さない（ブロック置換のみ）
    expect(byTag(specs, 'table-row')).toHaveLength(0);
  });

  it('R-22-02: カーソルが表内にあるとき生の行を表示する', () => {
    const specs = computeDecorations(doc, new Set([2]));
    expect(byTag(specs, 'table-block')).toHaveLength(0);
    expect(byTag(specs, 'table-row').length).toBe(4);
  });

  it('コードブロック内の表もどきは表にしない', () => {
    const fenced = ['```', '| a | b |', '| - | - |', '```'].join('\n');
    expect(byTag(computeDecorations(fenced, new Set()), 'table-block')).toHaveLength(0);
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

  it('summary が別行にある場合も抽出する', () => {
    const multi = ['<details>', '<summary>見出し</summary>', '本文', '</details>'].join('\n');
    const lines = splitLines(multi);
    const blocks = detectDetailsBlocks(lines, detectCodeBlocks(lines));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].summary).toBe('見出し');
  });

  it('R-27-01/02: 非カーソル時はブロック全体を 1 つの details-block ウィジェットへ置換する（既定で折りたたみ）', () => {
    const specs = computeDecorations(inline, new Set());
    const block = byTag(specs, 'details-block');
    expect(block).toHaveLength(1);
    expect(block[0].type).toBe('replaceWidget');
    expect(block[0].attrs?.summary).toBe('クリックして開く');
  });

  it('R-27-03: ブロック内にカーソルがあるときは生記法を表示する（置換しない）', () => {
    const specs = computeDecorations(inline, new Set([0]));
    expect(byTag(specs, 'details-block')).toHaveLength(0);
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

  // R-28-06: アクティブな details ブロックでも本文行のインライン記法を描画する
  it('R-28-06: アクティブ時も本文行の強調（**…**）を描画する', () => {
    const doc = ['<details><summary>Q</summary>', '', '**ワークパッケージ**。', '', '</details>'].join('\n');
    // カーソルは別行（summary 行）にあり、ブロックはアクティブ＝生記法表示。
    const specs = computeDecorations(doc, new Set([0]));
    // details-block ウィジェットには置換されない（アクティブなので生表示）。
    expect(byTag(specs, 'details-block')).toHaveLength(0);
    // それでも本文行 `**ワークパッケージ**` の強調マークは付与される。
    const strong = byTag(specs, 'strong');
    expect(strong).toHaveLength(1);
    expect(slice(doc, strong[0])).toBe('ワークパッケージ');
    // 強調マーカー `**` は非カーソル本文行なので隠される。
    expect(byTag(specs, 'strong-mark')).toHaveLength(2);
  });

  it('R-28-06: 本文行にカーソルがあるときはマーカーを隠さない', () => {
    const doc = ['<details><summary>Q</summary>', '', '**ワークパッケージ**。', '', '</details>'].join('\n');
    // カーソルが本文行（index 2）にある。
    const specs = computeDecorations(doc, new Set([2]));
    expect(byTag(specs, 'strong')).toHaveLength(1);
    expect(byTag(specs, 'strong-mark')).toHaveLength(0); // 生記法のまま
  });

  // R-27-05: 構造 HTML タグは常に隠す（生のタグ文字列を表示しない）
  describe('R-27-05 構造タグの非表示', () => {
    it('detailsTagRanges は山括弧タグの範囲のみ返す（サマリ本文は含まない）', () => {
      const line = '<details><summary>サマリ</summary>';
      const ranges = detailsTagRanges(line);
      const tags = ranges.map((r) => line.slice(r.start, r.end));
      expect(tags).toEqual(['<details>', '<summary>', '</summary>']);
      // サマリ本文「サマリ」はどの範囲にも含まれない。
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

    it('アクティブ時、各構造タグを details-tag の hide 記述子で隠す（カーソル有無を問わず）', () => {
      const doc = ['<details><summary>Q</summary>', '本文', '</details>'].join('\n');
      // カーソルが summary 行（タグを含む行）にあっても隠す。
      const specs = computeDecorations(doc, new Set([0]));
      const hidden = byTag(specs, 'details-tag');
      const tags = hidden.map((s) => slice(doc, s)).sort();
      expect(tags).toEqual(['</details>', '</summary>', '<details>', '<summary>'].sort());
      for (const s of hidden) expect(s.type).toBe('hide');
    });

    it('アクティブ時、<summary> と </summary> の間のサマリ本文は隠さず可視のまま', () => {
      const doc = ['<details><summary>サマリ本文</summary>', '本文', '</details>'].join('\n');
      const specs = computeDecorations(doc, new Set([0]));
      // 「サマリ本文」を覆う hide 記述子は存在しない。
      const summaryFrom = doc.indexOf('サマリ本文');
      const covers = specs.some(
        (s) => s.type === 'hide' && s.from <= summaryFrom && s.to >= summaryFrom + 1,
      );
      expect(covers).toBe(false);
    });

    it('アクティブ時、サマリ本文のインライン記法（**…**）も描画する', () => {
      const doc = ['<details><summary>**強調**</summary>', '本文', '</details>'].join('\n');
      // 本文行（タグ無し）にカーソル → summary 行は非カーソルなのでマーカーも隠れる。
      const specs = computeDecorations(doc, new Set([1]));
      const strong = byTag(specs, 'strong');
      expect(strong).toHaveLength(1);
      expect(slice(doc, strong[0])).toBe('強調');
    });

    it('ユーザーテキストを書き換えない（タグ非表示は表示のみ）', () => {
      const doc = ['<details><summary>Q</summary>', '本文', '</details>'].join('\n');
      const before = doc;
      computeDecorations(doc, new Set([0]));
      expect(before).toBe(doc);
    });
  });
});
