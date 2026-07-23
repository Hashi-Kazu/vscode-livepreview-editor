/**
 * Pure helpers for limiting decoration work to the visible viewport — the key
 * to keeping large documents (thousands of lines) responsive.
 */

export interface LineWindow {
  startLine: number;
  endLine: number;
}

/**
 * Given the total line count and the first/last visible line, return a padded
 * inclusive window clamped to the document bounds.
 *
 * @param totalLines total number of lines in the document
 * @param firstVisible 0-based index of the first visible line
 * @param lastVisible  0-based index of the last visible line
 * @param padding      extra lines to render above/below for smooth scrolling
 */
export function viewportWindow(
  totalLines: number,
  firstVisible: number,
  lastVisible: number,
  padding = 50,
): LineWindow {
  const startLine = Math.max(0, Math.min(firstVisible, lastVisible) - padding);
  const endLine = Math.min(totalLines - 1, Math.max(firstVisible, lastVisible) + padding);
  return { startLine, endLine: Math.max(startLine, endLine) };
}

/** User-facing settings that influence rendering. */
export interface LivePreviewSettings {
  fontSize: number;
}

export const DEFAULT_SETTINGS: LivePreviewSettings = {
  fontSize: 14,
};

/** Merge partial settings (e.g. from settings.json) over the defaults. */
export function resolveSettings(partial?: Partial<LivePreviewSettings>): LivePreviewSettings {
  return {
    fontSize: clampFontSize(partial?.fontSize ?? DEFAULT_SETTINGS.fontSize),
  };
}

/**
 * Calculate the tab-local font size for one Ctrl/Cmd + mouse-wheel gesture.
 * Wheel magnitude is deliberately ignored so every gesture changes exactly
 * one pixel regardless of the device's delta scale.
 */
export function zoomFontSize(currentSize: number, deltaY: number): number {
  const size = clampFontSize(currentSize);
  if (!Number.isFinite(deltaY) || deltaY === 0) return size;
  return clampFontSize(size + (deltaY < 0 ? 1 : -1));
}

function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_SETTINGS.fontSize;
  return Math.max(8, Math.min(40, Math.round(size)));
}

// --- R-35: bidirectional vertical scroll sync (0-based line anchor) --------
//
// The sync key is the 0-based line number that should sit at the top of the
// viewport. These helpers are pure (no DOM/vscode dependency, ADR-0002) and are
// shared by the two directions:
//   - Webview → host: `.cm-scroller` scroll → top visible line → `revealRange`
//     on the standard source `TextEditor`(s) for the same URI.
//   - host → Webview: `onDidChangeTextEditorVisibleRanges` on the source
//     `TextEditor` → top visible line → CodeMirror scroll.
// Loop prevention is three-layered (Webview `applyingRemoteScroll` guard is
// implemented in `src/webview/main.ts`; the other two layers are the pure
// functions below, used by `src/livePreviewCustomEditorProvider.ts`):
//   1. Webview-side one-frame guard (not pure; see main.ts).
//   2. host-side time-based suppression window around a `revealRange` call, so
//      the `onDidChangeTextEditorVisibleRanges` echo it causes is not relayed
//      back to the Webview (`isEchoScroll`/`nextScrollSuppressUntil`).
//   3. host-side same-line dedupe against the last line synced in either
//      direction (`shouldRelayScrollLine`).

/** Default width (ms) of the host-side echo-suppression window opened right
 *  after a `revealRange` call triggered by a Webview scroll message. Wide
 *  enough to absorb the round trip of VS Code's own visible-range change
 *  event, narrow enough not to swallow a genuine, fast follow-up user scroll. */
export const SCROLL_SUPPRESS_WINDOW_MS = 200;

/** Width (ms) of the Webview-side suppression window opened right after a
 *  local edit (`syncPlugin`'s `update.docChanged`), during which
 *  `scheduleScrollReport` must not relay the `.cm-scroller` `scroll` event to
 *  the host as a user scroll (R-35-04). CodeMirror's caret-follow autoscroll
 *  and decoration-height changes triggered by the edit can otherwise fire a
 *  native `scroll` event that is indistinguishable from a genuine user
 *  scroll, causing the standard source editor (and this Webview) to jump.
 *  Reuses {@link SCROLL_SUPPRESS_WINDOW_MS} so a single constant covers both
 *  the host-side echo window and this Webview-side local-edit window; wide
 *  enough to cover CodeMirror's own measure/write (`requestMeasure`) cycle
 *  following the edit. */
export const LOCAL_EDIT_SCROLL_SUPPRESS_WINDOW_MS = SCROLL_SUPPRESS_WINDOW_MS;

/** Width (ms) of the host-side suppression window opened right after a
 *  `TextDocument` change (`onDidChangeTextDocument`, either a self-echo of our
 *  own WorkspaceEdit or an external edit made directly in the standard source
 *  editor), during which `onSourceVisibleRangesChanged` must not relay a
 *  source `TextEditor`'s visible-range change to the Webview as a user scroll
 *  (R-35-05). Editing a document (e.g. pressing Enter) can reflow the editor
 *  and/or move the caret-follow viewport, firing
 *  `onDidChangeTextEditorVisibleRanges` even though the user never scrolled;
 *  without this window that reflow was relayed to the Webview as a `scrollTo`,
 *  jumping the preview. Reuses {@link SCROLL_SUPPRESS_WINDOW_MS} so a single
 *  constant covers the host-side revealRange-echo window (R-35-02), the
 *  Webview-side local-edit window (R-35-04), and this host-side edit window. */
export const EDIT_SCROLL_SUPPRESS_WINDOW_MS = SCROLL_SUPPRESS_WINDOW_MS;

/** Clamp a (possibly out-of-range) 0-based line number to `[0, totalLines-1]`.
 *  `totalLines <= 0` clamps to `0` (a single, empty document line). */
export function clampScrollLine(line: number, totalLines: number): number {
  const maxLine = Math.max(0, totalLines - 1);
  if (!Number.isFinite(line)) return 0;
  return Math.max(0, Math.min(Math.round(line), maxLine));
}

/** The new suppression-window deadline (epoch ms) after issuing a `revealRange`
 *  at `now`, open for `windowMs` (default {@link SCROLL_SUPPRESS_WINDOW_MS}). */
export function nextScrollSuppressUntil(now: number, windowMs: number = SCROLL_SUPPRESS_WINDOW_MS): number {
  return now + Math.max(0, windowMs);
}

/** True while `now` falls inside a still-open suppression window (i.e. the
 *  incoming visible-range event is our own `revealRange` echo and must not be
 *  relayed to the Webview). `suppressUntil` of `undefined`/`0` means "no active
 *  window". */
export function isEchoScroll(now: number, suppressUntil: number | undefined): boolean {
  return typeof suppressUntil === 'number' && now < suppressUntil;
}

/** False when `line` is the same line most recently synced (in either
 *  direction), so a redundant relay is skipped; true otherwise. `lastSyncedLine`
 *  of `undefined` means "nothing synced yet" (always relay). */
export function shouldRelayScrollLine(line: number, lastSyncedLine: number | undefined): boolean {
  return lastSyncedLine === undefined || line !== lastSyncedLine;
}

/** Scale factor applied to the configured font size for on-screen display
 *  (R-28-17). The underlying `fontSize` setting/zoom baseline is unchanged;
 *  only the rendered `px` value is scaled up so the initial preview reads
 *  closer to a standard Markdown preview's default size. */
const DISPLAY_SCALE = 1.1;

/** Pure helper: the actual on-screen font size (px) for a given base font size
 *  setting, per {@link DISPLAY_SCALE} (R-28-17). */
export function displayFontSize(base: number): number {
  return Math.round(base * DISPLAY_SCALE);
}
