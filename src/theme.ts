/**
 * Kondukt Material 3 theme (light).
 *
 * Four semantic accent roles, each with a M3 tonal pair. Accents are never
 * used equally: primary carries brand and the primary action, secondary is
 * reserved for fare/ticket, tertiary for informational and neutral
 * functionality, error only for real errors and validation.
 */
export const palette = {
  primary: '#E65100',
  onPrimary: '#FFFFFF',
  primaryContainer: '#FFE6D2',
  onPrimaryContainer: '#4E2200',

  /**
   * A solid `primary` surface deep enough for white body copy.
   *
   * #E65100 with white is 3.8:1 — fine for the 20px+ display roles and for
   * icons (the 3:1 non-text floor), short of the 4.5:1 an 11px label needs.
   * This is a darker step of the same hue, not a different colour: 5.2:1.
   */
  primarySolid: '#C2410C',

  secondary: '#FFB300',
  onSecondary: '#3D2E00',
  secondaryContainer: '#FFEFC7',
  onSecondaryContainer: '#4A3600',

  tertiary: '#546E7A',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#DDE6EA',
  onTertiaryContainer: '#162B33',

  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',

  // Neutral surface ramp — never pure white everywhere.
  background: '#FDF7F3',
  surface: '#FDF7F3',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F7EFE9',
  surfaceContainer: '#F2E9E2',
  surfaceContainerHigh: '#ECE3DC',

  onSurface: '#221A15',
  onSurfaceVariant: '#53433B',
  outline: '#85736B',
  outlineVariant: '#D7C2B7',
  scrim: 'rgba(34, 26, 21, 0.32)',
} as const;

/** M3 shape ramp. Containers are softer than the elements inside them. */
export const radius = {
  small: 8,
  medium: 12,
  large: 16,
  xlarge: 24,
  /** Glass panels use a deeper radius than their M3 counterparts. */
  glass: 28,
  /**
   * The brand mark's own radius. The reference draws the 48px mark at 14 —
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
 * Liquid glass needs something to refract. A flat cream page gives a blurred
 * surface nothing to pick up, so the glass reads as plain translucency. These
 * are the soft colour fields that sit behind every panel: the surface tint
 * stays in the brand's warm neutral, and the fields supply the movement.
 */
export const glass = {
  /** Page wash behind the glass stack. */
  backdrop: '#F4F7FB',
  /** Large ambient fields, painted with expo-linear-gradient. */
  fieldTopLeft: ['#FBC9A8', '#F6E3D4', '#F4F7FB'],
  fieldBottomRight: ['#C6D9E8', '#E4E9F2', '#F4F7FB'],
  /** Per-panel tint, laid over the blur. */
  tint: 'rgba(255, 255, 255, 0.58)',
  tintStrong: 'rgba(255, 255, 255, 0.72)',
  /** Specular rim: a bright top edge that reads as a lit glass lip. */
  rim: 'rgba(255, 255, 255, 0.85)',
  rimFaint: 'rgba(255, 255, 255, 0.34)',
  /** Coloured shadow underneath, so panels sit on the field rather than float. */
  shadow: 'rgba(90, 106, 130, 0.16)',
  /**
   * Grain wash standing in for shader noise. A flat fill at very low opacity —
   * true per-pixel noise needs a GPU shader React Native has no path to.
   */
  grain: 'rgba(120, 130, 150, 0.5)',
  /** Text on glass must clear 4.5:1 against the *tinted* result, not white. */
  onGlass: '#1A2029',
  onGlassVariant: '#4A5568',
  /**
   * Icon/text accents darkened for use *on* glass. The M3 accents above were
   * chosen against opaque, light containers; over a translucent panel the warm
   * field shows through and #E65100 falls to 2.53:1, below even the 3:1
   * non-text floor. These three clear 4.5:1 against every field colour.
   */
  accentPrimary: '#8F3A00',
  accentSecondary: '#6B4B00',
  accentTertiary: '#334A56',
} as const;

/**
 * How a panel sits above the field.
 *
 * GlassCard carries these inline, so a filled card that has to match it needs
 * the same numbers or the page reads as two different layers of depth. The
 * colour is the backdrop's own — a pure-black shadow reads as dirt on a light
 * surface.
 *
 * `elevation` is the one Android-only line: the platform ignores every
 * `shadow*` prop without it, so a panel built from these numbers is flat on
 * Android and lifted on iOS and web.
 */
export const cardShadow = {
  shadowColor: glass.shadow,
  shadowOpacity: 1,
  shadowRadius: 15,
  shadowOffset: { width: 0, height: 8 },
  elevation: 4,
} as const;

/**
 * The frost on every glass panel, mapped from the reference's
 * `backdrop-filter: blur(18px) saturate(180%)` (home.html `.glass`).
 * At intensity 0 the BlurView samples nothing and the panel reads as a flat
 * white wash — the tint with no refraction — which is exactly the "white
 * card" the glass run is meant to replace. `saturate` has no React Native
 * primitive; the blur is the half that reads.
 */
export const glassBlur = 18;

/**
 * The accent fill for a coloured control: solid, not a wash.
 *
 * It used to sit at 0.9 alpha over the blur so the backdrop still breathed
 * through it — which read as glass, but at 0.9 over a blurred field the orange
 * never resolved and a filled pill looked like it had no colour at all. The
 * colour is now opaque: the card still owns the grain, the lit rim and the
 * shadow, and only the pigment is solid. White ink over it measures 5.2:1 in
 * light and dark (identical, because `primarySolid` is the same in both).
 */
export const tintedGlass = {
  accent: 'rgb(194, 65, 12)',
  /**
   * The error pigment, under the same rule as the accent: solid, so the red
   * resolves over the blur instead of washing out to a pink that reads as no
   * colour at all. `onError` white over it measures 6.5:1, and the card keeps
   * the grain, the lit rim and the shadow, so a red surface still reads as
   * this app's material rather than as a flat swatch.
   */
  error: 'rgb(186, 26, 26)',
} as const;

/**
 * The text ramp for a solid amber (`secondary`) surface.
 *
 * `onSecondary` alone is not enough for a fare card: a calculator is a table of
 * four kinds of line — the primary figure, its supporting steps, a muted aside
 * and a footnote — and they have to separate without dropping to white. White
 * on #FFB300 is roughly 1.9:1 and is never used; `onPrimary` on amber is the
 * same violation in a warmer ink. These four are the only permitted text
 * colours on amber, lightest last.
 */
export const onAmber = {
  primary: palette.onSecondary,
  detail: '#4F3D2B',
  muted: '#5B4720',
  faint: '#6B5518',
} as const;

/**
 * The pale amber CONTAINER's own outline, beside `onAmber`.
 *
 * A card that carries `secondaryContainer` as its fill cannot borrow the neutral
 * ramp: `outlineVariant` sits at ~1.7:1 on that fill, which is a card border and
 * never a rule. An interior hairline here has to be a warm tone of the fill
 * itself or it reads as dirt on the card.
 */
export const amberSurface = {
  /** Interior rules — the rows that divide a running trip's own facts. */
  rule: '#E0C489',
  /** The card's outer border. */
  border: '#E8C97A',
} as const;

/** Systematic 4pt spacing scale. */
export const space = (units: number) => units * 4;

/**
 * M3 type roles, set in Poppins.
 *
 * Poppins is geometric: tall x-height, single-storey `a`/`g`, and wide, even
 * letterforms. Two consequences for this scale:
 *
 * - It reads optically lighter than Roboto at the same px, so headings sit a
 *   step heavier (600/700) and body copy keeps generous line height — the tall
 *   caps need the room or lines collide.
 * - Wide letters need negative tracking as size grows. The wordmark takes -0.5,
 *   large text -0.3, and small caps go positive to stay airy.
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

export const accent = {
  primary: { fg: palette.primary, container: palette.primaryContainer, onContainer: palette.onPrimaryContainer },
  // #FFB300 is too light to read as text/icon on its own container (≈1.9:1),
  // so the role colour is a darker step of the same amber hue.
  secondary: { fg: '#8A6100', container: palette.secondaryContainer, onContainer: palette.onSecondaryContainer },
  tertiary: { fg: palette.tertiary, container: palette.tertiaryContainer, onContainer: palette.onTertiaryContainer },
} as const;

// ── Dark theme ──────────────────────────────────────────────────────────────
//
// The dark palette mirrors the light one role for role: a warm-neutral dark
// ramp, dark container/foreground pairs for the three accents, and a cool dark
// glass field so panels still refract. The light objects above stay the default
// for every existing import; a screen only goes dark by consuming the theme
// bundle from context (see `ThemeContext`), so existing screens keep rendering
// their original light values untouched.

export const darkPalette = {
  primary: '#FFB68B',
  onPrimary: '#4E2200',
  primaryContainer: '#6E3400',
  onPrimaryContainer: '#FFDCC4',

  /** Same role as the light `primarySolid`: a solid step deep enough for white. */
  primarySolid: '#C2410C',

  secondary: '#FFD066',
  onSecondary: '#3D2E00',
  secondaryContainer: '#5C4300',
  onSecondaryContainer: '#FFEFC7',

  tertiary: '#A9C7D4',
  onTertiary: '#162B33',
  tertiaryContainer: '#334A56',
  onTertiaryContainer: '#DDE6EA',

  error: '#FFB4AB',
  onError: '#410002',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',

  background: '#17120E',
  surface: '#17120E',
  surfaceContainerLowest: '#0F0B09',
  surfaceContainerLow: '#221B16',
  surfaceContainer: '#2A221C',
  surfaceContainerHigh: '#352B24',

  onSurface: '#F3EAE2',
  onSurfaceVariant: '#D7C2B7',
  outline: '#A08D84',
  outlineVariant: '#53433B',
  scrim: 'rgba(0, 0, 0, 0.55)',
} as const;

export const darkGlass = {
  backdrop: '#12161C',
  fieldTopLeft: ['#4A2C18', '#2A2118', '#12161C'],
  fieldBottomRight: ['#16283A', '#1B2330', '#12161C'],
  tint: 'rgba(255, 255, 255, 0.10)',
  tintStrong: 'rgba(255, 255, 255, 0.18)',
  rim: 'rgba(255, 255, 255, 0.28)',
  rimFaint: 'rgba(255, 255, 255, 0.14)',
  shadow: 'rgba(0, 0, 0, 0.5)',
  grain: 'rgba(255, 255, 255, 0.4)',
  onGlass: '#ECE7E1',
  onGlassVariant: '#B9AFA6',
  // On a dark field the light accents read directly — no darkened steps needed.
  accentPrimary: '#FFB68B',
  accentSecondary: '#FFD066',
  accentTertiary: '#A9C7D4',
} as const;

export const darkAccent = {
  primary: {
    fg: darkPalette.primary,
    container: darkPalette.primaryContainer,
    onContainer: darkPalette.onPrimaryContainer,
  },
  secondary: {
    fg: darkPalette.secondary,
    container: darkPalette.secondaryContainer,
    onContainer: darkPalette.onSecondaryContainer,
  },
  tertiary: {
    fg: darkPalette.tertiary,
    container: darkPalette.tertiaryContainer,
    onContainer: darkPalette.onTertiaryContainer,
  },
} as const;

export type ThemeMode = 'light' | 'dark';

/**
 * The token bundle a screen consumes. Deliberately a snapshot object, not a
 * scatter of context values, so a component takes one prop and stays render-
 * pure against theme swaps.
 *
 * The token shapes are keyed off the light palette with values widened to
 * `string`: the dark palette carries the same roles with different hexes, and
 * a bundle typed on the light literals could only ever hold light values.
 */
export type KonduktTheme = {
  mode: ThemeMode;
  palette: { [K in keyof typeof palette]: string };
  glass: {
    [K in keyof typeof glass]: K extends 'fieldTopLeft' | 'fieldBottomRight'
      ? readonly string[]
      : string;
  };
  accent: {
    [K in keyof typeof accent]: { fg: string; container: string; onContainer: string };
  };
};

export const lightTheme: KonduktTheme = { mode: 'light', palette, glass, accent };
export const darkTheme: KonduktTheme = {
  mode: 'dark',
  palette: darkPalette,
  glass: darkGlass,
  accent: darkAccent,
};

export function getTheme(mode: ThemeMode): KonduktTheme {
  return mode === 'dark' ? darkTheme : lightTheme;
}
