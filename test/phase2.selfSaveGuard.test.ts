import { describe, it, expect } from 'vitest';
import { SelfSaveGuard } from '../src/core/selfSaveGuard';

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
});
