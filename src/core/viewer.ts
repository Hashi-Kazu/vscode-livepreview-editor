/**
 * Pure viewer lifecycle decisions. This module deliberately has no VS Code
 * imports so duplicate/follow/switch behavior can be unit-tested directly.
 */

export interface ViewerState {
  id: string;
  uri: string;
}

export type ViewerFileEvent =
  | {
      type: 'rename';
      files: readonly { oldUri: string; newUri: string }[];
    }
  | {
      type: 'delete';
      uris: readonly string[];
    };

export type FileEventAction =
  | { type: 'rebind'; viewerId: string; oldKey: string; newKey: string }
  | { type: 'close'; viewerId: string };

export type FollowDecision =
  | { type: 'none' }
  | { type: 'use-existing'; viewerId: string }
  | { type: 'switch'; viewerId: string };

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

/** Return the existing owner of a URI so callers never create a duplicate. */
export function findViewerForUri(
  viewers: readonly ViewerState[],
  targetUri: string,
): string | undefined {
  return viewers.find((viewer) => viewer.uri === targetUri)?.id;
}

/** Decide how open viewers follow workspace rename and delete events. */
export function decideFileEventAction(
  viewers: readonly ViewerState[],
  event: ViewerFileEvent,
): FileEventAction[] {
  if (event.type === 'delete') {
    const deleted = new Set(event.uris);
    return viewers
      .filter((viewer) => deleted.has(viewer.uri))
      .map((viewer) => ({ type: 'close' as const, viewerId: viewer.id }));
  }

  const owners = new Map(viewers.map((viewer) => [viewer.uri, viewer]));
  const actions: FileEventAction[] = [];
  for (const file of event.files) {
    const viewer = owners.get(file.oldUri);
    if (!viewer) continue;
    const newOwner = owners.get(file.newUri);
    if (newOwner && newOwner.id !== viewer.id) {
      actions.push({ type: 'close', viewerId: viewer.id });
    } else {
      actions.push({
        type: 'rebind',
        viewerId: viewer.id,
        oldKey: file.oldUri,
        newKey: file.newUri,
      });
    }
  }
  return actions;
}

/** Ignore delayed webview messages emitted for a previous document binding. */
export function isCurrentBinding(messageBinding: number, currentBinding: number): boolean {
  return Number.isInteger(messageBinding) && messageBinding === currentBinding;
}

/**
 * Decide whether a `dirty` state notification (R-31) may be sent to a
 * Webview: it must not be disposed, and the binding that produced the dirty
 * value must still be the viewer's current binding (guards against a stale
 * async `openTextDocument` resolving after a binding switch/dispose).
 */
export function shouldPostDirtyState(
  disposed: boolean | undefined,
  bindingGeneration: number,
  currentBindingGeneration: number,
): boolean {
  return !disposed && bindingGeneration === currentBindingGeneration;
}
