/**
 * Tracks whether the extension host is currently suppressing echoes of its own
 * `document.save()` call.
 *
 * `document.save()` resolving does not mean save participants (trim trailing
 * whitespace, insert final newline, format on save, etc.) have finished
 * rewriting the document — their resulting `onDidChangeTextDocument` events
 * can arrive on a later microtask/task. To avoid mistaking those events for an
 * external change (which would echo an `update` to the Webview and roll the
 * caret back), suppression must remain active until at least one microtask
 * and one macrotask after `end()` has elapsed, unless a newer `begin()`
 * supersedes it first.
 *
 * Kept free of any VS Code import so it can be unit-tested directly with fake
 * timers / injected schedulers.
 */
export class SelfSaveGuard {
  private seq = 0;
  private active = false;
  private pendingToken = 0;

  constructor(private readonly schedule: (callback: () => void) => void = (cb) => setTimeout(cb, 0)) {}

  /** Call before starting a `document.save()`. Returns a token to pass to {@link end}. */
  begin(): number {
    this.active = true;
    this.pendingToken = 0;
    return ++this.seq;
  }

  /**
   * Call once the `document.save()` promise (and any awaited follow-up)
   * settles. Suppression is not cleared synchronously: it remains active
   * until a microtask followed by a scheduled macrotask has elapsed, so
   * save-participant rewrites arriving in that window are still suppressed.
   * If a newer `begin()` has been issued since `token` was obtained, this
   * call is a no-op (the newer save owns the suppression window).
   */
  end(token: number): void {
    if (token !== this.seq) return;
    this.pendingToken = token;
    queueMicrotask(() => {
      this.schedule(() => {
        if (this.pendingToken === token && token === this.seq) {
          this.active = false;
        }
      });
    });
  }

  /** True while an own-save suppression window is in effect. */
  get isActive(): boolean {
    return this.active;
  }
}
