/**
 * Host-only reader for the Windows OS file clipboard (the file list produced by
 * Explorer's Ctrl+C). Webviews cannot read the OS file clipboard, so the
 * extension host shells out to Windows PowerShell, which exposes
 * `System.Windows.Forms.Clipboard.GetFileDropList()`.
 *
 * This module is host-only: it imports `child_process` and therefore must never
 * be pulled into the Webview bundle. The JSON parsing is delegated to the pure,
 * Webview-safe {@link parseClipboardFileListJson} so this file stays a thin I/O
 * wrapper.
 */
import { execFile } from 'child_process';
import { parseClipboardFileListJson } from '../core/pasteLink';

/**
 * PowerShell script that prints the clipboard file-drop list as compact JSON.
 * `-STA` (set by the caller) is required for the clipboard COM APIs, and
 * forcing UTF-8 console output avoids CP932 mojibake for Japanese paths. The
 * `@($list)` wrapper guarantees an array even for a single entry.
 */
const CLIPBOARD_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$list = [System.Windows.Forms.Clipboard]::GetFileDropList()',
  'ConvertTo-Json -Compress -InputObject (@($list))',
].join('\n');

/**
 * Read the absolute paths of files/folders currently on the Windows clipboard.
 * Returns `[]` (never throws) on any failure — PowerShell missing, timeout,
 * non-zero exit, or unparseable output — so callers can surface a single
 * user-facing warning without special-casing errors.
 *
 * Callers must ensure `process.platform === 'win32'` before invoking this; it
 * launches an external process unconditionally.
 */
export function readClipboardFiles(): Promise<string[]> {
  // Pass the script as an UTF-16LE Base64 `-EncodedCommand` so Japanese
  // characters, spaces, and quotes survive argument parsing intact.
  const encoded = Buffer.from(CLIPBOARD_SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-STA', '-EncodedCommand', encoded],
        { windowsHide: true, timeout: 5000, encoding: 'buffer', maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve([]);
            return;
          }
          const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout ?? '');
          resolve(parseClipboardFileListJson(text));
        },
      );
    } catch {
      resolve([]);
    }
  });
}
