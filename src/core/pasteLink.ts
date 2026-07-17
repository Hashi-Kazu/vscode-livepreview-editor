/**
 * Pure helpers for pasting/dropping media into the editor. No VS Code imports so
 * image detection, angle-bracket escaping, snippet building, and filename
 * collision avoidance can be unit-tested directly (R-29).
 */

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'ico',
  'avif',
  'tiff',
]);

/** True when the filename has a known image extension. */
export function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Parse `text/uri-list`, ignoring its comment lines and duplicate entries. */
export function parseUriList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of value.split(/\r\n?|\n/)) {
    const uri = line.trim();
    if (!uri || uri.startsWith('#') || seen.has(uri)) continue;
    seen.add(uri);
    result.push(uri);
  }
  return result;
}

/**
 * Parse URI candidates supplied by Chromium/VS Code drag data.  Explorer
 * commonly supplies both MIME types, so preserve first-seen ordering while
 * removing duplicate URI strings.
 */
export function parseDataTransferUris(params: {
  uriList?: unknown;
  codeUriList?: unknown;
  plainText?: unknown;
}): string[] {
  const direct = [...parseUriList(params.uriList), ...parseUriList(params.codeUriList)];
  const plain = parsePlainFileUriList(params.plainText);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...direct, ...plain]) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    result.push(raw);
  }
  return result;
}

/**
 * `text/plain` is a fallback only when every meaningful line is a file URI.
 * This deliberately leaves normal prose and HTTP(S) URLs to CodeMirror.
 */
export function parsePlainFileUriList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const candidates = parseUriList(value);
  if (candidates.length === 0) return [];
  return candidates.every((candidate) => {
    try {
      return new URL(candidate).protocol === 'file:';
    } catch {
      return false;
    }
  })
    ? candidates
    : [];
}

/** Whether a paste/drop needs the extension's media handling rather than CodeMirror's default text paste. */
export function hasMediaPayload(params: { fileCount: number; uris: readonly string[] }): boolean {
  return params.fileCount > 0 || params.uris.length > 0;
}

/**
 * Remove URI-list entries that describe a simultaneously supplied File. The
 * browser File API exposes no filesystem URI, so filename identity is the
 * strongest portable identity available to Webviews.
 */
export function dedupeUrisAgainstFiles(uris: readonly string[], fileNames: readonly string[]): string[] {
  const names = new Set(fileNames.map((name) => name.toLowerCase()));
  return uris.filter((raw) => {
    try {
      const pathname = decodeURIComponent(new URL(raw).pathname);
      const name = pathname.split('/').at(-1)?.toLowerCase();
      return !name || !names.has(name);
    } catch {
      return true;
    }
  });
}

/**
 * URI payloads are authoritative over simultaneously supplied browser Files.
 * Return only Files that do not name a URI target so the host never copies the
 * same Explorer item twice. This relies only on portable File.name data.
 */
export function dedupeFilesAgainstUris<T extends { name: string }>(
  files: readonly T[],
  uris: readonly string[],
): T[] {
  const uriNames = new Set<string>();
  for (const raw of uris) {
    try {
      const pathname = decodeURIComponent(new URL(raw).pathname);
      const name = pathname.split('/').at(-1);
      if (name) uriNames.add(name.toLowerCase());
    } catch {
      // The host will report the malformed URI. It cannot identify a File
      // reliably, so retain that File rather than dropping user data here.
    }
  }
  return files.filter((file) => !uriNames.has(file.name.toLowerCase()));
}

/**
 * Format a link target for Markdown. Paths containing a space, `(`, or `)` are
 * wrapped in angle brackets like VS Code does. When wrapping, any literal `<` or
 * `>` in the path is percent-encoded so the wrapper stays unambiguous. Non-ASCII
 * characters are preserved verbatim (not escaped).
 */
export function formatMarkdownLinkTarget(relPath: string): string {
  if (!/[ ()]/.test(relPath)) return relPath;
  const escaped = relPath.replace(/</g, '%3C').replace(/>/g, '%3E');
  return `<${escaped}>`;
}

export interface MediaSnippet {
  text: string;
  placeholderFrom: number;
  placeholderTo: number;
}

/**
 * Build the Markdown snippet to insert. Images use `![alt text](target)` with
 * `alt text` as the selectable placeholder; other files use `[text](target)`
 * with `text` as the placeholder. `target` must already be passed through
 * {@link formatMarkdownLinkTarget}.
 */
export function buildMediaSnippet(opts: {
  isImage: boolean;
  target: string;
  /** Selected text wins for non-image links; empty selections use the basename. */
  selectedText?: string;
}): MediaSnippet {
  const placeholder = opts.isImage ? 'alt text' : mediaLinkText(opts.target, opts.selectedText);
  const prefix = opts.isImage ? '![' : '[';
  const from = prefix.length;
  const to = from + placeholder.length;
  const text = `${prefix}${placeholder}](${opts.target})`;
  return { text, placeholderFrom: from, placeholderTo: to };
}

/** Derive the visible label for a non-image Markdown link. */
export function mediaLinkText(target: string, selectedText?: string): string {
  if (typeof selectedText === 'string' && selectedText.length > 0) return selectedText;
  const bare = target.replace(/^<|>$/g, '').replace(/%3C/g, '<').replace(/%3E/g, '>');
  const base = bare.split('/').at(-1) || 'text';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Return a filename that does not collide according to `exists`. On collision a
 * `-1`, `-2`, ... suffix is inserted before the extension.
 */
export function uniqueMediaName(desired: string, exists: (name: string) => boolean): string {
  if (!exists(desired)) return desired;
  const dot = desired.lastIndexOf('.');
  const base = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}
