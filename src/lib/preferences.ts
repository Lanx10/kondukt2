import AsyncStorage from '@react-native-async-storage/async-storage';
import { isKnownThemeId } from '../theme/registry';
import { APPEARANCE_AXIS_VALUES } from '../theme/appearance';
import type { Appearance, AppearanceAxis, ThemeMode } from '../theme';

/**
 * The application's local preference store.
 *
 * One key per boolean, AsyncStorage — the Advanced Settings spec names it
 * explicitly for the persisted preferences: no preference library, no database
 * table, no JSON blob, and deliberately not the trip database, which holds
 * journeys, not app configuration. The fare *rates* live in the database; only
 * booleans about how the app behaves live here.
 *
 * Four keys today: the theme (`kondukt.preferences.themeMode`), which theme
 * from the registry is selected
 * (`kondukt.preferences.themeId` - a theme id, not a boolean: it is one of the
 * registry's own strings and is validated against the registry on read, so a
 * hand-edited store or an id from a build that no longer ships it resolves to
 * the app's own theme rather than to a blank screen), whether
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
 *
 * ONE KEY PER SETTING, WHICH IS WHY THE APPEARANCE AXES ARE SEVEN KEYS AND NOT
 * ONE BLOB. The Advanced Appearance controls are seven independent axes, and a
 * driver who changes one of them must not have their other six rewritten, so
 * each axis gets its own `kondukt.preferences.appearance.*` key with its own
 * cache entry that moves only when that axis's own write lands. A blob would
 * make every tap a read-modify-write over the whole appearance, which is the
 * one thing a preference store must not do: a write refused half way through
 * would leave four axes changed and two reverted with nothing to say which.
 *
 * Five of those seven axes store one of their OWN words - "strong", "blTr",
 * "high" - rather than a boolean, on exactly the precedent the theme id sets
 * above: the value is validated against the axis's declared values on read, so
 * a hand-edited device, a build that retired a value or a half-finished write
 * reads as "not chosen" and the app falls back to its default rather than
 * handing the transform something it cannot render. The other two axes ARE
 * booleans and store `1` / `0` like every other boolean here.
 */

const THEME_KEY = 'kondukt.preferences.themeMode';
const THEME_ID_KEY = 'kondukt.preferences.themeId';
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

/**
 * Decodes a stored theme id, or null when it is absent or not a theme.
 *
 * Validated against the REGISTRY rather than merely against "a non-empty
 * string", for the same reason the release decoder is defensive: this value
 * comes out of a store a future build may no longer share, and an id that does
 * not name a theme must read as "no theme chosen" so the app can fall back to
 * its own rather than failing to resolve a bundle.
 */
export function parseThemeId(stored: string | null): string | null {
  if (stored === null) return null;
  const trimmed = stored.trim();
  return isKnownThemeId(trimmed) ? trimmed : null;
}

let themeIdCached: string | null = null;

/**
 * The persisted theme id, or null when nothing has been saved yet (first
 * launch - the caller decides the default, which is `DEFAULT_THEME_ID`).
 * Storage failures resolve to null for the same reason the theme's do: a
 * broken preference store must not brick the app shell.
 */
export async function loadThemeId(): Promise<string | null> {
  if (themeIdCached !== null) return themeIdCached;
  try {
    const stored = await AsyncStorage.getItem(THEME_ID_KEY);
    const id = parseThemeId(stored);
    if (id !== null) themeIdCached = id;
    return id;
  } catch {
    return null;
  }
}

/**
 * Persists the theme id and returns whether the write landed.
 *
 * Same rule as every other write here: the cache moves only on success, so the
 * session never remembers a value the device does not hold, and the caller can
 * revert a tap whose write was refused.
 */
export async function saveThemeId(id: string): Promise<boolean> {
  if (!isKnownThemeId(id)) return false;
  try {
    await AsyncStorage.setItem(THEME_ID_KEY, id);
    themeIdCached = id;
    return true;
  } catch {
    return false;
  }
}

// ── the seven Advanced Appearance axes ────────────────────────────────────────

/** The axes in the order the screen groups them. */
const APPEARANCE_AXES: readonly AppearanceAxis[] = [
  'background',
  'gradientIntensity',
  'gradientDirection',
  'surfaceStyle',
  'contrast',
  'dynamicAccent',
  'reduceEffects',
];

/**
 * One key per axis, under the appearance prefix.
 *
 * Keyed by axis rather than built from a loop so the seven names are greppable
 * and a reader can see the exact string a value lives under without running the
 * app - which is the same reason every other key here is a literal.
 */
const APPEARANCE_KEYS: Record<AppearanceAxis, string> = {
  background: 'kondukt.preferences.appearance.background',
  gradientIntensity: 'kondukt.preferences.appearance.gradientIntensity',
  gradientDirection: 'kondukt.preferences.appearance.gradientDirection',
  surfaceStyle: 'kondukt.preferences.appearance.surfaceStyle',
  contrast: 'kondukt.preferences.appearance.contrast',
  dynamicAccent: 'kondukt.preferences.appearance.dynamicAccent',
  reduceEffects: 'kondukt.preferences.appearance.reduceEffects',
};

/**
 * Decodes one axis's stored value, or null when it is absent or unusable.
 *
 * Validated against the AXIS, not against "a non-empty string", for the same
 * reason `parseThemeId` is validated against the registry: this value can come
 * out of a store a later build does not share, and an axis that does not accept
 * it has to read as "not chosen" so the app keeps its default appearance rather
 * than resolving a bundle from a value the transform was never told about.
 *
 * An axis either names one of its own words or is a flag, and the two are told
 * apart by the axis itself - never by what the string looks like - so a value
 * cannot be written to the wrong axis by accident.
 */
export function parseAppearanceValue(
  axis: AppearanceAxis,
  stored: string | null,
): Appearance[AppearanceAxis] | null {
  if (stored === null) return null;
  const trimmed = stored.trim();
  if (axis === 'dynamicAccent' || axis === 'reduceEffects') {
    if (trimmed === '1') return true;
    if (trimmed === '0') return false;
    return null;
  }
  const values = APPEARANCE_AXIS_VALUES[axis] as readonly string[];
  return values.includes(trimmed) ? (trimmed as Appearance[AppearanceAxis]) : null;
}

/**
 * What the store holds, per axis.
 *
 * An axis's entry is written only by that axis's own successful save, so a
 * refused write leaves the session reading the value the device actually has -
 * which is what lets a refused tap revert to the truth instead of to this
 * module's memory of an intention.
 */
const cachedAppearance = new Map<AppearanceAxis, Appearance[AppearanceAxis]>();

/**
 * Every axis the store holds a value for, and nothing else.
 *
 * Read once at app entry, alongside the mode and the theme id, and nowhere
 * else: `App.tsx` holds the first paint behind it so the app opens in the
 * appearance it was left in. A missing, unknown or unreadable axis is simply
 * absent from the result, which the caller fills from `DEFAULT_APPEARANCE` -
 * there is no partial-appearance state to invent and no default to store,
 * because a device that has never touched a control has no business holding
 * seven keys that say what the app already does.
 */
export async function loadAppearance(): Promise<Partial<Appearance>> {
  await Promise.all(
    APPEARANCE_AXES.map(async (axis) => {
      if (cachedAppearance.has(axis)) return; // already in hand
      try {
        const value = parseAppearanceValue(
          axis,
          await AsyncStorage.getItem(APPEARANCE_KEYS[axis]),
        );
        if (value !== null) cachedAppearance.set(axis, value);
      } catch {
        // A failed read is "not chosen", exactly as it is for every other key
        // here: the app renders its default rather than failing to start.
      }
    }),
  );
  // A COPY, not the cache itself: this object is what the provider holds for
  // the life of the session, and a caller that could write into the cache would
  // be a second source of truth for a setting the store owns.
  return Object.fromEntries(cachedAppearance) as Partial<Appearance>;
}

/**
 * Persists ONE axis and returns whether the write landed.
 *
 * Only the axis that was tapped is written, and its cache entry moves only on
 * success, so six untouched settings are never rewritten and a refused write
 * cannot be remembered. The value is encoded through the same rules the reader
 * uses - a flag as `1` / `0`, a choice as its own word - and is checked by
 * running the encoder's output back through the decoder first, so a value the
 * axis does not accept never reaches the store at all.
 */
export async function saveAppearanceAxis(
  axis: AppearanceAxis,
  value: Appearance[AppearanceAxis],
): Promise<boolean> {
  const stored = typeof value === 'boolean' ? (value ? '1' : '0') : value;
  if (parseAppearanceValue(axis, stored) === null) return false;
  try {
    await AsyncStorage.setItem(APPEARANCE_KEYS[axis], stored);
    cachedAppearance.set(axis, value);
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
