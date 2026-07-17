import { describe, it, expect } from 'vitest';
import {
  isImageFile,
  formatMarkdownLinkTarget,
  buildMediaSnippet,
  dedupeFilesAgainstUris,
  hasMediaPayload,
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
