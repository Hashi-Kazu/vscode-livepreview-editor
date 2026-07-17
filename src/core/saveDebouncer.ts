/**
 * Coalesces the persistence (`document.save()`) of a live-preview binding.
 *
 * Webview edits apply their `WorkspaceEdit` immediately (R-04-01), but saving
 * on every keystroke makes save participants / format-on-save run per key,
 * whose asynchronous echoes can be misdetected as external changes and roll the
 * caret back (R-03-08 / R-04-02). This debouncer defers the save until the edit
 * stream has been idle for a short interval, collapsing a burst of edits into a
 * single save, and exposes {@link flush} so callers can force any pending save
 * on deactivation, disposal, or binding switch (guaranteeing durability).
 *
 * Kept free of any VS Code import so it can be unit-tested directly with an
 * injected scheduler / fake timers.
 */
export class SaveDebouncer {
  private dirty = false;
  private cancel: (() => void) | undefined;

  /**
   * @param save     Persists the document. Invoked at most once per idle burst.
   * @param schedule Schedules `callback` after the idle interval and returns a
   *                 canceller. Defaults to a `setTimeout`-based scheduler.
   */
  constructor(
    private readonly save: () => void,
    private readonly schedule: (callback: () => void) => () => void = (callback) => {
      const timer = setTimeout(callback, SaveDebouncer.IDLE_MS);
      return () => clearTimeout(timer);
    },
  ) {}

  /** Idle window (ms) after the last edit before an automatic save fires. */
  static readonly IDLE_MS = 400;

  /** Mark unsaved content and (re)start the idle timer, coalescing a burst. */
  request(): void {
    this.dirty = true;
    this.cancel?.();
    this.cancel = this.schedule(() => {
      this.cancel = undefined;
      this.run();
    });
  }

  /** Force any pending save to run now (deactivation / disposal / bind switch). */
  flush(): void {
    this.cancel?.();
    this.cancel = undefined;
    this.run();
  }

  private run(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.save();
  }
}
