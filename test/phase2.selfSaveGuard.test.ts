import { describe, it, expect } from 'vitest';
import { SelfSaveGuard } from '../src/core/selfSaveGuard';
import { shouldResync } from '../src/core/sync';

/**
 * A controllable "macrotask" scheduler: callbacks are queued and only run when
 * `flush()` is called, letting tests deterministically step through the
 * microtask + macrotask window `SelfSaveGuard.end()` defers into.
 */
function makeFakeScheduler() {
  const queue: (() => void)[] = [];
  return {
    schedule: (cb: () => void) => {
      queue.push(cb);
    },
    flush: () => {
      const pending = queue.splice(0, queue.length);
      for (const cb of pending) cb();
    },
  };
}

describe('Phase 2: SelfSaveGuard (R-04-02 self-save echo suppression)', () => {
  it('keeps suppression active across the microtask+macrotask following save', async () => {
    const fake = makeFakeScheduler();
    const guard = new SelfSaveGuard(fake.schedule);

    const token = guard.begin();
    expect(guard.isActive).toBe(true);

    guard.end(token);
    // Synchronously after end(), suppression must still hold: save
    // participants' change events can arrive on a later turn.
    expect(guard.isActive).toBe(true);

    // Let the queued microtask (which schedules the macrotask) run.
    await Promise.resolve();
    expect(guard.isActive).toBe(true);

    fake.flush();
    expect(guard.isActive).toBe(false);
  });

  it('clears suppression after the deferred turn when no newer save intervenes', async () => {
    const fake = makeFakeScheduler();
    const guard = new SelfSaveGuard(fake.schedule);

    const token = guard.begin();
    guard.end(token);
    await Promise.resolve();
    fake.flush();

    expect(guard.isActive).toBe(false);
  });

  it('does NOT clear when a newer begin() supersedes the pending end()', async () => {
    const fake = makeFakeScheduler();
    const guard = new SelfSaveGuard(fake.schedule);

    const firstToken = guard.begin();
    guard.end(firstToken);
    await Promise.resolve();

    // A second save starts before the first end()'s deferred clear fires.
    const secondToken = guard.begin();
    expect(guard.isActive).toBe(true);

    // Flushing the stale scheduled callback from the first end() must not
    // clear suppression, since a newer begin() has since taken over.
    fake.flush();
    expect(guard.isActive).toBe(true);

    guard.end(secondToken);
    await Promise.resolve();
    fake.flush();
    expect(guard.isActive).toBe(false);
  });

  it('suppresses save-participant echo across a save window driven by will/did-save, including saves initiated by another editor of the same document', async () => {
    const fake = makeFakeScheduler();
    const guard = new SelfSaveGuard(fake.schedule);

    // Simulate onWillSaveTextDocument firing for a save initiated by another
    // editor of the same document (e.g. autosave / manual save / format on
    // save from a separate text editor tab).
    const token = guard.begin();
    expect(guard.isActive).toBe(true);

    // Simulate onDidSaveTextDocument firing once VS Code reports the save
    // complete. Suppression must still hold for the microtask+macrotask tail
    // so save-participant rewrites (trim trailing whitespace, insert final
    // newline, etc.) that arrive slightly after did-save are not echoed.
    guard.end(token);
    expect(
      shouldResync({
        isFromWebview: false,
        isDuringOwnSave: guard.isActive,
        webviewText: 'abc ',
        documentText: 'abc',
      }),
    ).toBe(false);

    await Promise.resolve();
    expect(
      shouldResync({
        isFromWebview: false,
        isDuringOwnSave: guard.isActive,
        webviewText: 'abc ',
        documentText: 'abc',
      }),
    ).toBe(false);

    fake.flush();
    expect(guard.isActive).toBe(false);

    // Once the save window has fully elapsed, a genuine external edit must
    // still trigger a resync (external change detection is preserved).
    expect(
      shouldResync({
        isFromWebview: false,
        isDuringOwnSave: guard.isActive,
        webviewText: 'old',
        documentText: 'new',
      }),
    ).toBe(true);
  });
});
