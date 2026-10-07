/**
 * The types the theme registry is written against.
 *
 * Kept in their own module with no imports so the data files (specs), the
 * maths (color) and the transform (derive) can all depend on the vocabulary
 * without depending on each other.
 */

export type ThemeMode = 'light' | 'dark';

/**
 * The native mode of a theme.
 *
 * Three of the ten named themes are dark by design, so a theme declares which
 * mode it belongs to. That is a declaration about the THEME, not about the
 * app's setting: the Light/Dark control still renders any theme in either
 * mode, and the mode is what decides whether the neutral family runs dark-on-
 * light or light-on-dark. See `derive.ts` for how a dark theme renders in
 * Light mode.
 */
export type ThemeDialect = ThemeMode;

/** The three ambient stops: warm corner, page base, cool corner. */
export type Gradient3 = readonly [string, string, string];

// ── the authored spec ──────────────────────────────────────────────────────

/**
 * A theme as a designer states it: the colours that are actually chosen.
 *
 * Everything else the app needs — the six-step surface ramp, both lines, four
 * container inks, the glass layer, the secondary ink ramp, success and warning —
 * is DERIVED from these by `derive.ts`. A spec that grows to thirty colours is
 * a spec that has stopped being a design and started being a copy of the
 * output.
 */
export type ThemeSpec = {
  /** Stable id: the persisted value. Never localise it, never renumber it. */
  id: string;
  /** The name the theme card shows. */
  name: string;
  /** The consequence, which is the thing being chosen between. */
  note: string;
  /** Which mode this theme belongs to. */
  dialect: ThemeDialect;
  /** The page surface the theme's neutral family is built on. */
  surface: string;
  /** The theme's own text colour on that surface. */
  text: string;
  primary: string;
  secondary: string;
  accent: string;
  gradient: Gradient3;
  /**
   * Documented exceptions to the transform.
   *
   * Every value here is a hand-measured decision that the derivation could not
   * produce — a brand hue that has to stay a specific hex, or a pair the
   * contrast floor forced to a tone that no formula would have chosen. The
   * audit treats these as first-class: a floor failure in this map is a
   * deliberate exception and is reported as one, not hidden.
   */
  overrides?: ThemeOverrides;
};

/** Per-mode token overrides. The mode is on the map, not inside a token. */
export type ThemeOverrides = {
  light?: Partial<ThemeTokenValues>;
  dark?: Partial<ThemeTokenValues>;
};

/**
 * Every colour the bundle exposes, by name, so an override is addressed the
 * same way the audit addresses a pair.
 */
export type ThemeTokenValues = {
  palette: { [K in keyof ThemePaletteTokens]: string };
  glass: { [K in keyof ThemeGlassTokens]: ThemeGlassTokens[K] };
  accent: ThemeAccentTokens;
  onSecondaryRamp: { [K in keyof ThemeSecondaryRampTokens]: string };
  amberSurface: { [K in keyof ThemeAmberSurfaceTokens]: string };
  tintedGlass: { [K in keyof ThemeTintedGlassTokens]: string };
  onPrimarySolid: string;
};

// ── the derived token sets ─────────────────────────────────────────────────

export type ThemePaletteTokens = {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  primarySolid: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  /** New in the registry: a real success family, measured like the error one. */
  success: string;
  onSuccess: string;
  successContainer: string;
  onSuccessContainer: string;
  /** New in the registry: a real warning family, measured like the error one. */
  warning: string;
  onWarning: string;
  warningContainer: string;
  onWarningContainer: string;
  background: string;
  surface: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  scrim: string;
};

export type ThemeGlassTokens = {
  backdrop: string;
  fieldTopLeft: readonly string[];
  fieldBottomRight: readonly string[];
  tint: string;
  tintStrong: string;
  rim: string;
  rimFaint: string;
  shadow: string;
  grain: string;
  onGlass: string;
  onGlassVariant: string;
  accentPrimary: string;
  accentSecondary: string;
  accentTertiary: string;
  /** New in the registry: the blur radius, so "reduce visual effects" is a token. */
  blur: number;
};

export type ThemeAccentTokens = {
  primary: { fg: string; container: string; onContainer: string };
  secondary: { fg: string; container: string; onContainer: string };
  tertiary: { fg: string; container: string; onContainer: string };
};

/** The four inks a solid `secondary` fill accepts, stepped by contrast. */
export type ThemeSecondaryRampTokens = {
  primary: string;
  detail: string;
  muted: string;
  faint: string;
};

export type ThemeAmberSurfaceTokens = { rule: string; border: string };
export type ThemeTintedGlassTokens = { accent: string; error: string };

/**
 * The semantic layer the mission names.
 *
 * Every entry is an alias onto an M3 role that already exists — nothing here is
 * a second opinion about a colour, so a component can be written against
 * `text` today and still read `palette.onSurface` after a theme change. The one
 * entry with real content is `backgroundGradient`, because the gradient is a
 * composed value: the stops plus the resolved direction and intensity.
 */
export type ThemeSemanticTokens = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  backgroundGradient: BackgroundGradient;
  surface: string;
  surfaceElevated: string;
  text: string;
  textSecondary: string;
  outline: string;
  outlineVariant: string;
  icon: string;
  success: string;
  warning: string;
  error: string;
};

export type BackgroundGradient = {
  /** Three stops: warm corner, page base, cool corner. */
  colors: readonly [string, string, string];
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** 0-1, how hard the fields read over the backdrop. */
  intensity: number;
  /** Whether the fields paint at all, or the page is a flat surface. */
  mode: BackgroundMode;
};

export type BackgroundMode = 'gradient' | 'soft' | 'solid';
export type GradientIntensity = 'subtle' | 'balanced' | 'strong';
export type GradientDirection = 'tlBr' | 'topBottom' | 'leftRight' | 'blTr';
export type SurfaceStyle = 'standard' | 'soft' | 'elevated';
export type ContrastSetting = 'standard' | 'high';

/**
 * The seven Advanced Appearance axes.
 *
 * They are settings about how the theme is drawn, not about what it is: the
 * same theme with `contrast: 'high'` must still be the same theme. Anything
 * that changes which colours exist belongs in the spec instead.
 */
export type Appearance = {
  background: BackgroundMode;
  gradientIntensity: GradientIntensity;
  gradientDirection: GradientDirection;
  surfaceStyle: SurfaceStyle;
  contrast: ContrastSetting;
  /** Accent follows the gradient's dominant hue instead of the declared accent. */
  dynamicAccent: boolean;
  /** Blur, grain and lift off; the layout is unchanged. */
  reduceEffects: boolean;
};

/**
 * The token bundle a screen consumes.
 *
 * `palette`, `glass` and `accent` keep the names and the shapes the app has
 * always read, so the forty-odd components that consume them are unaffected by
 * a theme change. The registry adds identity, the resolved appearance, the
 * derived companions that used to be module constants, and the semantic layer
 * the mission names.
 */
export type KonduktTheme = ThemeTokenValues & {
  mode: ThemeMode;
  /** Which registry entry produced this bundle. */
  id: string;
  /** The theme's declared mode, which the Light/Dark control can move away from. */
  dialect: ThemeDialect;
  /** The resolved appearance this bundle was built for. */
  appearance: Appearance;
  semantic: ThemeSemanticTokens;
};