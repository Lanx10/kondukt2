/**
 * The file I/O half of the Configuration screens' Import / Export.
 *
 * Offline by construction: `expo-file-system` reads and writes this device's
 * own storage. There is no network call, no upload, no share target and no
 * server anywhere in this module — an export lands in the app's document
 * directory and an import reads a file the user picked with the system picker.
 * The same two functions serve both registries.
 *
 * The decisions — what goes in the document, and whether one may be trusted —
 * belong to `transferState.ts`, which has no I/O and is unit tested. This
 * module only moves bytes and classifies what happened.
 *
 * BOTH NATIVE MODULES ARE LOADED DYNAMICALLY, INSIDE THE FUNCTIONS, for the
 * reason `konduktStore.ts` gives: a static `react-native` import made this
 * file unimportable under plain `tsx`, so nothing could reach even the pure
 * `transferFileName` below. Nothing is imported at module scope at all, which
 * is what leaves this file's helpers testable.
 */

/** A write that landed, or did not. Never throws at the call site. */
export type TransferWriteResult =
  | { kind: 'written'; fileName: string; sizeBytes: number }
  | { kind: 'failed'; message: string };

/** A read that landed, was refused by the user, or failed. */
export type TransferReadResult =
  | { kind: 'read'; fileName: string; text: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

/**
 * The loaded platform's OS. `expo-file-system` is a console-warning stub on
 * web — it constructs without a document directory and its picker resolves
 * nothing — so calling it there would surface the stub's own TypeError as
 * "Unable to save that file", which reads like a broken phone rather than a
 * browser. Loaded lazily, because a module-scope `react-native` import is
 * what made this file untestable in the first place.
 */
async function currentPlatformOs(): Promise<string> {
  return (await import('react-native')).Platform.OS;
}

/** A filename the app can write without a second pass, and the user can find. */
export function transferFileName(prefix: string, now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `kondukt-${prefix}-${stamp}.json`;
}

/**
 * Writes one JSON document into the app's document directory and reports how
 * many bytes landed.
 *
 * `Paths.document` rather than `Paths.cache`: a backup the OS may delete when
 * storage runs low is not a backup, and this is the directory Android's file
 * manager and a USB cable both reach. `overwrite` is set so re-exporting on the
 * same day replaces yesterday's copy instead of throwing.
 */
export async function writeTransferFile(
  fileName: string,
  file: Record<string, unknown>,
): Promise<TransferWriteResult> {
  try {
    if ((await currentPlatformOs()) === 'web') {
      return { kind: 'failed', message: WEB_UNSUPPORTED };
    }
    const { File, Paths } = await import('expo-file-system');
    const target = new File(Paths.document, fileName);
    target.create({ overwrite: true, intermediates: true });
    target.write(JSON.stringify(file, null, 2));
    return { kind: 'written', fileName: target.name, sizeBytes: target.size ?? 0 };
  } catch (error) {
    return {
      kind: 'failed',
      message: messageOf(error, 'Unable to save that file on this device.'),
    };
  }
}

/**
 * Opens the system file picker and reads the chosen document.
 *
 * `canceled` is a distinct outcome, not a failure: the user dismissing the
 * picker has decided nothing and the sheet must not report an error for it.
 * JSON files are the only type offered, so the picker cannot hand the app a
 * photo and leave the parse to fail later.
 */
export async function readTransferFile(): Promise<TransferReadResult> {
  try {
    if ((await currentPlatformOs()) === 'web') {
      return { kind: 'failed', message: WEB_UNSUPPORTED };
    }
    const { File } = await import('expo-file-system');
    const picked = await File.pickFileAsync({
      mimeTypes: ['application/json', 'text/json', 'text/plain', '*/*'],
    });
    if (picked.canceled) return { kind: 'cancelled' };
    const text = await picked.result.text();
    return { kind: 'read', fileName: picked.result.name, text };
  } catch (error) {
    return {
      kind: 'failed',
      message: messageOf(error, 'Unable to read that file.'),
    };
  }
}

/** Raw exception text where it says something, the app's own copy otherwise. */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

/** Said once, in the sheet, wherever a browser would otherwise be silent. */
const WEB_UNSUPPORTED =
  'Import and export need the app installed on the phone or tablet. The browser preview cannot save files.';
