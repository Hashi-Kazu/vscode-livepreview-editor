/**
 * Pure viewer lifecycle decisions. This module deliberately has no VS Code
 * imports so duplicate/follow/switch behavior can be unit-tested directly.
 */

export interface ViewerState {
  id: string;
  uri: string;
}

export type FollowDecision =
  | { type: 'none' }
  | { type: 'use-existing'; viewerId: string }
  | { type: 'switch'; viewerId: string };

export interface PendingViewerFocusRestore {
  viewerId: string;
  uri: string;
}

/**
 * Pick the viewer affected by an active-editor follow event.
 *
 * An existing viewer for the URI always wins (duplicate prevention). Otherwise
 * the most recently interacted viewer is rebound. Following never creates a
 * viewer by itself.
 */
export function decideFollow(
  viewers: readonly ViewerState[],
  targetUri: string,
  lastInteractedViewerId: string | undefined,
): FollowDecision {
  const existing = viewers.find((viewer) => viewer.uri === targetUri);
  if (existing) return { type: 'use-existing', viewerId: existing.id };

  if (!lastInteractedViewerId) return { type: 'none' };
  const target = viewers.find((viewer) => viewer.id === lastInteractedViewerId);
  return target ? { type: 'switch', viewerId: target.id } : { type: 'none' };
}

/**
 * Consume a one-shot focus restore request captured when a viewer was active
 * immediately before a Markdown source editor became active.
 */
export function decideFocusRestoreViewer(
  decision: FollowDecision,
  targetUri: string,
  pending: PendingViewerFocusRestore | undefined,
): string | undefined {
  if (!pending || pending.uri === targetUri) return undefined;
  if (decision.type === 'none') return undefined;
  return decision.viewerId;
}

/** Return the existing owner of a URI so callers never create a duplicate. */
export function findViewerForUri(
  viewers: readonly ViewerState[],
  targetUri: string,
): string | undefined {
  return viewers.find((viewer) => viewer.uri === targetUri)?.id;
}

/** Ignore delayed webview messages emitted for a previous document binding. */
export function isCurrentBinding(messageBinding: number, currentBinding: number): boolean {
  return Number.isInteger(messageBinding) && messageBinding === currentBinding;
}
