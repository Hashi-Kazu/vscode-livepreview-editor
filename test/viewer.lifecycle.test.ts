import { describe, expect, it } from 'vitest';
import {
  decideFocusRestoreViewer,
  decideFollow,
  findViewerForUri,
  isCurrentBinding,
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

describe('R-03: viewer focus restoration after source switching', () => {
  it('R-03-05/R-03-09 restores focus to the viewer switched from the previously active viewer', () => {
    const decision = decideFollow(viewers, 'file:///workspace/three.md', 'two');

    expect(
      decideFocusRestoreViewer(decision, 'file:///workspace/three.md', {
        viewerId: 'two',
        uri: 'file:///workspace/two.md',
      }),
    ).toBe('two');
  });

  it('R-03-05/R-03-09 restores focus to an existing viewer that already owns the target URI', () => {
    const decision = decideFollow(viewers, 'file:///workspace/one.md', 'two');

    expect(
      decideFocusRestoreViewer(decision, 'file:///workspace/one.md', {
        viewerId: 'two',
        uri: 'file:///workspace/two.md',
      }),
    ).toBe('one');
  });

  it('R-03-05/R-03-09 does not restore focus for standard-editor switching without viewer context', () => {
    const decision = decideFollow(viewers, 'file:///workspace/three.md', 'two');

    expect(decideFocusRestoreViewer(decision, 'file:///workspace/three.md', undefined)).toBeUndefined();
  });

  it('R-03-05/R-03-09 does not restore focus when the active source is the same Markdown URI', () => {
    const decision = decideFollow(viewers, 'file:///workspace/two.md', 'two');

    expect(
      decideFocusRestoreViewer(decision, 'file:///workspace/two.md', {
        viewerId: 'two',
        uri: 'file:///workspace/two.md',
      }),
    ).toBeUndefined();
  });
});

describe('R-03: deferred document switching', () => {
  it('accepts messages only for the current binding generation', () => {
    expect(isCurrentBinding(4, 4)).toBe(true);
    expect(isCurrentBinding(3, 4)).toBe(false);
    expect(isCurrentBinding(Number.NaN, 4)).toBe(false);
  });
});
