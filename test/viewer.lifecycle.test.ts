import { describe, expect, it } from 'vitest';
import { decideFollow, findViewerForUri, isCurrentBinding } from '../src/core/viewer';

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
