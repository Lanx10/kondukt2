/**
 * The pure half of the GitHub Releases APK updater: semantic-version
 * comparison, release-metadata parsing, the update verdict, phases, throttle,
 * and the exact sentences the Settings card and its sheets speak. No network,
 * no filesystem, no React — every rule here is testable with
 * `npx tsx src/lib/apkUpdateState.test.ts`.
 *
 * Distribution model (see apkUpdateConfig / RELEASE-WORKFLOW.md):
 *  - GitHub Releases is the ONLY update source. Google Play is not used, and
 *    EAS Update (expo-updates) is a separate, secondary channel for JS-only
 *    changes — never a replacement for this APK updater.
 *  - The "version manifest" is the latest GitHub release itself: the tag
 *    carries the version, the assets carry the APK, and an optional JSON
 *    object in the release body carries `minimumVersion`, `releaseNotes` and
 *    an optional `sha256` checksum.
 */

// ── semantic versions ──────────────────────────────────────────────────────

/**
 * Parses `1.2.3` (optionally `v`-prefixed) into numeric parts. Anything else
 * — `1.2`, `1.2.3.4`, `1.2.x`, empty, garbage — returns null so callers can
 * treat malformed metadata as "cannot compare" instead of guessing.
 *
 * ponytail: strict `major.minor.patch` only; a bare letter suffix (`1.0.0a`)
 * is tolerated and ordered as its base triple — no pre-release ordering.
 * Add real pre-release ordering (`1.2.0-beta.1`) if a channel ships one.
 */
export function parseSemver(version: string | null | undefined): [number, number, number] | null {
  if (typeof version !== 'string') return null;
  const trimmed = version.trim();
  const match = /^v?(\d+)\.(\d+)\.(\d+)[a-z]*$/i.exec(trimmed);
  if (match === null) return null;
  const parts = [match[1], match[2], match[3]].map((part) => Number(part));
  if (!parts.every((part) => Number.isSafeInteger(part))) return null;
  return parts as [number, number, number];
}

/**
 * Compares two semantic versions: negative when `a` is older, 0 when equal,
 * positive when `a` is newer, null when either is malformed (so callers
 * surface "can't tell" rather than treating garbage as an update or as
 * current). Numeric, not lexicographic — `1.10.0` beats `1.9.0`.
 */
export function compareSemver(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === null || pb === null) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** Strips the configured tag prefix (`v`) from `v1.2.0` → `1.2.0`. */
export function stripTagPrefix(tag: string, prefix: string): string {
  const trimmed = tag.trim();
  return trimmed.toLowerCase().startsWith(prefix.toLowerCase())
    ? trimmed.slice(prefix.length)
    : trimmed;
}

// ── release metadata ───────────────────────────────────────────────────────

/** Everything the updater needs from one GitHub release. */
export type ApkRelease = {
  /** Normalized `x.y.z` version this release ships. */
  version: string;
  /** The raw release tag (`v1.2.0`) — shown in logs, not guessed from. */
  tag: string;
  /** File name of the APK asset (`kondukt-1.2.0.apk`). */
  apkName: string;
  /** Download URL — always inside the configured repository (see below). */
  apkUrl: string;
  /** Asset size in bytes from GitHub metadata, or null when unavailable. */
  sizeBytes: number | null;
  /** Optional `versionCode` from the body manifest, or null. */
  versionCode: number | null;
  /** Optional `minimumVersion` from the body manifest, or null. */
  minimumVersion: string | null;
  /** Bullet points: manifest array when present, else release-body lines. */
  releaseNotes: string[];
  /** Optional lowercase hex SHA-256 from the body manifest, or null. */
  sha256: string | null;
  /** `published_at` as epoch ms, or null. */
  publishedAt: number | null;
};

/** Why a release could not be used — mapped to friendly copy by the service. */
export type ReleaseProblem =
  /** The repository has no published (non-draft) release. */
  | 'no-releases'
  /** The latest release exists but attaches no `.apk` asset. */
  | 'no-apk'
  /** The APK URL points outside the configured repository's releases. */
  | 'invalid-url'
  /** The release payload is missing/unusable metadata (bad tag, bad JSON). */
  | 'invalid-metadata';

export type ParseReleaseResult =
  | { ok: true; release: ApkRelease }
  | { ok: false; problem: ReleaseProblem };

export type ReleaseSource = {
  /** GitHub owner — trusted URLs must live under this owner. */
  owner: string;
  /** GitHub repository — trusted URLs must live under this repository. */
  repository: string;
  /** Tag prefix used by the release convention (`v`). */
  tagPrefix: string;
};

/** True when `url` is a release download inside the configured repository. */
export function isTrustedApkUrl(url: string, source: ReleaseSource): boolean {
  const prefix = `https://github.com/${source.owner}/${source.repository}/releases/download/`;
  return url.startsWith(prefix);
}

/** Best-effort parse of the optional JSON manifest in the release body. */
type BodyManifest = {
  version?: unknown;
  versionCode?: unknown;
  minimumVersion?: unknown;
  apkUrl?: unknown;
  releaseNotes?: unknown;
  sha256?: unknown;
};

function parseBodyManifest(body: string): BodyManifest | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null ? (parsed as BodyManifest) : null;
  } catch {
    return null;
  }
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Turns a parsed GitHub "latest release" payload into an `ApkRelease`.
 * Source of truth is GitHub's own metadata (tag + assets); the body manifest
 * only adds what GitHub cannot express (`minimumVersion`, notes array,
 * checksum). Any APK URL that escapes the configured repository fails the
 * whole parse — the updater never downloads from a host it wasn't pointed at.
 */
export function parseRelease(raw: unknown, source: ReleaseSource): ParseReleaseResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, problem: 'invalid-metadata' };
  }
  const release = raw as Record<string, unknown>;
  // /releases/latest already excludes these; reject anyway so a wrong-endpoint
  // response can never ship a draft or pre-release as "latest".
  if (release.draft === true || release.prerelease === true) {
    return { ok: false, problem: 'invalid-metadata' };
  }
  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  if (tag === '') return { ok: false, problem: 'invalid-metadata' };

  const manifest = typeof release.body === 'string' ? parseBodyManifest(release.body) : null;

  // Version: manifest wins when it parses as semver, else the tag.
  const tagVersion = stripTagPrefix(tag, source.tagPrefix);
  const manifestVersion =
    typeof manifest?.version === 'string' ? manifest.version.trim() : null;
  const version =
    manifestVersion !== null && parseSemver(manifestVersion) !== null
      ? manifestVersion
      : parseSemver(tagVersion) !== null
        ? tagVersion
        : null;
  if (version === null) return { ok: false, problem: 'invalid-metadata' };

  // APK asset: GitHub metadata first; a manifest apkUrl may narrow the pick.
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const assetRecords = assets.filter(
    (asset): asset is Record<string, unknown> =>
      typeof asset === 'object' && asset !== null,
  );
  const manifestUrl =
    typeof manifest?.apkUrl === 'string' ? manifest.apkUrl.trim() : null;
  const apkAssets = assetRecords.filter(
    (asset) =>
      typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.apk'),
  );
  const matchedAsset =
    manifestUrl !== null
      ? apkAssets.find((asset) => asset.browser_download_url === manifestUrl)
      : undefined;
  const apkAsset = matchedAsset ?? apkAssets[0];

  let apkUrl: string | null = null;
  let apkName: string | null = null;
  if (apkAsset !== undefined) {
    const url = apkAsset.browser_download_url;
    if (typeof url !== 'string' || !isTrustedApkUrl(url, source)) {
      return { ok: false, problem: 'invalid-url' };
    }
    apkUrl = url;
    apkName = typeof apkAsset.name === 'string' ? apkAsset.name : url.split('/').pop() ?? null;
  } else if (manifestUrl !== null && isTrustedApkUrl(manifestUrl, source)) {
    // Manifest-only fallback: URL still must be inside this repository.
    apkUrl = manifestUrl;
    apkName = manifestUrl.split('/').pop() ?? null;
  } else if (manifestUrl !== null) {
    return { ok: false, problem: 'invalid-url' };
  } else {
    return { ok: false, problem: 'no-apk' };
  }
  if (apkUrl === null || apkName === null || apkName === '') {
    return { ok: false, problem: 'no-apk' };
  }

  // Release notes: manifest array when present, else the body's lines.
  let releaseNotes: string[] = [];
  if (Array.isArray(manifest?.releaseNotes)) {
    releaseNotes = manifest.releaseNotes
      .filter((note): note is string => typeof note === 'string')
      .map((note) => note.trim())
      .filter((note) => note !== '')
      .slice(0, 30);
  } else if (typeof release.body === 'string') {
    releaseNotes = release.body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .slice(0, 30);
  }

  const sha256 =
    typeof manifest?.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(manifest.sha256.trim())
      ? manifest.sha256.trim().toLowerCase()
      : null;

  const publishedAt =
    typeof release.published_at === 'string' ? Date.parse(release.published_at) : NaN;

  return {
    ok: true,
    release: {
      version,
      tag,
      apkName,
      apkUrl,
      sizeBytes:
        typeof apkAsset?.size === 'number' && apkAsset.size > 0 ? apkAsset.size : null,
      versionCode: asPositiveInt(manifest?.versionCode),
      minimumVersion:
        typeof manifest?.minimumVersion === 'string' &&
        parseSemver(manifest.minimumVersion) !== null
          ? manifest.minimumVersion.trim()
          : null,
      releaseNotes,
      sha256,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
    },
  };
}

// ── the verdict ────────────────────────────────────────────────────────────

/** What the updater decided for this install. */
export type UpdateVerdict =
  /** No newer release (or this install is ahead of it). */
  | 'uptodate'
  /** A newer release exists; the user may update whenever they like. */
  | 'update'
  /** A newer release exists AND the install is below `minimumVersion`. */
  | 'mandatory'
  /** Versions could not be compared (malformed installed or released). */
  | 'invalid';

export type InstalledInfo = {
  /** The app's own version (app.json `version`), or null when unknown. */
  version: string | null;
  /** The app's `android.versionCode`, or null when unknown. */
  versionCode: number | null;
};

/**
 * Compares the install against a release. `versionCode` only breaks ties:
 * when the semantic versions are equal, a higher released `versionCode` still
 * counts as an update (same version, rebuilt binary). A release below
 * `minimumVersion` becomes mandatory only when the config allows it — an
 * update existing is never enough on its own.
 */
export function resolveApkUpdate(
  installed: InstalledInfo,
  release: ApkRelease,
  options: { allowMandatoryUpdates: boolean },
): UpdateVerdict {
  const order = compareSemver(installed.version, release.version);
  if (order === null) return 'invalid';
  if (order > 0) return 'uptodate'; // dev/local build ahead of the release
  if (order === 0) {
    if (
      release.versionCode !== null &&
      installed.versionCode !== null &&
      release.versionCode > installed.versionCode
    ) {
      return 'update';
    }
    return 'uptodate';
  }
  if (options.allowMandatoryUpdates && release.minimumVersion !== null) {
    const floor = compareSemver(installed.version, release.minimumVersion);
    if (floor !== null && floor < 0) return 'mandatory';
  }
  return 'update';
}

// ── phases, copy, errors ───────────────────────────────────────────────────

/** Where the APK update flow is in its life cycle. */
export type ApkUpdatePhase =
  /** Nothing checked yet this session. */
  | 'idle'
  /** A check is in flight. */
  | 'checking'
  /** A newer release exists; not downloaded yet. */
  | 'available'
  /** The APK is downloading right now. */
  | 'downloading'
  /** Download finished; integrity checks are running. */
  | 'verifying'
  /** Verified — waiting for the user to launch the installer. */
  | 'ready'
  /** The installer intent is up; Android is showing its prompt. */
  | 'installing'
  /** Android blocked the install: the user must allow unknown sources. */
  | 'permission'
  /** The check completed and nothing newer exists. */
  | 'uptodate'
  /** The last attempt failed; the app carries on regardless. */
  | 'error';

/** What went wrong, at the level the copy cares about. */
export type ApkErrorKind =
  /** The device could not reach the network. */
  | 'offline'
  /** GitHub (or the network's far end) failed or errored. */
  | 'server'
  /** GitHub rate limiting — throttle, then try again. */
  | 'rate_limit'
  /** The repository has no published release. */
  | 'no_release'
  /** The latest release exists but ships no APK. */
  | 'no_apk'
  /** The APK download failed or was interrupted. */
  | 'download'
  /** The downloaded file failed verification and was deleted. */
  | 'verify'
  /** Android refused the install until unknown sources is allowed. */
  | 'permission'
  /** The installer could not be opened for any other reason. */
  | 'install';

/**
 * Sorts an exception into a copy bucket. Heuristic for raw errors — the
 * service throws explicit kinds for everything it can detect itself — and
 * anything unrecognised on a check degrades to `server` ("try again later"),
 * which never falsely claims the device is offline.
 */
export function classifyApkError(
  message: string | null | undefined,
  stage: 'check' | 'download' | 'verify' | 'install',
): ApkErrorKind {
  if (stage === 'verify') return 'verify';
  if (stage === 'install') return 'install';
  const text = (message ?? '').toLowerCase();
  const looksOffline =
    text.includes('network request failed') ||
    text.includes('network') ||
    text.includes('internet') ||
    text.includes('offline') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('could not connect') ||
    text.includes('cannot connect') ||
    text.includes('failed to fetch') ||
    text.includes('enotfound') ||
    text.includes('econnrefused') ||
    text.includes('econnreset');
  if (looksOffline) return 'offline';
  if (stage === 'check') {
    if (
      text.includes('rate limit') ||
      text.includes('403') ||
      text.includes('429') ||
      text.includes('ratelimit')
    ) {
      return 'rate_limit';
    }
    return 'server';
  }
  return 'download';
}

/**
 * The sentences. Verbatim copy in one place so the card, the available-sheet
 * and the permission sheet cannot drift. None mention stack traces, URLs, or
 * the words "GitHub API" — the conductor only needs to know what to do next.
 */
export const APK_UPDATE_COPY = {
  idle: 'Check for a new version of Kondukt from GitHub Releases.',
  checking: 'Checking for updates…',
  available: 'An update is available to download.',
  required: 'This update is required to keep using Kondukt.',
  downloading: 'Downloading update…',
  verifying: 'Verifying the downloaded update…',
  ready: 'Update downloaded and verified. Tap Install to continue.',
  installing: 'Follow the Android prompts to install the update.',
  permission:
    'Android needs permission to install updates from Kondukt. Allow it, then tap Install.',
  uptodate: "You're already using the latest version.",
  offline: 'No internet connection. Check again when you’re back online.',
  server: 'Update checking is currently unavailable. Try again later.',
  rate_limit: 'Too many update requests right now. Try again in a few minutes.',
  no_release: 'No update has been published yet.',
  no_apk: 'The latest update has no install file yet. Try again later.',
  download:
    "An update was found, but it couldn't be downloaded. Please try again on a stable internet connection.",
  verify:
    'The downloaded update failed verification and was deleted. Please try again.',
  install:
    "The update is ready, but the installer couldn't be opened. Check Android's install permission and try again.",
} as const;

/** Progress for the status line: `received`/`total` bytes during download. */
export type ApkProgress = { received: number; total: number };

/**
 * The status line for a phase/error/progress triple, as the Settings card
 * shows it. Error copy wins over phase copy; download shows a percentage when
 * the server sent a Content-Length, and falls back to plain bytes received.
 */
export function apkStatusText(
  phase: ApkUpdatePhase,
  error: ApkErrorKind | null,
  progress: ApkProgress | null = null,
): string {
  if (phase === 'error') {
    return error !== null ? APK_UPDATE_COPY[error] : APK_UPDATE_COPY.server;
  }
  if (phase === 'downloading' && progress !== null) {
    if (progress.total > 0) {
      const percent = Math.min(
        100,
        Math.max(0, Math.round((progress.received / progress.total) * 100)),
      );
      return `${APK_UPDATE_COPY.downloading} ${percent}%`;
    }
    return `${APK_UPDATE_COPY.downloading} ${formatBytes(progress.received)}`;
  }
  return APK_UPDATE_COPY[phase];
}

/** True while a check, download, verify or install is in flight. */
export function isApkUpdateBusy(phase: ApkUpdatePhase): boolean {
  return (
    phase === 'checking' ||
    phase === 'downloading' ||
    phase === 'verifying' ||
    phase === 'installing'
  );
}

/**
 * Whether an automatic check may run at `now`. `lastAttemptAt` is the last
 * time any check was *attempted* (failures throttle too — a dead network
 * must not retry on every resume); null means never, which allows it.
 */
export function shouldApkAutoCheck(
  lastAttemptAt: number | null,
  now: number,
  intervalMs: number,
): boolean {
  if (lastAttemptAt === null) return true;
  if (!Number.isFinite(lastAttemptAt) || lastAttemptAt < 0) return true;
  return now - lastAttemptAt >= intervalMs;
}

/** Human file size for the sheet's "File size" row. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Local file name for a downloaded APK: the release asset's basename,
 * sanitised to a flat `[A-Za-z0-9._-]` name that still ends in `.apk`.
 * Path separators and dot-leading names are stripped so a hostile asset
 * name cannot escape the cache directory.
 */
export function sanitizeApkFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  let safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  if (safe.length > 100) safe = safe.slice(0, 100);
  if (!safe.toLowerCase().endsWith('.apk')) safe = `${safe || 'kondukt-update'}.apk`;
  return safe;
}
