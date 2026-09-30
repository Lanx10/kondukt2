/**
 * The impure half of the OTA update system: the single place in the app that
 * imports `expo-updates`. Everything funnels through here so there is exactly
 * one update service — no second downloader, no custom OTA fetch, and no
 * Play-Store/APK path anywhere in this file or this app.
 *
 * Guarantees:
 *  - One check and one download in flight at a time (module-level single
 *    flight), so a double tap or a foreground+manual race cannot stack calls.
 *  - Every failure leaves as an `UpdateError` carrying a `kind` from
 *    `updateState` — the provider turns that into friendly copy; the raw
 *    exception never reaches the UI.
 *  - Logs are informational only: outcomes and identifiers already printed by
 *    the running app, never request headers or tokens.
 *
 * What this module deliberately does NOT do: download or install an Android
 * binary. Native releases ship through Google Play; see RELEASE-WORKFLOW.md.
 */
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { classifyUpdateError, type UpdateErrorKind } from './updateState';

/** A classified update failure, safe to map straight to user copy. */
export class UpdateError extends Error {
  readonly kind: UpdateErrorKind;
  constructor(kind: UpdateErrorKind, message: string) {
    super(message);
    this.name = 'UpdateError';
    this.kind = kind;
  }
}

function toUpdateError(error: unknown, stage: 'check' | 'download' | 'apply'): UpdateError {
  if (error instanceof UpdateError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new UpdateError(classifyUpdateError(message, stage), message);
}

/** What the running installation is, for the Settings card. */
export type RunInfo = {
  /** The app's own version (app.json `version`) — not the update id. */
  version: string | null;
  /** The Expo runtimeVersion this build speaks; OTA updates must match it. */
  runtimeVersion: string | null;
  /** The EAS Update channel this build listens on, when configured. */
  channel: string | null;
  /** The running update's id, or null when running the embedded binary. */
  updateId: string | null;
  /** True while running the code baked into the install (never an OTA). */
  isEmbeddedLaunch: boolean;
  /** When the running update was published, epoch ms, or null. */
  publishedAt: number | null;
};

/** Reads the run info for the Settings card. Never throws. */
export function getRunInfo(): RunInfo {
  try {
    const created = Updates.createdAt;
    return {
      version: Constants.expoConfig?.version ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
      channel: Updates.channel ?? null,
      updateId: Updates.updateId ?? null,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      publishedAt: created instanceof Date && !Number.isNaN(created.getTime()) ? created.getTime() : null,
    };
  } catch {
    // A partially-initialized module must not take the Settings screen down.
    return {
      version: Constants.expoConfig?.version ?? null,
      runtimeVersion: null,
      channel: null,
      updateId: null,
      isEmbeddedLaunch: true,
      publishedAt: null,
    };
  }
}

/**
 * Whether this build can receive OTA updates at all. False in development
 * (expo-updates rejects manual checks there by design) and in any release
 * not yet pointed at an EAS Update URL — the provider surfaces that as a
 * calm "disabled" state, never as an error.
 */
export function isOtaEnabled(): boolean {
  try {
    return Updates.isEnabled === true && !__DEV__;
  } catch {
    return false;
  }
}

// ── single flight ─────────────────────────────────────────────────────────
// One check at a time, one download at a time, app-wide. A second caller
// joins the in-flight promise instead of starting another network call.
let checkInFlight: Promise<boolean> | null = null;
let downloadInFlight: Promise<boolean> | null = null;

/**
 * Asks the update service whether a compatible newer update exists.
 * Resolves true when one does. Throws `UpdateError` on failure.
 */
export function checkForUpdate(): Promise<boolean> {
  if (checkInFlight !== null) return checkInFlight;
  checkInFlight = (async () => {
    try {
      const result = await Updates.checkForUpdateAsync();
      const available = result.isAvailable === true;
      console.info(`[updates] check → ${available ? 'available' : 'unavailable'}`);
      return available;
    } catch (error) {
      const wrapped = toUpdateError(error, 'check');
      console.info(`[updates] check failed (${wrapped.kind})`);
      throw wrapped;
    } finally {
      checkInFlight = null;
    }
  })();
  return checkInFlight;
}

/**
 * Downloads the update the previous check found. Resolves true when new
 * content landed (false on a benign race where it was already fetched).
 * Throws `UpdateError`; the copy for that bucket tells the user to retry on
 * a stable connection.
 */
export function downloadUpdate(): Promise<boolean> {
  if (downloadInFlight !== null) return downloadInFlight;
  downloadInFlight = (async () => {
    try {
      const result = await Updates.fetchUpdateAsync();
      const isNew = result.isNew === true;
      console.info(`[updates] fetch → ${isNew ? 'new update downloaded' : 'already current'}`);
      return isNew;
    } catch (error) {
      const wrapped = toUpdateError(error, 'download');
      console.info(`[updates] fetch failed (${wrapped.kind})`);
      throw wrapped;
    } finally {
      downloadInFlight = null;
    }
  })();
  return downloadInFlight;
}

/**
 * Applies a downloaded update by restarting into it. Resolves only after
 * expo-updates has verified the update is loadable; the app then restarts.
 * Callers must only invoke this on an explicit user action (or a safe point)
 * — never automatically mid-transaction. Throws `UpdateError` on failure,
 * in which case the downloaded update still runs on the next cold start.
 */
export async function applyUpdate(): Promise<void> {
  try {
    console.info('[updates] applying downloaded update');
    await Updates.reloadAsync();
  } catch (error) {
    const wrapped = toUpdateError(error, 'apply');
    console.info(`[updates] apply failed (${wrapped.kind})`);
    throw wrapped;
  }
}

/** True while another check or download is in flight (for status UI). */
export function isUpdateCallInFlight(): boolean {
  return checkInFlight !== null || downloadInFlight !== null;
}
