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
