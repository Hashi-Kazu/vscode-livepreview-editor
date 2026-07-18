import { describe, expect, it } from 'vitest';
import {
  decideFileEventAction,
  decideFollow,
  findViewerForUri,
  isCurrentBinding,
  shouldPostDirtyState,
} from '../src/core/viewer';

const viewers = [
  { id: 'one', uri: 'file:///workspace/one.md' },
  { id: 'two', uri: 'file:///workspace/two.md' },
];

describe('R-03: viewer duplicate prevention', () => {
  it('finds the existing viewer that owns a URI', () => {
    expect(findViewerForUri(viewers, 'file:///workspace/two.md')).toBe('two');
    expect(findViewerForUri(viewers, 'file:///workspace/three.md')).toBeUndefined();
  });
});

describe('R-03: active editor following', () => {
  it('returns the existing URI owner as the follow target, overriding the last-interacted viewer', () => {
    expect(decideFollow(viewers, 'file:///workspace/one.md', 'two')).toEqual({
      type: 'use-existing',
      viewerId: 'one',
    });
  });

  it('switches the last-interacted viewer for a new URI', () => {
    expect(decideFollow(viewers, 'file:///workspace/three.md', 'two')).toEqual({
      type: 'switch',
      viewerId: 'two',
    });
  });

  it('does not create a viewer when none has been interacted with', () => {
    expect(decideFollow([], 'file:///workspace/one.md', undefined)).toEqual({ type: 'none' });
  });
});

describe('R-03: deferred document switching', () => {
  it('accepts messages only for the current binding generation', () => {
    expect(isCurrentBinding(4, 4)).toBe(true);
    expect(isCurrentBinding(3, 4)).toBe(false);
    expect(isCurrentBinding(Number.NaN, 4)).toBe(false);
  });
});

describe('R-03-10: file lifecycle events', () => {
  it('decideFileEventAction rebinds on rename and closes on delete', () => {
    expect(
      decideFileEventAction(viewers, {
        type: 'rename',
        files: [
          {
            oldUri: 'file:///workspace/one.md',
            newUri: 'file:///workspace/renamed.md',
          },
        ],
      }),
    ).toEqual([
      {
        type: 'rebind',
        viewerId: 'one',
        oldKey: 'file:///workspace/one.md',
        newKey: 'file:///workspace/renamed.md',
      },
    ]);

    expect(
      decideFileEventAction(viewers, {
        type: 'rename',
        files: [
          {
            oldUri: 'file:///workspace/one.md',
            newUri: 'file:///workspace/two.md',
          },
        ],
      }),
    ).toEqual([{ type: 'close', viewerId: 'one' }]);

    expect(
      decideFileEventAction(viewers, {
        type: 'delete',
        uris: ['file:///workspace/two.md'],
      }),
    ).toEqual([{ type: 'close', viewerId: 'two' }]);

    expect(
      decideFileEventAction(viewers, {
        type: 'delete',
        uris: ['file:///workspace/other.md'],
      }),
    ).toEqual([]);
  });
});

describe('R-31-01: unsaved indicator send guard', () => {
  it('sends only when the viewer is not disposed and the binding is still current', () => {
    expect(shouldPostDirtyState(false, 4, 4)).toBe(true);
    expect(shouldPostDirtyState(true, 4, 4)).toBe(false);
    expect(shouldPostDirtyState(undefined, 4, 4)).toBe(true);
    expect(shouldPostDirtyState(false, 3, 4)).toBe(false);
  });
});
