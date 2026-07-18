import { describe, it, expect } from 'vitest';
import {
  isImageFile,
  formatMarkdownLinkTarget,
  buildMediaSnippet,
  combineLinks,
  dedupeFilesAgainstUris,
  folderLinkTarget,
  hasMediaPayload,
  linkLabel,
  parseClipboardFileListJson,
  parseDataTransferUris,
  parsePlainFilePaths,
  parsePlainFileUriList,
  parseUriList,
  uniqueMediaName,
} from '../src/core/pasteLink';

// R-29: 画像・ファイルのペースト/ドロップ挿入（純粋ヘルパー）
describe('R-29-01 formatMarkdownLinkTarget', () => {
  it('スペースを含むパスは山括弧で囲む', () => {
    expect(formatMarkdownLinkTarget('assets/新規 ビットマップ イメージ.bmp')).toBe(
      '<assets/新規 ビットマップ イメージ.bmp>',
    );
  });

  it('スペース等が無ければそのまま（非 ASCII も維持）', () => {
    expect(formatMarkdownLinkTarget('マークダウン.md')).toBe('マークダウン.md');
  });

  it('括弧を含むパスは山括弧で囲む', () => {
    expect(formatMarkdownLinkTarget('a(b).png')).toBe('<a(b).png>');
  });
});

describe('R-29-02 buildMediaSnippet', () => {
  it('画像は ![alt text](target) を生成しプレースホルダが alt text を指す', () => {
    const r = buildMediaSnippet({ isImage: true, target: '<assets/x y.png>' });
    expect(r.text).toBe('![alt text](<assets/x y.png>)');
    expect(r.text.slice(r.placeholderFrom, r.placeholderTo)).toBe('alt text');
  });

  it('非画像は [text](target) を生成しプレースホルダが text を指す', () => {
    const r = buildMediaSnippet({ isImage: false, target: 'マークダウン.md' });
    expect(r.text).toBe('[マークダウン](マークダウン.md)');
    expect(r.text.slice(r.placeholderFrom, r.placeholderTo)).toBe('マークダウン');
  });
});

describe('R-29-03 isImageFile', () => {
  it('画像拡張子は true', () => {
    expect(isImageFile('a.bmp')).toBe(true);
    expect(isImageFile('a.png')).toBe(true);
    expect(isImageFile('a.svg')).toBe(true);
  });

  it('非画像拡張子は false', () => {
    expect(isImageFile('a.md')).toBe(false);
    expect(isImageFile('a.txt')).toBe(false);
  });
});

describe('R-29-04 uniqueMediaName', () => {
  it('衝突時は拡張子前へ連番を付与する', () => {
    const taken = new Set(['image.png']);
    const first = uniqueMediaName('image.png', (n) => taken.has(n));
    expect(first).toBe('image-1.png');
    taken.add(first);
    const second = uniqueMediaName('image.png', (n) => taken.has(n));
    expect(second).toBe('image-2.png');
  });
});

describe('R-29-05 URI clipboard media', () => {
  it('URI-only paste inserts one document-relative Markdown or copied image link', () => {
    const uris = parseUriList('# copied by Explorer\r\nfile:///workspace/docs/ガントチャート.md\r\n\r\nfile:///workspace/docs/ガントチャート.md');
    expect(uris).toEqual(['file:///workspace/docs/ガントチャート.md']);
    expect(hasMediaPayload({ fileCount: 0, uris })).toBe(true);
    expect(buildMediaSnippet({ isImage: false, target: 'ガントチャート.md' }).text).toBe('[ガントチャート](ガントチャート.md)');
    expect(buildMediaSnippet({ isImage: true, target: '<assets/新規 ビットマップ イメージ.bmp>' }).text)
      .toBe('![alt text](<assets/新規 ビットマップ イメージ.bmp>)');
  });

  it('does not intercept ordinary text and keeps URI canonical over an accompanying File', () => {
    // Plain clipboard text has no text/uri-list data and remains CodeMirror-owned.
    expect(hasMediaPayload({ fileCount: 0, uris: [] })).toBe(false);
    expect(dedupeFilesAgainstUris([{ name: 'image.png' }], ['file:///workspace/docs/image.png'])).toEqual([]);
  });

  it('parses Explorer URI MIME types and only permits all-file URI text/plain fallback', () => {
    expect(parseDataTransferUris({
      uriList: 'file:///workspace/docs/a.md',
      codeUriList: 'file:///workspace/docs/a.md\r\nfile:///workspace/docs/b.png',
      plainText: 'ordinary prose',
    })).toEqual(['file:///workspace/docs/a.md', 'file:///workspace/docs/b.png']);
    expect(parsePlainFileUriList('file:///workspace/docs/a.md\nhttps://example.com')).toEqual([]);
    expect(parsePlainFileUriList('file:///workspace/docs/a.md\r\nfile:///workspace/docs/b.png')).toEqual([
      'file:///workspace/docs/a.md',
      'file:///workspace/docs/b.png',
    ]);
  });

  it('uses selected text for non-image link labels and target basename otherwise', () => {
    expect(buildMediaSnippet({ isImage: false, target: 'ガントチャート.md', selectedText: 'test' }).text)
      .toBe('[test](ガントチャート.md)');
    expect(buildMediaSnippet({ isImage: false, target: 'ガントチャート.md' }).text)
      .toBe('[ガントチャート](ガントチャート.md)');
  });
});

describe('R-29-06 clipboard file link command helpers', () => {
  describe('parseClipboardFileListJson', () => {
    it('array JSON は配列を返す', () => {
      expect(parseClipboardFileListJson('["C:\\\\a\\\\b.md","C:\\\\a\\\\c.png"]')).toEqual([
        'C:\\a\\b.md',
        'C:\\a\\c.png',
      ]);
    });

    it('単一文字列 JSON は 1 要素配列を返す', () => {
      expect(parseClipboardFileListJson('"C:\\\\a\\\\b.md"')).toEqual(['C:\\a\\b.md']);
    });

    it('空文字・null・不正 JSON は空配列を返す', () => {
      expect(parseClipboardFileListJson('')).toEqual([]);
      expect(parseClipboardFileListJson('   ')).toEqual([]);
      expect(parseClipboardFileListJson('null')).toEqual([]);
      expect(parseClipboardFileListJson('not json')).toEqual([]);
    });

    it('前後空白をトリムし空要素を除外する', () => {
      expect(parseClipboardFileListJson('  ["  C:\\\\a.md  ", "", "C:\\\\b.md"]  ')).toEqual([
        'C:\\a.md',
        'C:\\b.md',
      ]);
    });
  });

  describe('linkLabel', () => {
    it('非空の選択テキストを最優先する', () => {
      expect(
        linkLabel({ name: 'a.md', relative: 'docs/a.md', isDirectory: false, selectedText: 'sel', mode: 'fileName' }),
      ).toBe('sel');
    });

    it('fileName モードは拡張子付き名を返す', () => {
      expect(linkLabel({ name: 'a.md', relative: 'docs/a.md', isDirectory: false, mode: 'fileName' })).toBe('a.md');
    });

    it('fileNameWithoutExtension モードは最終拡張子を除去する', () => {
      expect(
        linkLabel({ name: 'a.tar.gz', relative: 'docs/a.tar.gz', isDirectory: false, mode: 'fileNameWithoutExtension' }),
      ).toBe('a.tar');
    });

    it('relativePath モードは相対パスを返す', () => {
      expect(linkLabel({ name: 'a.md', relative: 'docs/a.md', isDirectory: false, mode: 'relativePath' })).toBe(
        'docs/a.md',
      );
    });

    it('日本語・空白名を保持する', () => {
      expect(
        linkLabel({ name: '新規 ファイル.md', relative: 'docs/新規 ファイル.md', isDirectory: false, mode: 'fileNameWithoutExtension' }),
      ).toBe('新規 ファイル');
    });

    it('フォルダーは常に名前ベース（末尾スラッシュなし）で mode を無視する', () => {
      expect(linkLabel({ name: 'assets', relative: 'sub/assets', isDirectory: true, mode: 'relativePath' })).toBe(
        'assets',
      );
    });
  });

  describe('folderLinkTarget', () => {
    it('末尾に / を付与する', () => {
      expect(folderLinkTarget('sub/assets')).toBe('sub/assets/');
    });

    it('既に / があれば重複させない', () => {
      expect(folderLinkTarget('sub/assets/')).toBe('sub/assets/');
    });
  });

  describe('buildMediaSnippet label 引数', () => {
    it('非画像は label を表示テキストに使いプレースホルダ範囲が一致する', () => {
      const r = buildMediaSnippet({ isImage: false, target: 'docs/a.md', label: 'My Label' });
      expect(r.text).toBe('[My Label](docs/a.md)');
      expect(r.text.slice(r.placeholderFrom, r.placeholderTo)).toBe('My Label');
    });

    it('画像は label を無視し alt text を使う', () => {
      const r = buildMediaSnippet({ isImage: true, target: 'docs/a.png', label: 'ignored' });
      expect(r.text).toBe('![alt text](docs/a.png)');
      expect(r.text.slice(r.placeholderFrom, r.placeholderTo)).toBe('alt text');
    });

    it('label 未指定時は従来どおり basename ラベル', () => {
      const r = buildMediaSnippet({ isImage: false, target: 'マークダウン.md' });
      expect(r.text).toBe('[マークダウン](マークダウン.md)');
    });
  });

  describe('combineLinks', () => {
    const a = buildMediaSnippet({ isImage: false, target: 'a.md', label: 'A' });
    const b = buildMediaSnippet({ isImage: false, target: 'b.md', label: 'B' });

    it('単一要素はそのまま返す', () => {
      expect(combineLinks([a], 'lines')).toEqual(a);
      expect(combineLinks([a], 'list')).toEqual(a);
    });

    it('lines は改行区切りで先頭プレースホルダを指す', () => {
      const r = combineLinks([a, b], 'lines');
      expect(r.text).toBe('[A](a.md)\n[B](b.md)');
      expect(r.text.slice(r.placeholderFrom, r.placeholderTo)).toBe('A');
    });

    it('list は各行に "- " を前置し先頭プレースホルダをオフセットする', () => {
      const r = combineLinks([a, b], 'list');
      expect(r.text).toBe('- [A](a.md)\n- [B](b.md)');
      expect(r.text.slice(r.placeholderFrom, r.placeholderTo)).toBe('A');
    });
  });
});

describe('R-29-05 absolute path text/plain fallback', () => {
  it('converts a raw POSIX absolute path line to a file: URI', () => {
    expect(parsePlainFilePaths('/workspace/docs/a.md')).toEqual(['file:///workspace/docs/a.md']);
  });

  it('converts a raw Windows drive path to a lowercase-drive file: URI', () => {
    expect(parsePlainFilePaths('C:\\workspace\\docs\\a.md')).toEqual(['file:///c:/workspace/docs/a.md']);
  });

  it('converts a Windows UNC path to a file: URI with the server as authority', () => {
    expect(parsePlainFilePaths('\\\\server\\share\\docs\\a.md')).toEqual(['file://server/share/docs/a.md']);
  });

  it('rejects ordinary prose, relative paths, and http(s) URLs', () => {
    expect(parsePlainFilePaths('ordinary prose')).toEqual([]);
    expect(parsePlainFilePaths('docs/a.md')).toEqual([]);
    expect(parsePlainFilePaths('https://example.com')).toEqual([]);
  });

  it('requires every non-empty line to be an absolute path', () => {
    expect(parsePlainFilePaths('/workspace/docs/a.md\nordinary prose')).toEqual([]);
  });

  it('merges into parseDataTransferUris as a fallback, preferring file: URIs and deduping', () => {
    expect(parseDataTransferUris({
      uriList: 'file:///workspace/docs/a.md',
      plainText: '/workspace/docs/a.md\n/workspace/docs/b.md',
    })).toEqual(['file:///workspace/docs/a.md', 'file:///workspace/docs/b.md']);
    expect(parseDataTransferUris({ plainText: '/workspace/docs/a.md' })).toEqual([
      'file:///workspace/docs/a.md',
    ]);
    // A file: URI text/plain fallback still wins over the raw-path fallback.
    expect(parseDataTransferUris({ plainText: 'file:///workspace/docs/a.md' })).toEqual([
      'file:///workspace/docs/a.md',
    ]);
  });
});
