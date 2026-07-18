/**
 * Pure synchronisation helpers shared by the extension host and the Webview.
 *
 * These functions encode the decision logic for keeping a CodeMirror document,
 * the VS Code `TextDocument`, and external on-disk changes in agreement. They
 * are intentionally free of any VS Code / CodeMirror imports so they can be
 * unit-tested directly.
 */

export interface ResyncParams {
  /** True when the incoming change originated from the Webview itself. */
  isFromWebview: boolean;
  /** Text the Webview currently believes the document holds. */
  webviewText: string;
  /** New text of the underlying document. */
  documentText: string;
  /**
   * True when this change was produced by the extension host's own
   * `document.save()` call (e.g. trailing-whitespace trim, final-newline
   * insertion, format-on-save). Such self-inflicted rewrites must not be
   * echoed back to the Webview as an external change — otherwise the
   * cursor jumps back while the user is still typing.
   */
  isDuringOwnSave?: boolean;
  /**
   * True when {@link isSaveParticipantNormalization} determined that the
   * change is explainable purely by VS Code's built-in save participants
   * (trailing-whitespace trim, final-newline insertion). This is a
   * content-based complement to {@link isDuringOwnSave}'s time-based window:
   * some save-participant rewrites can land outside the `SelfSaveGuard`
   * window (e.g. under load), and without this check they would be
   * misdetected as an external change, intermittently snapping the cursor
   * back while the user is still typing.
   */
  isSaveNormalization?: boolean;
}

/**
 * Decide whether the Webview must reload its contents from the document.
 *
 * A change is a resync candidate whenever it did not originate from the Webview
 * and the document text differs from what the Webview believes it holds. This
 * covers both genuine external edits (Git pull, another editor) and
 * self-inflicted rewrites (save participants, format-on-save) — the two are
 * distinguished by {@link classifyDocumentChange}, which decides whether the
 * resync may discard CodeMirror history.
 */
export function shouldResync({
  isFromWebview,
  webviewText,
  documentText,
}: ResyncParams): boolean {
  if (isFromWebview) return false;
  return webviewText !== documentText;
}

/** Outcome of classifying a non-ledger document change. */
export interface DocumentChangeClassification {
  /** Whether the Webview must reload its contents from the document. */
  resync: boolean;
  /**
   * Whether the resync must keep CodeMirror's undo/redo history intact.
   *
   * `true` for self-save reconciliations (save participants / format-on-save
   * inside our own save window), whose rewrites should be folded into the
   * document without destroying the undo stack the user is still relying on.
   * `false` for genuine external changes (Git pull, another editor's real
   * content edit), which are authoritative and reset the history.
   */
  preserveHistory: boolean;
}

/**
 * Split a non-ledger document change into two independent decisions: whether to
 * resync at all, and — if so — whether the resync may discard CodeMirror
 * history.
 *
 * Any change that differs from the Webview text still resyncs. What changes is
 * how: self-save echoes ({@link ResyncParams.isDuringOwnSave} or
 * {@link ResyncParams.isSaveNormalization}) reconcile while preserving history,
 * so a little typing pause that triggers a debounced save no longer throws away
 * the user's undo stack. Only true external changes reset the history.
 */
export function classifyDocumentChange({
  isFromWebview,
  webviewText,
  documentText,
  isDuringOwnSave,
  isSaveNormalization,
}: ResyncParams): DocumentChangeClassification {
  if (!shouldResync({ isFromWebview, webviewText, documentText })) {
    return { resync: false, preserveHistory: false };
  }
  const preserveHistory = Boolean(isDuringOwnSave) || Boolean(isSaveNormalization);
  return { resync: true, preserveHistory };
}

/**
 * Normalise text the way VS Code's built-in save participants deterministically
 * do: strip trailing whitespace (spaces/tabs) from every line, and ignore
 * whether the text ends with a trailing newline.
 */
function normalizeForSaveParticipants(text: string): string {
  // Ignore any run of trailing newlines so both `files.insertFinalNewline`
  // (adds one) and `files.trimFinalNewlines` (removes extras) are covered.
  const withoutTrailingEol = text.replace(/(?:\r\n|\n)+$/, '');
  return withoutTrailingEol
    .split(/\r\n|\n/)
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
}

/**
 * Decide whether a document change can be fully explained by VS Code's
 * built-in save participants (`files.trimTrailingWhitespace` /
 * `files.insertFinalNewline`) rather than by a real external edit.
 *
 * This is a timing-independent, content-based check: it returns `true` only
 * when the two texts differ, but become identical once trailing whitespace
 * per line and a trailing final newline are ignored. Any genuine content
 * difference (Git pull, another editor's edits, etc.) makes this `false`, so
 * true external edits still trigger a resync.
 */
export function isSaveParticipantNormalization(webviewText: string, documentText: string): boolean {
  if (webviewText === documentText) return false;
  return normalizeForSaveParticipants(webviewText) === normalizeForSaveParticipants(documentText);
}

/** Which document snapshot a queued change listener must reconcile. */
export type DocumentChangeSnapshotSource = 'event' | 'document-after-flush';

export interface DocumentChangeSyncPlan {
  /** Whether a pending edit existed when the document event was observed. */
  flushPendingEdit: boolean;
  /** Preserve the event-time distinction between save normalization and a true external edit. */
  isSaveNormalization: boolean;
  /**
   * Save-normalization event text becomes stale when a pending Webview edit is
   * flushed ahead of it, so that path must re-read the bound TextDocument.
   * A true external edit remains authoritative and must retain its event-time
   * snapshot even after the local pending edit has been flushed.
   */
  snapshotSource: DocumentChangeSnapshotSource;
}

/**
 * Plan how a non-ledger document-change event is reconciled with a pending
 * Webview edit.
 *
 * The event's origin is classified synchronously, before the operation queue
 * can drain and `SelfSaveGuard` can close. Save-normalization snapshots are
 * re-read after the pending edit's apply/save flush; otherwise their stale
 * event text could be sent with the newly advanced acknowledgement version and
 * roll CodeMirror back. Genuine external snapshots are retained because they
 * are authoritative even when the local pending edit is flushed first.
 */
export function planDocumentChangeSync(params: {
  hasPendingEdit: boolean;
  isDuringOwnSave: boolean;
  webviewText: string;
  documentText: string;
}): DocumentChangeSyncPlan {
  const isSaveNormalization =
    params.isDuringOwnSave || isSaveParticipantNormalization(params.webviewText, params.documentText);
  return {
    flushPendingEdit: params.hasPendingEdit,
    isSaveNormalization,
    snapshotSource:
      params.hasPendingEdit && isSaveNormalization ? 'document-after-flush' : 'event',
  };
}

/**
 * True when two LF-normalised texts are identical except for the number of
 * trailing newlines at the very end of the document.
 *
 * This isolates the one save-participant transform that cannot be reflected
 * into CodeMirror as a history-preserving change without corrupting undo:
 * `files.insertFinalNewline` / `files.trimFinalNewlines`. Such a transform
 * *adds or removes a character at the document boundary*, outside any of the
 * user's undoable edit ranges. Applying it out-of-history (see
 * {@link computeRemotePatch} + `Transaction.addToHistory.of(false)`) leaves the
 * inserted newline stranded when the user later undoes an earlier edit: the
 * inverse change maps around the boundary newline instead of removing it,
 * inserting a blank line and breaking monotonic undo. Trailing-*whitespace*
 * trimming does not have this problem because it edits *within* the range the
 * user just typed, so undoing that edit cleans it up.
 *
 * Callers use this to reconcile host bookkeeping for a final-newline-only save
 * echo without pushing it into CodeMirror, keeping the Webview the sole owner
 * of user content while the final newline stays a save-time concern.
 */
export function isTrailingNewlineOnlyDifference(a: string, b: string): boolean {
  if (a === b) return false;
  return a.replace(/\n+$/, '') === b.replace(/\n+$/, '');
}

/** A line/character position (0-based), mirroring vscode.Position. */
export interface Pos {
  line: number;
  character: number;
}

export interface TextRange {
  start: Pos;
  end: Pos;
}

/**
 * Compute the minimal replaced range between two strings so we can apply a
 * single `WorkspaceEdit` instead of replacing the whole document (which would
 * blow away VS Code's undo granularity).
 */
export function diffRange(oldText: string, newText: string): { range: TextRange; newText: string } | null {
  if (oldText === newText) return null;

  // Common prefix length.
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) start++;

  // Common suffix length (not overlapping the prefix).
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  return {
    range: {
      start: offsetToPos(oldText, start),
      end: offsetToPos(oldText, oldEnd),
    },
    newText: newText.slice(start, newEnd),
  };
}

/** Convert an absolute offset into a {line, character} position. */
export function offsetToPos(text: string, offset: number): Pos {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

/** A minimal remote patch plus the selection remapped through it. */
export interface RemotePatch {
  /** Start offset of the replaced range (common-prefix length). */
  from: number;
  /** End offset of the replaced range in the old text. */
  to: number;
  /** Replacement text for `[from, to)`. */
  insert: string;
  /** Primary selection anchor remapped into the new text. */
  anchor: number;
  /** Primary selection head remapped into the new text. */
  head: number;
}

/**
 * Compute the minimal single-range patch that turns `oldText` into `newText`,
 * together with the primary selection remapped so that applying a host resync
 * never rolls the caret back *before* the typing position.
 *
 * CodeMirror's default change mapping collapses a selection that sits inside a
 * replaced range to that range's start, which — when a save/format echo
 * replaces the line the user is typing on — snaps the caret backwards. To
 * avoid that, a caret inside the replaced region is anchored to the region's
 * trailing edge (its distance from the region end is preserved), and a caret
 * in the unchanged suffix is shifted by the length delta. A caret in the
 * unchanged prefix is left untouched. The result therefore keeps the caret at
 * its equivalent logical position instead of moving it earlier in the text.
 */
export function computeRemotePatch(
  oldText: string,
  newText: string,
  sel: { anchor: number; head: number },
): RemotePatch {
  // Common prefix length.
  let from = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (from < minLen && oldText[from] === newText[from]) from++;

  // Common suffix length (not overlapping the prefix).
  let toOld = oldText.length;
  let toNew = newText.length;
  while (toOld > from && toNew > from && oldText[toOld - 1] === newText[toNew - 1]) {
    toOld--;
    toNew--;
  }

  const map = (pos: number): number => {
    if (pos <= from) return pos; // unchanged prefix
    if (pos >= toOld) return pos + (toNew - toOld); // unchanged suffix, shift by delta
    // Inside the replaced region: keep the caret pinned to the region's
    // trailing edge so a resync never moves it before the typing position.
    const fromRegionEnd = toOld - pos;
    return Math.max(from, toNew - fromRegionEnd);
  };

  return {
    from,
    to: toOld,
    insert: newText.slice(from, toNew),
    anchor: map(sel.anchor),
    head: map(sel.head),
  };
}

/**
 * Expand a selection (anchor/head offsets) into the set of 0-based line indices
 * that should display raw Markdown. Lines touched by any selection are included.
 */
export function cursorLinesFromSelections(
  text: string,
  selections: { from: number; to: number }[],
): Set<number> {
  const lineStarts = computeLineStarts(text);
  const set = new Set<number>();
  for (const sel of selections) {
    const from = Math.min(sel.from, sel.to);
    const to = Math.max(sel.from, sel.to);
    const startLine = lineAt(lineStarts, from);
    const endLine = lineAt(lineStarts, to);
    for (let l = startLine; l <= endLine; l++) set.add(l);
  }
  return set;
}

/**
 * Whether a CodeMirror document change should be pushed to the host *now*.
 *
 * During IME composition (Japanese/CJK conversion) we must NOT emit edits — the
 * intermediate, un-confirmed characters would cause the decorations to flicker
 * and the host document to churn. We defer until composition ends.
 */
export function shouldEmitEdit(params: { docChanged: boolean; composing: boolean; applyingRemote: boolean }): boolean {
  if (!params.docChanged) return false;
  if (params.applyingRemote) return false;
  if (params.composing) return false;
  return true;
}

/** Decide whether an update received from the host is safe to apply. */
export function shouldApplyRemoteUpdate(params: {
  baseVersion: number | undefined;
  /** Current locally emitted Webview version. `localVersion` is kept for tests from older releases. */
  editVersion?: number;
  localVersion?: number;
  /** Last host acknowledgement received by the Webview. */
  ackVersion?: number;
  composing: boolean;
  /** A document change exists locally but has not yet been emitted (IME). */
  pendingLocalChange?: boolean;
  /** A failed WorkspaceEdit rollback is authoritative for its failed version. */
  rollback?: boolean;
}): boolean {
  if (params.composing) return false;
  if (params.pendingLocalChange) return false;

  const editVersion = params.editVersion ?? params.localVersion ?? 0;
  // Before the ack protocol existed, callers only tracked one local version.
  // Retain that behaviour for the pure helper's old call signature, while all
  // Webview production calls provide the independently tracked acknowledgement.
  const ackVersion = params.ackVersion ?? editVersion;
  if (typeof params.baseVersion !== 'number') {
    // Legacy unversioned updates are safe only while there is no local work
    // awaiting acknowledgement.
    return editVersion === ackVersion;
  }
  if (params.rollback) {
    return params.baseVersion === editVersion && ackVersion <= editVersion;
  }
  return params.baseVersion === editVersion && params.baseVersion === ackVersion;
}

/** Decide whether an IME composition change deferred by the Webview should be sent. */
export function shouldFlushComposition(params: {
  composing: boolean;
  pendingCompositionChange: boolean;
  applyingRemote: boolean;
}): boolean {
  return !params.composing && params.pendingCompositionChange && !params.applyingRemote;
}

/**
 * Advance the host acknowledgement only after a Webview edit is known to be
 * represented by the TextDocument.  Receiving an edit is deliberately not an
 * acknowledgement: `workspace.applyEdit()` is asynchronous, and advertising
 * its version early lets an older document event overwrite newer local input.
 */
export function appliedEditVersion(params: {
  previousVersion: number;
  receivedVersion: unknown;
  completed: boolean;
}): number {
  if (!params.completed || typeof params.receivedVersion !== 'number') return params.previousVersion;
  return Math.max(params.previousVersion, params.receivedVersion);
}

/** True only for a fresh, monotonically increasing Webview edit version. */
export function acceptsWebviewEditVersion(params: {
  lastReceivedVersion: number;
  receivedVersion: unknown;
}): params is { lastReceivedVersion: number; receivedVersion: number } {
  return (
    typeof params.receivedVersion === 'number' &&
    Number.isSafeInteger(params.receivedVersion) &&
    params.receivedVersion > params.lastReceivedVersion
  );
}

/**
 * The identity of a single expected `WorkspaceEdit` document-change event.
 * Text and TextDocument version are intentionally both required: matching
 * text alone can accidentally swallow a real external change whose contents
 * happen to equal a previous local snapshot.
 */
export interface ExpectedWorkspaceEditChange {
  editVersion: number;
  documentVersion: number;
  text: string;
}

/** Consume exactly the expected self echo from a version-keyed ledger. */
export function consumeExpectedWorkspaceEditChange(params: {
  ledger: ReadonlyMap<number, ExpectedWorkspaceEditChange>;
  documentVersion: number;
  documentText: string;
}): number | undefined {
  for (const [version, expected] of params.ledger) {
    if (expected.documentVersion === params.documentVersion && expected.text === params.documentText) {
      return version;
    }
  }
  return undefined;
}

/**
 * Version to attach to an authoritative rollback after a failed edit.  A
 * client that has already produced a newer edit will reject this old rollback,
 * while the client that sent the failed edit can still accept it.
 */
export function failedEditBaseVersion(params: { appliedVersion: number; failedVersion: unknown }): number {
  return typeof params.failedVersion === 'number'
    ? Math.max(params.appliedVersion, params.failedVersion)
    : params.appliedVersion;
}

/** Normalise any CRLF/CR to LF (the convention used on the webview/CodeMirror side). */
export function toLF(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Convert LF text to the given end-of-line sequence (to preserve a file's EOL). */
export function fromLF(text: string, eol: '\n' | '\r\n'): string {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

/**
 * Convert LF text back to document text while preserving each existing line's
 * original EOL. New lines that have no counterpart use the document EOL.
 */
export function fromLFPreserving(
  newLF: string,
  oldText: string,
  fallbackEol: '\n' | '\r\n',
): string {
  const oldEols: ('\n' | '\r\n')[] = [];
  for (const match of oldText.matchAll(/\r\n|\n/g)) {
    oldEols.push(match[0] as '\n' | '\r\n');
  }
  const newLines = newLF.split('\n');
  let result = '';
  for (let line = 0; line < newLines.length; line++) {
    result += newLines[line];
    if (line < newLines.length - 1) {
      result += oldEols[line] ?? fallbackEol;
    }
  }
  return result;
}

/** Result of {@link toggleTaskAt}. */
export interface ToggleResult {
  /** The full document text after toggling (unchanged if the line is not a task). */
  text: string;
  /** Whether a task checkbox was actually toggled. */
  changed: boolean;
  /** New checked state (only meaningful when `changed`). */
  checked: boolean;
}

/**
 * Toggle the task checkbox on a given 0-based line: `- [ ]` ⇄ `- [x]`.
 * Pure: returns the new document text without mutating the input. Lines that are
 * not task items are returned unchanged.
 */
export function toggleTaskAt(doc: string, line: number): ToggleResult {
  const lines = doc.split('\n');
  if (line < 0 || line >= lines.length) return { text: doc, changed: false, checked: false };
  // Tolerate a trailing CR so CRLF documents still match.
  const m = /^(\s*[-*+]\s+\[)([ xX])(\][\s\S]*?)(\r?)$/.exec(lines[line]);
  if (!m) return { text: doc, changed: false, checked: false };
  const nowChecked = m[2].toLowerCase() === 'x';
  const next = nowChecked ? ' ' : 'x';
  lines[line] = m[1] + next + m[3] + m[4];
  return { text: lines.join('\n'), changed: true, checked: !nowChecked };
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(lineStarts: number[], offset: number): number {
  // Binary search for the greatest lineStart <= offset.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
