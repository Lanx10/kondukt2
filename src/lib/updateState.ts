/**
 * The pure half of the OTA update system: phases, the throttle, error
 * classification, and the exact sentences the Settings card and the
 * "Update available" sheet speak. No expo-updates import lives here — every
 * rule below is testable with `npx tsx src/lib/updateState.test.ts`.
 *
 * Two update channels exist in this app and only one is handled here:
 *
 *  - OTA (EAS Update / expo-updates): JavaScript, UI, business logic and
 *    assets, delivered to builds whose runtimeVersion matches. This module —
 *    the secondary channel.
 *  - GitHub Releases: new Android binaries (native modules, versionCode
 *    bumps), downloaded and installed in-app by the primary updater
 *    (`apkUpdateState.ts` / `apkUpdateService.ts`). Never handled here.
 *    Google Play is not used. See RELEASE-WORKFLOW.md.
 */

/** Where the update flow is in its life cycle. */
export type UpdatePhase =
  /** Nothing checked yet this session. */
  | 'idle'
  /** A manual check is in flight. Auto checks never enter this visibly. */
  | 'checking'
  /** A compatible update exists on the server; not downloaded yet. */
  | 'available'
  /** The update is downloading right now. */
  | 'downloading'
  /** Downloaded; will run on restart (or immediately, if applied). */
  | 'ready'
  /** The check completed and nothing newer exists. */
  | 'uptodate'
  /** The last check failed; the app carries on regardless. */
  | 'error'
  /** This build cannot receive OTA updates (development / unconfigured). */
  | 'disabled';

/**
 * Minimum gap between *automatic* checks, in milliseconds. One window is the
 * app start; the next is a return to foreground — but never more often than
 * this, so a session-heavy operator's phone does not poll EAS all day. Manual
 * checks from Settings ignore the throttle: the user asked.
 */
export const UPDATE_CHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Whether an automatic check may run at `now`. `lastAttemptAt` is the last
 * time any check was *attempted* (failures throttle too — a dead network
 * must not retry on every resume), and null means never, which allows it.
 */
export function shouldAutoCheck(lastAttemptAt: number | null, now: number): boolean {
  if (lastAttemptAt === null) return true;
  if (!Number.isFinite(lastAttemptAt) || lastAttemptAt < 0) return true;
  return now - lastAttemptAt >= UPDATE_CHECK_MIN_INTERVAL_MS;
}

/** What went wrong, at the level the copy cares about. */
export type UpdateErrorKind =
  /** The device could not reach the network at all. */
  | 'offline'
  /** The network answered, but the update service failed or errored. */
  | 'server'
  /** The update was found but the download/apply step failed. */
  | 'download'
  /** The download finished but the restart-into-it step failed. */
  | 'apply'
  /** The build has OTA disabled, so there is nothing to ask. */
  | 'disabled';

/**
 * Sorts an exception into a copy bucket. Heuristic by necessity — expo-updates
 * surfaces platform-shaped errors) — but every branch lands on one of the five
 * friendly sentences below, never on the raw exception. Anything unrecognised
 * degrades to `server` ("try again later"), which is the safe understatement:
 * it never claims the device is offline when it is not.
 */
export function classifyUpdateError(
  message: string | null | undefined,
  stage: 'check' | 'download' | 'apply',
): UpdateErrorKind {
  if (stage === 'download') return 'download';
  if (stage === 'apply') return 'apply';
  const text = (message ?? '').toLowerCase();
  // expo-updates' own development-mode refusal (ERR_UPDATES_DISABLED) — the
  // provider would rather say "this build doesn't check" than "unavailable".
  if (
    text.includes('err_updates_disabled') ||
    text.includes('development mode') ||
    text.includes('cannot check for updates')
  ) {
    return 'disabled';
  }
  const looksOffline =
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
  return looksOffline ? 'offline' : 'server';
}

/**
 * The sentences. Verbatim copy, kept in one place so the card, the sheet and
 * any future surface cannot drift into saying three different things about
 * the same state. None of them mention stack traces, URLs, or the words
 * "expo-updates" — a conductor with a phone does not care which library
 * failed, only what to do next.
 */
export const UPDATE_COPY = {
  idle: 'Check for a new version of Kondukt.',
  checking: 'Checking for updates…',
  available: 'An update is available to download.',
  downloading: 'Downloading update…',
  ready: 'Update downloaded. It will run the next time Kondukt starts.',
  readyApplied: 'Update ready. Applying…',
  uptodate: "You're already using the latest version.",
  disabled:
    "Updates aren't checked in this build. Release builds receive updates automatically.",
  offline: "No internet connection. Check again when you're back online.",
  server: 'Update checking is currently unavailable. Try again later.',
  download:
    "An update was found, but it couldn't be downloaded. Please try again when you have a stable internet connection.",
  apply: 'The update is downloaded. Restart Kondukt to finish installing it.',
} as const;

/** The status line for a phase/error pair, as the Settings card shows it. */
export function updateStatusText(phase: UpdatePhase, error: UpdateErrorKind | null): string {
  if (phase === 'error' && error !== null) {
    return error === 'offline'
      ? UPDATE_COPY.offline
      : error === 'download'
        ? UPDATE_COPY.download
        : error === 'apply'
          ? UPDATE_COPY.apply
          : error === 'disabled'
            ? UPDATE_COPY.disabled
            : UPDATE_COPY.server;
  }
  switch (phase) {
    case 'idle':
      return UPDATE_COPY.idle;
    case 'checking':
      return UPDATE_COPY.checking;
    case 'available':
      return UPDATE_COPY.available;
    case 'downloading':
      return UPDATE_COPY.downloading;
    case 'ready':
      return UPDATE_COPY.ready;
    case 'uptodate':
      return UPDATE_COPY.uptodate;
    case 'disabled':
      return UPDATE_COPY.disabled;
    case 'error':
      return UPDATE_COPY.server;
  }
}

/** True while a check or download is in flight — the button's disabled state. */
export function isUpdateBusy(phase: UpdatePhase): boolean {
  return phase === 'checking' || phase === 'downloading';
}

/** The status line announced when an automatic check fails silently. */
export function autoCheckFailureNote(kind: UpdateErrorKind): string {
  return kind === 'offline'
    ? 'updates: automatic check skipped, device offline'
    : `updates: automatic check failed (${kind})`;
}

/** Debug log line for a completed check — no URLs, no headers, no tokens. */
export function checkLogLine(outcome: 'available' | 'unavailable' | 'disabled'): string {
  return `updates: check → ${outcome}`;
}
