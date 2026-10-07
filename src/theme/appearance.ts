import { mixSrgb } from './color';
import type {
  Appearance,
  BackgroundGradient,
  BackgroundMode,
  ContrastSetting,
  GradientDirection,
  GradientIntensity,
  SurfaceStyle,
} from './types';

/**
 * The Advanced Appearance axes, and what each one actually does.
 *
 * Every axis here is a way of DRAWING the chosen theme, never a way of choosing
 * one. The line is the whole design: `contrast: 'high'` re-steps the same hue
 * to a stronger tone, while "use a different hue" is a new theme and belongs in
 * `specs.ts`. Keeping the two apart is what stops the seven controls from
 * quietly becoming a hundred themes nobody designed.
 *
 * The numbers here are the ones the app already shipped, read as data. Before
 * this module they were literals inside `theme.ts`; they move here because
 * they are now settings rather than constants, and a setting that lives in a
 * literal is a setting nobody can change.
 */

/**
 * The app's own values, and the defaults for every axis.
 *
 * `background: gradient` and `balanced` intensity are what the warm theme has
 * always looked like, so an untouched install renders identically: the default
 * appearance has to BE the current design, not an approximation of it.
 */
export const DEFAULT_APPEARANCE: Appearance = {
  background: 'gradient',
  gradientIntensity: 'balanced',
  gradientDirection: 'tlBr',
  surfaceStyle: 'standard',
  contrast: 'standard',
  dynamicAccent: false,
  reduceEffects: false,
};

/** One of the seven axes, named. */
export type AppearanceAxis = keyof Appearance;

/** The five axes whose values are words rather than flags. */
export type AppearanceChoiceAxis =
  | 'background'
  | 'gradientIntensity'
  | 'gradientDirection'
  | 'surfaceStyle'
  | 'contrast';

/**
 * Every value each enumerated axis accepts, in the order the screen lists them.
 *
 * This is the runtime twin of the five unions in `types.ts`: the union is what
 * the engine is TYPED against, and this is what a value read back out of the
 * preference store is CHECKED against, so a hand-edited device or a build that
 * retired a value can never hand the transform something it cannot render.
 * Each array is checked against its own union by the `satisfies` clause below,
 * which is why a typo in a list is a build failure rather than a value the
 * store would write and the engine would not accept.
 */
export const APPEARANCE_AXIS_VALUES = {
  background: ['gradient', 'soft', 'solid'],
  gradientIntensity: ['subtle', 'balanced', 'strong'],
  gradientDirection: ['tlBr', 'topBottom', 'leftRight', 'blTr'],
  surfaceStyle: ['standard', 'soft', 'elevated'],
  contrast: ['standard', 'high'],
} as const satisfies { [K in AppearanceChoiceAxis]: readonly Appearance[K][] };

/**
 * How hard the ambient fields read over the backdrop.
 *
 * These scale the theme's own gradient stops — they do not invent colours. A
 * stronger gradient is the same three stops at higher opacity, which is the
 * difference between "tinted" and "coloured" and never a different palette.
 */
const INTENSITY: Record<GradientIntensity, number> = {
  subtle: 0.45,
  balanced: 0.78,
  strong: 1,
};

/**
 * Direction is a pair of vectors for `expo-linear-gradient`, not a rotation of
 * the theme. `tlBr` is the reference's 135° and the one the app ships today.
 */
const DIRECTION: Record<GradientDirection, { start: { x: number; y: number }; end: { x: number; y: number } }> = {
  tlBr: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  topBottom: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
  leftRight: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  blTr: { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
};

/**
 * How many ambient fields paint.
 *
 * Gradient is the app's current two-field wash; Soft drops to the single warm
 * field, which keeps the page from reading as two coloured blobs at the width
 * of a phone; Solid paints none and leaves the backdrop flat. Only the
 * BACKGROUND takes the gradient — cards stay solid, which is what keeps a
 * themed page from turning into wallpaper.
 */
const FIELD_COUNT: Record<BackgroundMode, number> = {
  gradient: 2,
  soft: 1,
  solid: 0,
};

/** The card treatment. The numbers are the ones `theme.ts` shipped. */
export type SurfaceTreatment = {
  /** Alpha of the panel wash over the blurred field. */
  tintAlpha: number;
  /** Alpha of the lit rim, the specular lip on the panel's top edge. */
  rimAlpha: number;
  /** Blur radius, or 0 when visual effects are reduced. */
  blur: number;
  /** Blur radius of the strong wash, used by filled controls. */
  tintStrongAlpha: number;
  rimFaintAlpha: number;
  shadow: { radius: number; offset: number; elevation: number };
  grainAlpha: number;
};

/**
 * The contrast floors, per mode.
 *
 * These are the numbers the audit enforces and the transform solves against,
 * in one place so they cannot drift apart: if the test's floor and the
 * derivation's floor disagree, the derivation stops guaranteeing and the test
 * starts failing for a reason nobody chose.
 */
export const CONTRAST_FLOORS: Record<ContrastSetting, {
  onSurfaceVariant: number;
  outline: number;
  /** Outline is also a border, so it is held to the non-text floor. */
  hairline: number;
  /** The floor for text on the amber/secondary fill. */
  secondaryBody: number;
}> = {
  // Standard is calibrated to the shipped bundle, not to the minimum: the app's
  // `onSurfaceVariant` clears 7:1, and dropping it to the 4.5 floor would grey
  // out the 191 places that use it. High then moves it somewhere visibly
  // stronger, which is what a driver turning this on is asking for.
  standard: { onSurfaceVariant: 7, outline: 3, hairline: 3, secondaryBody: 4.5 },
  high: { onSurfaceVariant: 9.5, outline: 4.5, hairline: 4.5, secondaryBody: 7 },
};

/** The floor every text role owes, in both settings and both modes. */
export const BODY_FLOOR = 4.5;
/** The floor for display text, icons and other non-text UI. */
export const NON_TEXT_FLOOR = 3;
/**
 * The floor the brand fill owes its own ink.
 *
 * White on the shipped `#C2410C` measures 5.18:1, and 5.15 is that number
 * measured rather than rounded up: the solver targets this and the audit
 * asserts it, so a palette authored against the real value passes and a
 * palette that drifts a step darker still fails.
 */
export const SOLID_FILL_FLOOR = 5.15;

/**
 * Resolves the appearance into the numbers the bundle needs.
 *
 * One pure function so the transform never asks a question it cannot answer:
 * every axis is read here, and `derive.ts` receives a flat set of values with
 * no conditional logic of its own.
 */
export function resolveAppearance(appearance: Appearance, mode: 'light' | 'dark') {
  const reduce = appearance.reduceEffects;
  const soft = appearance.surfaceStyle === 'soft';
  const elevated = appearance.surfaceStyle === 'elevated';
  // The dark wash is already near-transparent, so it has to start lower: the
  // same 0.58 over a dark field is a grey fog.
  const dark = mode === 'dark';
  const base = dark
    ? { tint: 0.1, tintStrong: 0.18, rim: 0.28, rimFaint: 0.14, grain: 0.4 }
    : { tint: 0.58, tintStrong: 0.72, rim: 0.85, rimFaint: 0.34, grain: 0.5 };
  const scale = soft ? 0.5 : elevated ? 1.35 : 1;

  return {
    fields: FIELD_COUNT[appearance.background],
    intensity: INTENSITY[appearance.gradientIntensity],
    direction: DIRECTION[appearance.gradientDirection],
    floors: CONTRAST_FLOORS[appearance.contrast],
    dynamicAccent: appearance.dynamicAccent,
    treatment: {
      tintAlpha: Math.min(0.95, Number((base.tint * scale).toFixed(3))),
      tintStrongAlpha: Math.min(0.98, Number((base.tintStrong * scale).toFixed(3))),
      rimAlpha: Number(Math.min(0.98, base.rim * (soft ? 0.6 : elevated ? 1 : 1)).toFixed(3)),
      rimFaintAlpha: Number((base.rimFaint * scale).toFixed(3)),
      // Reduced effects is a legibility and battery affordance, not a style:
      // the panel keeps its tint so the card still separates from the field,
      // and loses only the refraction and the lift.
      blur: reduce ? 0 : Number((18 * (soft ? 0.5 : elevated ? 1.3 : 1)).toFixed(1)),
      shadow: reduce || soft
        ? { radius: 0, offset: 0, elevation: 0 }
        : { radius: elevated ? 22 : 15, offset: elevated ? 11 : 8, elevation: elevated ? 7 : 4 },
      grainAlpha: reduce ? 0 : 0.035,
    } satisfies SurfaceTreatment,
  };
}

/**
 * The intensity the app has always shipped with.
 *
 * The three numbers above are relative to the field the reference draws, and
 * that field is the `balanced` one: the shipped page IS `#FBC9A8 → #F4F7FB →
 * #C6D9E8` at full strength. So this is the zero point, and everything above and
 * below it is measured from here rather than from nothing.
 */
const REFERENCE_INTENSITY = INTENSITY.balanced;

/**
 * The three stops to paint for a resolved background gradient.
 *
 * `derive.ts` resolves the axes into a descriptor — the theme's own stops, a
 * direction, an intensity and how many fields paint — and this is where that
 * descriptor becomes pixels. It lives here rather than in a component because it
 * is a fact about the appearance, not about a screen: the backdrop, the theme
 * preview on Advanced Settings and every theme swatch must paint the same
 * field, or a control lies about what it changed.
 *
 * INTENSITY IS MEASURED FROM BALANCED, which is what keeps an untouched install
 * untouched. Pulling a stop 78% of the way to the backdrop would NOT reproduce
 * the shipped field — the shipped field is the stop itself — so `balanced`
 * pulls nothing at all, `subtle` pulls the corners most of the way in, and
 * `strong` pulls them AWAY (a negative mix, clamped at the ends), which is the
 * only direction left once the authored stop is the strongest there is. All
 * three move in the theme's own hue; none of them invents a colour.
 *
 * Field count comes from the same `FIELD_COUNT` table the descriptor already
 * carries: two fields is the app's two-colour wash, one leaves the warm corner
 * fading into a flat page, and none leaves the page flat.
 */
export function resolveFieldStops(
  gradient: BackgroundGradient,
): readonly [string, string, string] {
  const [warm, base, cool] = gradient.colors;
  const pull = (REFERENCE_INTENSITY - gradient.intensity) / REFERENCE_INTENSITY;
  const count = FIELD_COUNT[gradient.mode];
  // At the reference intensity the stop is handed back AS IT IS, not mixed by
  // zero: same colour, but the token's own string, so an untouched install
  // paints byte-for-byte what it painted before these axes existed.
  const corner = (stop: string) => (pull === 0 ? stop : mixSrgb(stop, base, pull));
  return [
    count >= 1 ? corner(warm) : base,
    base,
    count >= 2 ? corner(cool) : base,
  ];
}

export type ResolvedAppearance = ReturnType<typeof resolveAppearance>;

/** Re-exported so a caller can name the axis it is reading. */
export type { SurfaceStyle };