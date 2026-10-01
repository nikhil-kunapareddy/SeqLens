/**
 * Local file export.
 *
 * Everything is written through a Blob and an object URL, which the browser
 * saves to the user's own download location. No upload endpoint exists anywhere
 * in SeqLens, so this module is the only way data leaves the application - and
 * it only ever leaves to the local filesystem.
 *
 * Where the File System Access API is available it is preferred, because it
 * lets the user choose a destination and overwrite an existing file rather than
 * accumulating `report (3).html` in Downloads.
 */

export interface SaveOptions {
  suggestedName: string;
  mimeType: string;
  /** Picker description and extensions, used by the File System Access path. */
  description?: string;
  extensions?: string[];
}

interface FileSystemPickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

interface FileSystemFileHandleLike {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}

type ShowSaveFilePicker = (options: FileSystemPickerOptions) => Promise<FileSystemFileHandleLike>;

const saveFilePicker = (): ShowSaveFilePicker | null => {
  const candidate = (globalThis as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  return typeof candidate === 'function' ? candidate : null;
};

export const supportsFileSystemAccess = (): boolean => saveFilePicker() !== null;

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

/**
 * Saves content locally, preferring a save dialog over a download.
 *
 * A user cancelling the picker is a normal outcome, not an error, and is
 * reported as such so callers do not show a failure message.
 */
export async function saveFile(
  content: string | Blob,
  options: SaveOptions,
): Promise<SaveOutcome> {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: options.mimeType });

  const picker = saveFilePicker();
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: options.suggestedName,
        types: [
          {
            description: options.description ?? 'File',
            accept: { [options.mimeType]: options.extensions ?? [] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (error) {
      // AbortError means the user dismissed the dialog.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Anything else (a SecurityError in a sandboxed frame, for instance)
      // falls through to the download path rather than failing outright.
    }
  }

  downloadBlob(blob, options.suggestedName);
  return 'downloaded';
}

/** Triggers a download via a temporary object URL. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; one frame
  // of delay is enough for the navigation to have started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Escapes one CSV field per RFC 4180.
 *
 * A field is quoted when it contains a comma, quote, or line break, and inner
 * quotes are doubled. Sequence descriptions routinely contain commas, so
 * skipping this would corrupt the column alignment of an export.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);
  // Spreadsheets evaluate a cell that starts with = + - @ (or a tab/CR) as a
  // formula, and sequence identifiers come straight from the user's file. A
  // leading apostrophe makes the cell literal text. Numeric strings such as
  // "-0.5" are left alone so exported numbers stay numbers.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !NUMERIC.test(text)) {
    text = `'${text}`;
  }
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Builds a CSV document from typed rows. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines: string[] = [columns.map((column) => escapeCsvField(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvField(column.value(row))).join(','));
  }
  // A trailing newline is what POSIX tools expect of a text file.
  return `${lines.join('\n')}\n`;
}

/** Builds a CSV document from plain records, deriving columns from the keys. */
export function recordsToCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines: string[] = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvField(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export const MIME = {
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  fasta: 'text/x-fasta',
  fastq: 'text/x-fastq',
  text: 'text/plain',
} as const;

/* -------------------------------------------------------------------------- */
/* JSON                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Serialises analysis results to JSON, converting typed arrays to plain arrays.
 *
 * `JSON.stringify` renders a `Float32Array` as an object keyed by index, which
 * is both enormous and unusable downstream. Very large arrays are truncated
 * with an explicit marker rather than silently producing a 400 MB file.
 */
export function toJson(value: unknown, options: { maxArrayLength?: number } = {}): string {
  const maxArrayLength = options.maxArrayLength ?? 200_000;

  const replacer = (_key: string, input: unknown): unknown => {
    if (
      input instanceof Float32Array ||
      input instanceof Float64Array ||
      input instanceof Uint32Array ||
      input instanceof Int32Array ||
      input instanceof Uint8Array ||
      input instanceof Int8Array ||
      input instanceof Uint16Array ||
      input instanceof Int16Array
    ) {
      if (input.length > maxArrayLength) {
        return {
          __truncated: true,
          type: input.constructor.name,
          length: input.length,
          note: `Only the first ${maxArrayLength} of ${input.length} values are included in this export.`,
          values: Array.from(input.subarray(0, maxArrayLength)),
        };
      }
      return Array.from(input);
    }
    if (typeof input === 'number' && !Number.isFinite(input)) {
      // JSON has no Infinity or NaN; null is the conventional stand-in.
      return null;
    }
    return input;
  };

  return JSON.stringify(value, replacer, 2);
}

/** Copies text to the clipboard, reporting whether it worked. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard access can be denied by permissions policy; fall through.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
