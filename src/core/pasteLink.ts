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
  const plainUriList = parsePlainFileUriList(params.plainText);
  const plain = plainUriList.length > 0 ? plainUriList : parsePlainFilePaths(params.plainText);
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

const POSIX_ABSOLUTE_PATH = /^\//;
const WINDOWS_DRIVE_PATH = /^([A-Za-z]):[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\([^\\]+)\\(.*)$/;

/** Percent-encode each `/`-separated path segment for use inside a `file:` URI. */
function encodePathSegments(pathname: string): string {
  return pathname.split('/').map(encodeURIComponent).join('/');
}

/** Normalize a single absolute filesystem path (POSIX or Windows) to a `file:` URI string, or `null` if it is not an absolute path. */
function absoluteFilePathToUri(candidate: string): string | null {
  const uncMatch = WINDOWS_UNC_PATH.exec(candidate);
  if (uncMatch) {
    const [, server, rest] = uncMatch;
    return `file://${server}/${encodePathSegments(rest.replace(/\\/g, '/'))}`;
  }
  const driveMatch = WINDOWS_DRIVE_PATH.exec(candidate);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = candidate.slice(driveMatch[0].length).replace(/\\/g, '/');
    return `file:///${drive}:/${encodePathSegments(rest)}`;
  }
  if (POSIX_ABSOLUTE_PATH.test(candidate)) {
    return `file://${encodePathSegments(candidate)}`;
  }
  return null;
}

/**
 * `text/plain` is also a fallback when every meaningful line is a raw absolute
 * filesystem path (e.g. VS Code's "Copy Path"), rather than a `file:` URI.
 * Each line is normalized to a `file:` URI string so the host's existing
 * `relativizeUri` validation (workspace membership, existence) applies
 * unchanged. Relative paths, HTTP(S) URLs, and ordinary prose all yield `[]`,
 * as does any mix where not every non-empty line is an absolute path.
 */
export function parsePlainFilePaths(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const candidates = parseUriList(value);
  if (candidates.length === 0) return [];
  const uris: string[] = [];
  for (const candidate of candidates) {
    const uri = absoluteFilePathToUri(candidate);
    if (uri === null) return [];
    uris.push(uri);
  }
  return uris;
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

/**
 * R-29-07: Wrap a non-empty selection as a Markdown link when the clipboard
 * text is a single bare http/https URL. Returns null (default paste) for empty
 * selections or clipboard content that is not a lone http(s) URL.
 */
export function buildUrlLinkPaste(
  selectedText: string,
  clipboardText: unknown,
): { text: string } | null {
  if (selectedText.length === 0) return null;
  if (typeof clipboardText !== 'string') return null;
  const trimmed = clipboardText.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return { text: `[${selectedText}](${formatMarkdownLinkTarget(trimmed)})` };
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
