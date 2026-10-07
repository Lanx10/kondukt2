import { DEFAULT_APPEARANCE } from './appearance';
import { buildTheme } from './derive';
import { DEFAULT_THEME_ID, THEME_SPECS } from './specs';
import type { Appearance, KonduktTheme, ThemeMode, ThemeSpec } from './types';

/**
 * The one table the whole app resolves a theme through.
 *
 * Nothing else holds a theme list, and nothing else builds a bundle. A theme
 * arrives in the app as an id (a persisted preference, a card tap, a test), it
 * is looked up here, and the registry is the only caller of `buildTheme`. That
 * is what makes "every theme is audited" a statement about the registry rather
 * than a statement about whatever list someone maintained.
 *
 * An unknown id is never an error. It resolves to the default theme, so a
 * hand-edited preference file, a theme removed in a later build, or a stale
 * id from an interrupted write all read as "the app's own theme" — the same
 * tolerance `preferences.ts` applies to every other stored value.
 */
export const THEME_REGISTRY: readonly ThemeSpec[] = THEME_SPECS;

/** The ids in the order the Themes section lists them, default first. */
export const THEME_IDS: readonly string[] = THEME_REGISTRY.map((spec) => spec.id);

export { DEFAULT_THEME_ID };

/** The spec for an id, or the default theme's spec when the id is unknown. */
export function getThemeSpec(id: string | null | undefined): ThemeSpec {
  const found = THEME_REGISTRY.find((spec) => spec.id === id);
  return found ?? defaultThemeSpec();
}

/** Whether an id names a theme in the registry. */
export function isKnownThemeId(id: string | null | undefined): boolean {
  return typeof id === 'string' && THEME_REGISTRY.some((spec) => spec.id === id);
}

function defaultThemeSpec(): ThemeSpec {
  const found = THEME_REGISTRY.find((spec) => spec.id === DEFAULT_THEME_ID);
  // THEME_SPECS is a literal table, so the default id is always present. The
  // throw is unreachable and exists so a typo here cannot become a silent
  // fallback at runtime.
  if (!found) throw new Error(`the registry is missing its default theme "${DEFAULT_THEME_ID}"`);
  return found;
}

/** Builds a bundle for any id, in any mode, under any appearance. */
export function getThemeBundle(
  id: string | null | undefined,
  mode: ThemeMode,
  appearance: Appearance = DEFAULT_APPEARANCE,
): KonduktTheme {
  return buildTheme(getThemeSpec(id), mode, appearance);
}

/** The default theme's bundle in one mode — what `getTheme` hands the app. */
export function getDefaultTheme(mode: ThemeMode, appearance: Appearance = DEFAULT_APPEARANCE): KonduktTheme {
  return buildTheme(defaultThemeSpec(), mode, appearance);
}