import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemeMode } from '../theme';

/**
 * The application's local preference store.
 *
 * One key per boolean, AsyncStorage — the Advanced Settings spec names it
 * explicitly for the persisted preferences: no preference library, no database
 * table, no JSON blob, and deliberately not the trip database, which holds
 * journeys, not app configuration. The fare *rates* live in the database; only
 * booleans about how the app behaves live here.
 *
 * Three keys today: the theme (`kondukt.preferences.themeMode`), whether
 * Deluxe fares are offered (`kondukt.preferences.deluxeEnabled`), and when
 * the update system last checked for an OTA release
 * (`kondukt.preferences.lastUpdateCheckAt` — a timestamp, so the automatic
 * check stays throttled across restarts rather than firing every launch).
 * Plus `kondukt.preferences.lastApkUpdateCheckAt`, the same timestamp for
 * the GitHub Releases APK updater, kept separate so the two channels throttle
 * independently.
 *
 * Each stored value encodes its boolean as `1` / `0`, not the words
 * "true"/"false" and not a mode string: the setting IS a boolean, and words
 * like "dark" are the app's vocabulary, not the store's. The timestamp is a
 * millisecond epoch string — a number, not a boolean, and the one value here
 * that is not one. Reads are cached in memory after the first load; the theme
 * is read once at app entry (App.tsx
 * holds first paint behind it) and nowhere else, so there is exactly one
 * reader and one writer of that key.
 */

const THEME_KEY = 'kondukt.preferences.themeMode';
const DELUXE_KEY = 'kondukt.preferences.deluxeEnabled';
const LAST_UPDATE_CHECK_KEY = 'kondukt.preferences.lastUpdateCheckAt';
const LAST_APK_UPDATE_CHECK_KEY = 'kondukt.preferences.lastApkUpdateCheckAt';
const LAST_APK_RELEASE_KEY = 'kondukt.preferences.lastApkRelease';

/**
 * The last APK release this device saw, kept so the change log can be read
 * without a fresh check.
 *
 * The updater throttles its checks to one per six hours, and the version sheet
 * is opened to answer "what changed?" — a question that has the same answer all
 * day. Caching the release the last check found means the sheet is never blank
 * just because the throttle has not expired; it is a cache of a check that
 * already happened, never a second source of truth.
 */
export type CachedApkRelease = { version: string; notes: string[] };

/**
 * Notes are capped on read and on write. A release body is remote text: a
 * publisher could ship thousands of lines, and this is a preference store, not
 * a place to keep an unbounded document. Forty lines is far more than any
 * release card can show.
 */
const MAX_CACHED_NOTES = 40;

/** The cached release, or null when no check has stored one. */
let cachedRelease: CachedApkRelease | null = null;

/**
 * Decodes a stored release, or null when it is absent or unusable.
 *
 * Written defensively on purpose: this is JSON in a preference store, so a
 * value from an older build, a half-finished write, or a hand-edited device is
 * a real possibility. A changelog that fails to parse must read as "no notes",
 * never as a crash on app start — the update path is exactly where a thrown
 * parse would strand a driver.
 */
export function parseCachedApkRelease(stored: string | null): CachedApkRelease | null {
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { version, notes } = parsed as { version?: unknown; notes?: unknown };
    if (typeof version !== 'string' || version.length === 0) return null;
    if (!Array.isArray(notes)) return { version, notes: [] };
    return {
      version,
      notes: notes
        .filter((note): note is string => typeof note === 'string' && note.length > 0)
        .slice(0, MAX_CACHED_NOTES),
    };
  } catch {
    return null;
  }
}

/** The last release a check found, or null before the first one. */
export async function loadCachedApkRelease(): Promise<CachedApkRelease | null> {
  if (cachedRelease !== null) return cachedRelease;
  try {
    const parsed = parseCachedApkRelease(await AsyncStorage.getItem(LAST_APK_RELEASE_KEY));
    if (parsed !== null) cachedRelease = parsed;
    return cachedRelease;
  } catch {
    return null;
  }
}

/** Persists the release a check just found; false means the write failed. */
export async function saveCachedApkRelease(release: CachedApkRelease): Promise<boolean> {
  const bounded = { version: release.version, notes: release.notes.slice(0, MAX_CACHED_NOTES) };
  try {
    await AsyncStorage.setItem(LAST_APK_RELEASE_KEY, JSON.stringify(bounded));
    cachedRelease = bounded;
    return true;
  } catch {
    return false;
  }
}

/** The dark flag, decoded. Anything unrecognised — including a missing key —
 * reads as null, which the caller treats as the light default. */
export function parseThemeModeBoolean(stored: string | null): ThemeMode | null {
  if (stored === '1') return 'dark';
  if (stored === '0') return 'light';
  return null;
}

let cached: ThemeMode | null = null;

/**
 * The persisted theme, or null when nothing has been saved yet (first launch
 * — the caller decides the default). Storage failures resolve to null rather
 * than throwing: a broken preference store must not brick the app shell.
 */
export async function loadThemeMode(): Promise<ThemeMode | null> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(THEME_KEY);
    const mode = parseThemeModeBoolean(stored);
    if (mode !== null) cached = mode;
    return mode;
  } catch {
    return null;
  }
}

/**
 * Persists the theme boolean and returns whether the write landed.
 *
 * The cache is updated only on success — a failed write must never leave the
 * session remembering a value the store does not have, and the caller must
 * not re-theme the app for a write that failed (the Advanced Settings save
 * sequence branches on this result).
 */
export async function saveThemeMode(mode: ThemeMode): Promise<boolean> {
  try {
    await AsyncStorage.setItem(THEME_KEY, mode === 'dark' ? '1' : '0');
    cached = mode;
    return true;
  } catch {
    return false;
  }
}

let deluxeCached: boolean | null = null;

/**
 * Whether Deluxe fares are offered, or null when nothing has been saved yet.
 *
 * Not saved means ON: a device that has never touched the switch charges what
 * its fare row says, exactly as it did before the switch existed. Storage
 * failures resolve to null for the same reason the theme's do.
 */
export async function loadDeluxeEnabled(): Promise<boolean | null> {
  if (deluxeCached !== null) return deluxeCached;
  try {
    const stored = await AsyncStorage.getItem(DELUXE_KEY);
    if (stored === '1') deluxeCached = true;
    else if (stored === '0') deluxeCached = false;
    return deluxeCached;
  } catch {
    return null;
  }
}

/**
 * Persists the Deluxe flag and returns whether the write landed. Same rule as
 * the theme: the cache moves only on a successful write, so the session never
 * remembers a value the device does not hold — the Fare Configuration switch
 * reverts itself when this returns false.
 */
export async function saveDeluxeEnabled(enabled: boolean): Promise<boolean> {
  try {
    await AsyncStorage.setItem(DELUXE_KEY, enabled ? '1' : '0');
    deluxeCached = enabled;
    return true;
  } catch {
    return false;
  }
}

let lastUpdateCheckCached: number | null = null;

/**
 * When the update system last *attempted* a check, in epoch milliseconds, or
 * null when it never has (first launch, or the store failed). Failures count:
 * the throttle exists so a flaky network cannot turn every foreground into a
 * retry loop. Storage failures resolve to null, which reads as "never" and
 * simply allows the next scheduled check.
 */
export async function loadLastUpdateCheck(): Promise<number | null> {
  if (lastUpdateCheckCached !== null) return lastUpdateCheckCached;
  try {
    const stored = await AsyncStorage.getItem(LAST_UPDATE_CHECK_KEY);
    const parsed = stored === null ? null : Number(stored);
    if (parsed !== null && Number.isFinite(parsed) && parsed > 0) {
      lastUpdateCheckCached = parsed;
    }
    return lastUpdateCheckCached;
  } catch {
    return null;
  }
}

/** Persists the last update-check timestamp; false means the write failed. */
export async function saveLastUpdateCheck(at: number): Promise<boolean> {
  try {
    await AsyncStorage.setItem(LAST_UPDATE_CHECK_KEY, String(at));
    lastUpdateCheckCached = at;
    return true;
  } catch {
    return false;
  }
}

let lastApkUpdateCheckCached: number | null = null;

/**
 * When the GitHub Releases APK updater last *attempted* a check, in epoch
 * milliseconds, or null when it never has. Its own key — deliberately
 * separate from the OTA timestamp above — so one channel's attempt cannot
 * starve the other's throttle window, and so a session-heavy operator's phone
 * hits the GitHub API (60 unauthenticated requests/hour) at most once per
 * interval. Failures count; storage failures read as "never".
 */
export async function loadLastApkUpdateCheck(): Promise<number | null> {
  if (lastApkUpdateCheckCached !== null) return lastApkUpdateCheckCached;
  try {
    const stored = await AsyncStorage.getItem(LAST_APK_UPDATE_CHECK_KEY);
    const parsed = stored === null ? null : Number(stored);
    if (parsed !== null && Number.isFinite(parsed) && parsed > 0) {
      lastApkUpdateCheckCached = parsed;
    }
    return lastApkUpdateCheckCached;
  } catch {
    return null;
  }
}

/** Persists the last APK update-check timestamp; false means write failed. */
export async function saveLastApkUpdateCheck(at: number): Promise<boolean> {
  try {
    await AsyncStorage.setItem(LAST_APK_UPDATE_CHECK_KEY, String(at));
    lastApkUpdateCheckCached = at;
    return true;
  } catch {
    return false;
  }
}
