/**
 * Kondukt's theme entry point.
 *
 * WHAT CHANGED. Nothing that imports this file has to change. Every name below
 * - `palette`, `glass`, `accent`, `darkPalette`, `darkGlass`, `darkAccent`,
 * `onAmber`, `amberSurface`, `tintedGlass`, `onPrimarySolid`, `cardShadow`,
 * `glassBlur`, `lightTheme`, `darkTheme`, `getTheme`, `KonduktTheme`,
 * `ThemeMode` - still exists, still means the same thing, and the forty-odd
 * components that read them are untouched by the arrival of a theme registry.
 *
 * What changed is where the values COME FROM. The two hand-written palettes
 * that used to live here are gone: the registry holds one theme table and this
 * module hands out the default theme's bundles from it. `kondukt`, the warm M3
 * theme the app has always shipped, is the registry's first entry, so the tokens
 * a default install renders are the tokens it rendered before - which
 * `src/lib/themeContrast.test.ts` proves token by token against a fixture of
 * the old literals.
 *
 * THE MODULE-LEVEL EXPORTS ARE A COMPATIBILITY SURFACE, NOT A SECOND SOURCE.
 * `palette` and `glass` are the default theme's light bundle and
 * `darkPalette`/`darkGlass` its dark one, because `src/icons.tsx` imports
 * `palette` for its default ink. New code should read the bundle from
 * `useKonduktTheme()` instead, which is theme-aware rather than light-aware.
 */
import { resolveAppearance } from './theme/appearance';
import { getDefaultTheme } from './theme/registry';
import type { KonduktTheme, ThemeMode } from './theme/types';

export type { KonduktTheme, ThemeMode } from './theme/types';
export type {
  Appearance,
  BackgroundGradient,
  BackgroundMode,
  ContrastSetting,
  GradientDirection,
  GradientIntensity,
  SurfaceStyle,
  ThemeSpec,
} from './theme/types';
export {
  APPEARANCE_AXIS_VALUES,
  DEFAULT_APPEARANCE,
  resolveFieldStops,
} from './theme/appearance';
export type { AppearanceAxis, AppearanceChoiceAxis } from './theme/appearance';
export { APPEARANCE_CHOICE_GROUPS, APPEARANCE_TOGGLES } from './theme/appearanceOptions';
export type {
  AppearanceChoiceGroup,
  AppearanceChoiceOption,
  AppearanceToggle,
} from './theme/appearanceOptions';
export {
  DEFAULT_THEME_ID,
  THEME_IDS,
  THEME_REGISTRY,
  getThemeBundle,
  getThemeSpec,
  isKnownThemeId,
} from './theme/registry';
export { buildTheme } from './theme/derive';

/** The two bundles the app has always been handed, now built by the registry. */
export const lightTheme: KonduktTheme = getDefaultTheme('light');
export const darkTheme: KonduktTheme = getDefaultTheme('dark');

/** The default theme's light palette - the bundle `palette` always meant. */
export const palette = lightTheme.palette;
export const glass = lightTheme.glass;
export const accent = lightTheme.accent;

export const darkPalette = darkTheme.palette;
export const darkGlass = darkTheme.glass;
export const darkAccent = darkTheme.accent;

/**
 * The four inks a solid amber (`secondary`) surface accepts.
 *
 * The name is the app's, and it is now an alias: the registry derives a ramp
 * per theme, because eleven themes cannot share four hexes - Cyber's secondary
 * is a violet, and an amber ramp on it measures 2.75:1. The export stays so the
 * nine files that import it keep working, and it means the default theme's
 * ramp, which is the one they shipped with.
 */
export const onAmber = lightTheme.onSecondaryRamp;

/** The pale amber container's own interior rule and outer border. */
export const amberSurface = lightTheme.amberSurface;

/**
 * The accent fill for a coloured control, and the error pigment beside it.
 *
 * These were two literals, `rgb(194, 65, 12)` and `rgb(186, 26, 26)`, which
 * were duplicates of `primarySolid` and `palette.error`. Deriving them is why a
 * themed pill stops being warm orange in a violet theme.
 */
export const tintedGlass = lightTheme.tintedGlass;

/**
 * The ink for anything filled with `primarySolid` or `tintedGlass.accent`.
 *
 * White, and now provably so: the registry solves `primarySolid` to the
 * darkest tone of the theme's own hue that clears 5.2:1 under white, so white
 * is the correct ink in every theme rather than a habit.
 */
export const onPrimarySolid = lightTheme.onPrimarySolid;

/** M3 shape ramp. Containers are softer than the elements inside them. */
export const radius = {
  small: 8,
  medium: 12,
  large: 16,
  xlarge: 24,
  /** Glass panels use a deeper radius than their M3 counterparts. */
  glass: 28,
  /**
   * The brand mark's own radius. The reference draws the 48px mark at 14 -
   * between medium and large, and visibly neither, which is why it is a token
   * rather than a literal in the header.
   */
  brand: 14,
  full: 999,
} as const;

/**
 * Content stops widening here. Past ~720 the two-column cards turn into
 * 600px-wide slabs with the text marooned in the left third, and the START
 * TRIP button becomes a full-bleed orange bar. MD3 asks for a readable max
 * width on large windows rather than letting content stretch to the edge.
 */
export const maxContentWidth = 720;

/**
 * The height every list control measures: the search field and the Import /
 * Export button that sits beside it on both Configuration screens.
 *
 * It is exported rather than written into each screen's stylesheet because the
 * two are a PAIR that must not drift - two literals of 60 in two files is two
 * chances to end up with a search bar one row taller than the button next to
 * it, which is precisely the misalignment this replaced.
 */
export const controlHeight = 60;

/**
 * How a panel sits above the field.
 *
 * GlassCard carries these inline, so a filled card that has to match it needs
 * the same numbers or the page reads as two different layers of depth. The
 * colour is the backdrop's own - a pure-black shadow reads as dirt on a light
 * surface.
 *
 * `elevation` is the one Android-only line: the platform ignores every
 * `shadow*` prop without it, so a panel built from these numbers is flat on
 * Android and lifted on iOS and web. The GEOMETRY follows the Surface style and
 * the Reduce Visual Effects toggle, which is why this is a function now; the
 * module export below is the default theme at its default appearance, which is
 * the 15/8/4 the app has always used.
 */
export function cardShadowFor(theme: KonduktTheme) {
  const lift = resolveAppearance(theme.appearance, theme.mode).treatment.shadow;
  return {
    shadowColor: theme.glass.shadow,
    shadowOpacity: lift.radius === 0 ? 0 : 1,
    shadowRadius: lift.radius,
    shadowOffset: { width: 0, height: lift.offset },
    elevation: lift.elevation,
  };
}

export const cardShadow = cardShadowFor(lightTheme);

/**
 * The frost on every glass panel, mapped from the reference's
 * `backdrop-filter: blur(18px) saturate(180%)` (home.html `.glass`).
 *
 * At intensity 0 the BlurView samples nothing and the panel reads as a flat
 * white wash - the tint with no refraction - which is exactly the "white card"
 * the glass run is meant to replace. It is a token on the bundle now, because
 * Reduce Visual Effects sets it to 0.
 */
export const glassBlur = lightTheme.glass.blur;

/** Systematic 4pt spacing scale. */
export const space = (units: number) => units * 4;

/**
 * M3 type roles, set in Poppins.
 *
 * Poppins is geometric: tall x-height, single-storey `a`/`g`, and wide, even
 * letterforms. Two consequences for this scale:
 *
 * - It reads optically lighter than Roboto at the same px, so headings sit a
 *   step heavier (600/700) and body copy keeps generous line height - the tall
 *   caps need the room or lines collide.
 * - Wide letters need negative tracking as size grows. The wordmark takes -0.5,
 *   large text -0.3, and small caps go positive to stay airy.
 *
 * Themes change colour, never a single number in this scale. The type ramp, the
 * shape ramp and the spacing scale are the app's structure rather than its
 * skin, and a theme registry that re-steps them would be a theme registry that
 * could reflow the app.
 */
export const type = {
  displaySmall: { fontFamily: 'Poppins_700Bold', fontSize: 28, lineHeight: 36, letterSpacing: -0.3 },
  headlineSmall: { fontFamily: 'Poppins_600SemiBold', fontSize: 20, lineHeight: 27, letterSpacing: -0.3 },
  titleMedium: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, lineHeight: 23 },
  bodyMedium: { fontFamily: 'Poppins_400Regular', fontSize: 14, lineHeight: 21 },
  bodySmall: { fontFamily: 'Poppins_400Regular', fontSize: 12, lineHeight: 18 },
  labelLarge: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, lineHeight: 20 },
  labelSmall: { fontFamily: 'Poppins_600SemiBold', fontSize: 11, lineHeight: 16, letterSpacing: 0.6 },
} as const;

export type Accent = 'primary' | 'secondary' | 'tertiary';

/** The app's default theme, for one mode, at the default appearance. */
export function getTheme(mode: ThemeMode): KonduktTheme {
  return mode === 'dark' ? darkTheme : lightTheme;
}

/** The default theme under one appearance, for callers that build a bundle. */
export function getThemed(
  mode: ThemeMode,
  appearance: Parameters<typeof getDefaultTheme>[1] = undefined,
): KonduktTheme {
  return getDefaultTheme(mode, appearance);
}
