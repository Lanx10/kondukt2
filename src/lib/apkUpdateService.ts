/**
 * The impure half of the GitHub Releases APK updater: fetch the latest
 * release, download the APK with progress, verify it, and hand it to Android's
 * package installer. This is the only module that talks to GitHub or touches
 * downloaded files.
 *
 * Guarantees:
 *  - One check and one download in flight at a time (module-level single
 *    flight) — a double tap cannot stack network calls.
 *  - APKs are only ever fetched from the configured repository's own release
 *    assets (`trustedDownloadUrlPrefix`); anything else fails before download.
 *  - A failed or partial download is deleted; a file that fails verification
 *    is deleted. The installer is only ever launched with a file that passed
 *    every check, via Android's normal prompt (never silent install).
 *  - Every failure leaves as an `ApkUpdateError` carrying an `ApkErrorKind`
 *    from `apkUpdateState` — the provider turns that into friendly copy; raw
 *    exceptions and GitHub responses never reach the UI.
 *  - No token, no secret, no custom server: public releases need no auth.
 *
 * ponytail: unknown-sources permission cannot be queried directly (no
 * expo-application); we detect it by the install attempt failing with a
 * security-style error and surface the permission sheet then.
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { readAsStringAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  UPDATE_CONFIG,
  latestReleaseApiUrl,
  trustedDownloadUrlPrefix,
} from './apkUpdateConfig';
import {
  classifyApkError,
  parseRelease,
  sanitizeApkFileName,
  type ApkErrorKind,
  type ApkRelease,
} from './apkUpdateState';

/** A classified update failure, safe to map straight to user copy. */
export class ApkUpdateError extends Error {
  readonly kind: ApkErrorKind;
  constructor(kind: ApkErrorKind, message: string) {
    super(message);
    this.name = 'ApkUpdateError';
    this.kind = kind;
  }
}

function toApkError(
  error: unknown,
  stage: 'check' | 'download' | 'verify' | 'install',
): ApkUpdateError {
  if (error instanceof ApkUpdateError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ApkUpdateError(classifyApkError(message, stage), message);
}

/** The app's own version (app.json `version`), or null when unknown. */
export function getInstalledVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

/** The app's `android.versionCode`, or null when unknown. */
export function getInstalledVersionCode(): number | null {
  const code = Constants.expoConfig?.android?.versionCode;
  return typeof code === 'number' ? code : null;
}

/** Maps a `ReleaseProblem` from the pure parser onto a copy bucket. */
function problemToKind(problem: 'no-releases' | 'no-apk' | 'invalid-url' | 'invalid-metadata'): ApkErrorKind {
  switch (problem) {
    case 'no-releases':
      return 'no_release';
    case 'no-apk':
      return 'no_apk';
    // Malformed/untrusted metadata must not leak detail to users: the
    // generic "unavailable, try later" bucket is the safe understatement.
    default:
      return 'server';
  }
}

// ── check ──────────────────────────────────────────────────────────────────

let checkInFlight: Promise<ApkRelease> | null = null;

/**
 * Fetches the latest published release from the configured repository and
 * parses it into an `ApkRelease`. Resolves with the release regardless of
 * whether it is newer than this install — the caller decides. Throws
 * `ApkUpdateError` on any failure (offline, rate limit, no release, bad
 * metadata). Never throws a raw exception.
 */
export function fetchLatestRelease(): Promise<ApkRelease> {
  if (checkInFlight !== null) return checkInFlight;
  checkInFlight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPDATE_CONFIG.requestTimeoutMs);
      let response: Response;
      try {
        response = await fetch(latestReleaseApiUrl(), {
          headers: {
            Accept: 'application/vnd.github+json',
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 404) {
        throw new ApkUpdateError('no_release', 'no published release');
      }
      if (response.status === 403 || response.status === 429) {
        throw new ApkUpdateError('rate_limit', 'GitHub rate limit or forbidden');
      }
      if (!response.ok) {
        throw new ApkUpdateError('server', `release request failed (${response.status})`);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ApkUpdateError('server', 'release response was not JSON');
      }
      const parsed = parseRelease(payload, {
        owner: UPDATE_CONFIG.githubOwner,
        repository: UPDATE_CONFIG.githubRepository,
        tagPrefix: UPDATE_CONFIG.releaseTagPrefix,
      });
      if (!parsed.ok) {
        throw new ApkUpdateError(problemToKind(parsed.problem), `release unusable: ${parsed.problem}`);
      }
      console.info(`[apk-update] check → release ${parsed.release.version} found`);
      return parsed.release;
    } catch (error) {
      const wrapped = toApkError(error, 'check');
      console.info(`[apk-update] check failed (${wrapped.kind})`);
      throw wrapped;
    } finally {
      checkInFlight = null;
    }
  })();
  return checkInFlight;
}

// ── download ───────────────────────────────────────────────────────────────

/** Progress callback: bytes written so far, and total (-1 when unknown). */
export type DownloadProgressCallback = (received: number, total: number) => void;

function releaseApkFile(release: ApkRelease): File {
  return new File(Paths.cache, sanitizeApkFileName(release.apkName));
}

/** Deletes a file if present; never throws (cleanup is best-effort). */
function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // A leftover partial in the cache dir is harmless; the next download
    // overwrites it.
  }
}

let downloadInFlight: Promise<File> | null = null;

/**
 * Downloads the release's APK into the app cache directory, reporting
 * progress. Refuses any URL outside the configured repository, removes a
 * previous download of the same name first, and deletes the partial file if
 * the transfer fails or is interrupted. Throws `ApkUpdateError`.
 */
export function downloadApk(
  release: ApkRelease,
  onProgress: DownloadProgressCallback,
): Promise<File> {
  if (downloadInFlight !== null) return downloadInFlight;
  downloadInFlight = (async () => {
    try {
      if (!release.apkUrl.startsWith(trustedDownloadUrlPrefix())) {
        throw new ApkUpdateError('download', 'apk url is outside the configured repository');
      }
      const destination = releaseApkFile(release);
      deleteQuietly(destination);
      const task = File.createDownloadTask(release.apkUrl, destination, {
        onProgress: ({ bytesWritten, totalBytes }) => {
          // Throttle is unnecessary — React batches these — but never let a
          // server-side oddity show a negative or overflowing percentage.
          onProgress(
            Number.isFinite(bytesWritten) && bytesWritten >= 0 ? bytesWritten : 0,
            Number.isFinite(totalBytes) ? totalBytes : -1,
          );
        },
      });
      const result = await task.downloadAsync();
      if (result === null || !result.exists || result.size <= 0) {
        deleteQuietly(destination);
        throw new ApkUpdateError('download', 'download produced no file');
      }
      console.info('[apk-update] download → complete');
      return result;
    } catch (error) {
      deleteQuietly(releaseApkFile(release));
      const wrapped = toApkError(error, 'download');
      console.info(`[apk-update] download failed (${wrapped.kind})`);
      throw wrapped;
    } finally {
      downloadInFlight = null;
    }
  })();
  return downloadInFlight;
}

// ── verify ─────────────────────────────────────────────────────────────────

/**
 * Integrity checks before the installer ever sees the file:
 *  1. the file exists and is non-empty;
 *  2. its size matches the size GitHub reported for the checked asset
 *     (proves the bytes that arrived are the bytes that were offered);
 *  3. it begins with the ZIP/APK local-file magic (`PK`);
 *  4. when the release body manifest carries a SHA-256 checksum, the digest
 *     of the file must match it exactly.
 *
 * On any failure the file is deleted and an `ApkUpdateError('verify')` is
 * thrown — the caller shows error copy and never launches the installer.
 */
export async function verifyApk(file: File, release: ApkRelease): Promise<void> {
  const fail = (why: string): never => {
    deleteQuietly(file);
    console.info(`[apk-update] verify failed (${why})`);
    throw new ApkUpdateError('verify', why);
  };
  try {
    if (!file.exists || file.size <= 0) fail('file missing or empty');
    if (release.sizeBytes !== null && file.size !== release.sizeBytes) {
      fail(`size ${file.size} != expected ${release.sizeBytes}`);
    }
    // APK is a ZIP: first bytes must be `PK\x03\x04`. Read only 4 bytes so a
    // 100 MB APK is not loaded into memory for this check.
    const head = await readAsStringAsync(file.uri, { position: 0, length: 4 });
    if (!head.startsWith('PK')) fail('missing ZIP/APK magic');
    if (release.sha256 !== null) {
      const buffer = await file.arrayBuffer();
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, buffer);
      const hex = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      if (hex !== release.sha256) fail('sha256 mismatch');
    }
    console.info('[apk-update] verify → passed');
  } catch (error) {
    if (error instanceof ApkUpdateError) throw error;
    // Unreadable file: fail closed, but with the verify bucket.
    fail(error instanceof Error ? error.message : String(error));
  }
}

// ── install ────────────────────────────────────────────────────────────────

const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

/**
 * Launches Android's normal package-installer UI for the verified file via
 * the expo-file-system FileProvider content URI. Never silent, never
 * bypassing Android security: the user approves in the system prompt.
 * Re-checks the file still matches the checked release right before launch.
 * Throws `ApkUpdateError('permission')` when Android needs unknown-sources
 * permission, `ApkUpdateError('install')` for anything else.
 */
export async function installApk(file: File, release: ApkRelease): Promise<void> {
  try {
    if (!file.exists || file.size <= 0) {
      throw new ApkUpdateError('install', 'downloaded file is gone');
    }
    if (release.sizeBytes !== null && file.size !== release.sizeBytes) {
      // The cache entry changed since verification — never install it.
      throw new ApkUpdateError('verify', 'file no longer matches the checked release');
    }
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: file.contentUri,
      type: 'application/vnd.android.package-archive',
      flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
    });
    console.info('[apk-update] installer launched');
  } catch (error) {
    // A verify failure raised above is already classified — pass it through.
    if (error instanceof ApkUpdateError && error.kind === 'verify') throw error;
    const message = error instanceof Error ? error.message : String(error);
    const text = message.toLowerCase();
    const needsPermission =
      (error instanceof ApkUpdateError && error.kind === 'permission') ||
      text.includes('permission') ||
      text.includes('security') ||
      text.includes('denied') ||
      text.includes('not allowed') ||
      text.includes('restricted');
    const kind: ApkErrorKind = needsPermission ? 'permission' : 'install';
    console.info(`[apk-update] install failed (${kind})`);
    throw new ApkUpdateError(kind, message);
  }
}

/**
 * Opens this app's "Install unknown apps" settings screen so the user can
 * grant install permission, then returns. The permission itself is granted
 * (or not) by the user in Android's own UI — never by this app.
 */
export async function openUnknownSourcesSettings(): Promise<void> {
  try {
    const packageId = Constants.expoConfig?.android?.package ?? null;
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
      packageId !== null ? { data: `package:${packageId}` } : {},
    );
  } catch (error) {
    throw toApkError(error, 'install');
  }
}

/** Debug/telemetry-free status: which source the updater points at. */
export function getUpdateSourceLabel(): string {
  const { githubOwner, githubRepository } = UPDATE_CONFIG;
  return `${githubOwner}/${githubRepository}`;
}
