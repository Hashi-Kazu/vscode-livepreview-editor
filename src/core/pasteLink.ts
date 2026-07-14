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
export function buildMediaSnippet(opts: { isImage: boolean; target: string }): MediaSnippet {
  const placeholder = opts.isImage ? 'alt text' : 'text';
  const prefix = opts.isImage ? '![' : '[';
  const from = prefix.length;
  const to = from + placeholder.length;
  const text = `${prefix}${placeholder}](${opts.target})`;
  return { text, placeholderFrom: from, placeholderTo: to };
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
