import {
  BODY_FLOOR,
  NON_TEXT_FLOOR,
  SOLID_FILL_FLOOR,
  DEFAULT_APPEARANCE,
  resolveAppearance,
  type ResolvedAppearance,
} from './appearance';
import { atL, carryable, contrast, maxContrast, mixSrgb, parseColor, rgbToOklch, solveTone } from './color';
import type {
  Appearance,
  BackgroundGradient,
  KonduktTheme,
  ThemeAccentTokens,
  ThemeAmberSurfaceTokens,
  ThemeGlassTokens,
  ThemeMode,
  ThemePaletteTokens,
  ThemeSecondaryRampTokens,
  ThemeSemanticTokens,
  ThemeSpec,
  ThemeTintedGlassTokens,
  ThemeTokenValues,
} from './types';

/**
 * One spec in, one token bundle out.
 *
 * THE RULE. Nothing in here invents a colour. Every token is placed by moving
 * the THEME'S OWN HUE to a lightness that meets the role's contrast floor, so
 * a theme's identity is carried by hue and chroma and never by a tone somebody
 * liked. "Every theme has sufficient contrast" is therefore a property of this
 * function rather than a claim, and the audit re-measures it anyway.
 *
 * TWO THINGS ARE NOT DERIVED, AND BOTH ARE DELIBERATE.
 *
 * The theme's declared `text` and `surface` are authoritative in the theme's
 * own dialect: those two were authored as a pair, and replacing either with a
 * formula would ignore the brief. The declared text is used verbatim whenever
 * it clears the body floor and re-solved only when it does not, which is also
 * what happens to a dark theme rendered in Light mode.
 *
 * And a spec may carry `overrides`. That map is where an AUTHORED palette
 * lives. `kondukt` is the warm M3 scheme the app has always shipped: 106
 * hand-measured values, each one a decision about how this app looks, and not
 * one of them recoverable from six seed colours. The registry declares them and
 * everything else it needs is derived; the other ten themes declare six colours
 * each and are derived end to end. An override applies at the DEFAULT
 * appearance only, because an appearance axis exists precisely to re-step a
 * theme, so a palette pinned for the standard look must not also pin the
 * high-contrast or dynamic-accent answer.
 */

/** Where a role's ink sits relative to the surface it is read on. */
type Dir = 'lighter' | 'darker';

type Solved = { hex: string; ratio: number; reached: boolean };

/**
 * The hue the glass neutrals are cast in.
 *
 * The backdrop's, not the surface's: a warm page under a cool field, and a warm
 * shadow on it reads as dirt rather than as depth. The app's shipped shadow is
 * `rgba(90, 106, 130, ...)`, which is this hue at L 0.45.
 */
const COOL = 258;

/** The surface lightness each mode's neutral family is built on. */
const BASE_L = { light: 0.9797, dark: 0.1869 } as const;

/** One step of the surface ramp, per mode. Calibrated against the shipped bundle. */
const SURFACE_STEP = { light: 0.0195, dark: 0.035 } as const;

/** How far each container sits from the base, in steps. */
const CONTAINER_STEPS = [1.19, 2.07, 3.1] as const;

/**
 * The `outlineVariant` hairline, as an offset from the base.
 *
 * No contrast floor, deliberately: this is a divider, and the shipped bundle's
 * sits at 1.7:1 on purpose. Giving it a floor would turn every hairline into a
 * border and rebuild the screen's hierarchy.
 */
const HAIRLINE_OFFSET = { light: -0.151, dark: 0.21 } as const;

/**
 * How light the ambient field's stops sit, per mode.
 *
 * A theme's gradient is authored for its own dialect. Rendering a dark-dialect
 * theme in Light mode left the raw dark stops in place, so the page was light
 * and the fields behind the glass were near-black - which is what made every
 * glass ink unreadable, in either direction. The stops are re-toned to this
 * mode's field band, keeping their hue, and used verbatim in their own dialect.
 */
const FIELD_L = { light: 0.872, dark: 0.3 } as const;

/** The accent container's distance from the base surface. */
const CONTAINER_OFFSET = { light: -0.04, dark: 0.145 } as const;

/** Fixed hues for the roles the app owns rather than themes choosing. */
const HUE = {
  /** Informational and neutral functionality - the app's blue-slate. */
  tertiary: 228,
  error: 28,
  warning: 85,
  success: 150,
} as const;

/** Chroma each fixed-hue family is allowed. Low on tertiary by design. */
const HUE_CHROMA = { tertiary: 0.036, error: 0.193, warning: 0.15, success: 0.13 } as const;

/**
 * The four inks a solid secondary fill accepts, by contrast against that fill.
 *
 * The app's own measured numbers, in this order: the strongest label on the
 * amber button, then the three steps below it.
 */
const SECONDARY_RAMP_FLOORS = [7, 6, 5.2, 4.6] as const;

/**
 * The pale amber panel's own rule and border, as offsets below its container.
 *
 * Two hand-measured numbers rather than a formula: the pair brackets the
 * container edge at a width that reads as a hairline on one side and a lip on
 * the other, and no contrast floor describes that.
 */
const AMBER_RULE_OFFSET = 0.125;
const AMBER_BORDER_OFFSET = 0.11;

const clampChroma = (value: number, max = 0.2) => Math.min(Math.max(value, 0), max);

function hexChannels(value: string): { r: number; g: number; b: number } {
  const { rgb } = parseColor(value);
  return { r: Math.round(rgb.r), g: Math.round(rgb.g), b: Math.round(rgb.b) };
}

const shadowNeutral = hexChannels(atL(COOL, 0.45, 0.035));
const grainNeutral = hexChannels(atL(COOL, 0.55, 0.025));

/**
 * The ink a solid fill accepts.
 *
 * Contrast is symmetric, so the answer is always one of the two extremes or a
 * step away from one. This walks out from the extreme that carries the fill,
 * holding the fill's hue at a chroma low enough to read as ink rather than as a
 * second fill - which is how the app's amber button has always taken a warm
 * brown instead of black, and how white stays white on a fill that clears it.
 *
 * Solving FROM the fill's own lightness is what lets one function serve every
 * role: the hue comes from the fill, but the walk never crosses the fill, so no
 * fill can produce an ink lighter than itself.
 */
function inkFor(fill: string, hue: number, chroma: number, floor: number): string {
  const whiteCarries = contrast('#FFFFFF', fill) >= floor;
  // The walk starts at the PURE ink, not at a re-render of the fill at the
  // fill's own lightness. Starting at the fill meant the first candidate was a
  // hair off the extreme, so a fill sitting exactly on its floor was handed an
  // ink that missed it - 4.46:1 against a 4.5:1 requirement - because the solver
  // had never tested the one colour that actually clears it.
  return solveTone({
    hue,
    chroma,
    from: fill,
    dir: whiteCarries ? 'darker' : 'lighter',
    min: floor,
    startL: whiteCarries ? 1 : 0,
  }).hex;
}

/**
 * Solves one ink against EVERY colour it must clear.
 *
 * The glass inks are the case that needs this: `onGlass` is read over three
 * field colours plus the backdrop, and solving against only one of them is how
 * a panel ends up legible at the top-left corner and unreadable at the
 * bottom-right. Each pass re-solves against the field the ink is currently
 * closest to, and contrast is monotonic in lightness, so this converges.
 */
function solveAgainstFields({
  hue,
  chroma,
  dir,
  fields,
  min,
  startL,
}: {
  hue: number;
  chroma: number;
  dir: Dir;
  fields: readonly string[];
  min: number;
  startL?: number;
}): Solved {
  let reference = fields[0];
  let result = solveTone({ hue, chroma, from: reference, dir, min, startL });
  for (let pass = 0; pass < 3; pass++) {
    const worst = fields.reduce((soFar, field) =>
      contrast(result.hex, field) < contrast(result.hex, soFar) ? field : soFar,
    );
    if (worst === reference) break;
    reference = worst;
    result = solveTone({ hue, chroma, from: reference, dir, min, startL });
  }
  return result;
}

/** A gradient stop in the mode being rendered, or verbatim in its own dialect. */
function modeTone(stop: string, mode: ThemeMode, native: boolean): string {
  if (native) return stop;
  const as = rgbToOklch(parseColor(stop).rgb);
  return atL(as.h, FIELD_L[mode], as.c);
}

/**
 * The role colour for a mark: the declared fill when it can do the job, and the
 * same hue stepped toward the ink when it cannot.
 *
 * This is the difference between the BRAND colour and the ROLE colour. A theme's
 * `primary` is the fill of a button and is kept verbatim even when it cannot
 * read as a 3:1 mark on a pale page - that is the designer's decision and no
 * formula should overrule it. `accent.primary.fg` is a different role: it is
 * drawn as a mark, on the page AND on its own container, so it is held to the
 * non-text floor against both, and the app's own amber step is exactly this
 * idea - the same hue, one step darker, so it can be used as an icon.
 */
function roleFill(fill: string, hue: number, chroma: number, container: string, surface: string): string {
  const worst = contrast(fill, container) < contrast(fill, surface) ? container : surface;
  if (contrast(fill, worst) >= NON_TEXT_FLOOR) return fill;
  // Away from the surface it is drawn on, which in Dark mode means lighter.
  // Walking darker unconditionally sent every dark-mode mark to black, which on
  // a dark page is the same colour as the page.
  const dir: Dir = rgbToOklch(parseColor(worst).rgb).l > 0.5 ? 'darker' : 'lighter';
  return solveTone({ hue, chroma, from: worst, dir, min: NON_TEXT_FLOOR }).hex;
}

/** Builds one background field: the theme's own stop, its mid, then the base. */
function field(stop: string, base: string): string[] {
  return [stop, mixSrgb(stop, base, 0.45), base];
}

/**
 * Places one accent family: the fill, its ink, the container and the ink on
 * that container.
 *
 * All four are solved rather than stepped, because every colour in the brief
 * sits where white ink fails: Cyber's cyan is 1.54:1 with white, so a formula
 * that assumed "accent plus white" would produce the one combination that can
 * never carry text. Solving the ink's direction from the fill's own lightness
 * handles it with no special case.
 */
function accentFamily({
  hue,
  chroma,
  dark,
  baseL,
  inkFloor,
  containerFloor,
  declared,
}: {
  hue: number;
  chroma: number;
  dark: boolean;
  /** The theme's base surface lightness, so containers stay in its family. */
  baseL: number;
  /** The floor for the fill's own ink: body for text roles, non-text for icons. */
  inkFloor: number;
  /** The floor for the label that sits on this family's container. */
  containerFloor: number;
  /** The brief's own colour for this role, when it is the fill. */
  declared?: string;
}): { fill: string; onFill: string; container: string; onContainer: string } {
  // THE PRECEDENCE RULE. A declared colour is the designer's decision, so it is
  // kept verbatim whenever EITHER ink can carry it - `carryable`, not a
  // white-only test, because the app's own precedent is an amber button that
  // takes a dark brown label. A fill that no ink can carry is the one case the
  // solver owns: it steps the theme's own hue toward the mode's ink until the
  // floor is met, which is what rescues Cyber's cyan.
  const fill =
    declared !== undefined && carryable(declared, inkFloor)
      ? declared
      : solveTone({
          hue,
          chroma,
          from: dark ? '#000000' : '#FFFFFF',
          dir: dark ? 'lighter' : 'darker',
          min: inkFloor,
        }).hex;
  const onFill = inkFor(fill, hue, clampChroma(chroma * 0.35, 0.06), inkFloor);
  const container = atL(
    hue,
    baseL + CONTAINER_OFFSET[dark ? 'dark' : 'light'],
    clampChroma(chroma * 0.28, 0.06),
  );
  const onContainer = inkFor(container, hue, clampChroma(chroma * 0.35, 0.08), containerFloor);
  return { fill, onFill, container, onContainer };
}
/**
 * Builds a full token bundle for one spec in one mode under one appearance.
 *
 * Pure: same three arguments, same bundle, every time. Nothing here reads a
 * clock, a store, or a preference - persistence is a different layer's job.
 */
export function buildTheme(
  spec: ThemeSpec,
  mode: ThemeMode,
  appearance: Appearance = DEFAULT_APPEARANCE,
): KonduktTheme {
  const a: ResolvedAppearance = resolveAppearance(appearance, mode);
  const floors = a.floors;
  const dark = mode === 'dark';

  // ── the neutral family ───────────────────────────────────────────────────
  // A theme's own surface in its own dialect; otherwise the same hue stepped to
  // this mode's anchor lightness. Its hue is what carries the tint.
  const surfaceColor = rgbToOklch(parseColor(spec.surface).rgb);
  const neutralHue = surfaceColor.h;
  const neutralChroma = clampChroma(surfaceColor.c, 0.03);
  const base = atL(neutralHue, BASE_L[mode], neutralChroma);
  const baseL = rgbToOklch(parseColor(base).rgb).l;
  const step = SURFACE_STEP[mode];
  const dir: Dir = dark ? 'lighter' : 'darker';
  // The same direction as a number, for the ramp: in Dark mode the containers
  // climb away from a dark page, in Light mode they descend from a light one.
  const sign = dark ? 1 : -1;
  const inkChroma = clampChroma(neutralChroma * 1.9 + 0.012, 0.034);

  const ramp = {
    surfaceContainerLowest: atL(neutralHue, dark ? baseL - 0.033 : 1, dark ? neutralChroma : 0),
    surfaceContainerLow: atL(neutralHue, baseL + sign * step * CONTAINER_STEPS[0], neutralChroma),
    surfaceContainer: atL(neutralHue, baseL + sign * step * CONTAINER_STEPS[1], neutralChroma * 1.6),
    surfaceContainerHigh: atL(neutralHue, baseL + sign * step * CONTAINER_STEPS[2], neutralChroma * 1.6),
  };

  // The authored text wins whenever it is readable; otherwise it is solved.
  const authoredTextClears = contrast(spec.text, base) >= BODY_FLOOR;
  const onSurface =
    spec.dialect === mode && authoredTextClears
      ? spec.text
      : solveTone({ hue: neutralHue, chroma: inkChroma, from: base, dir, min: 12 }).hex;
  // Both lines are solved against the surface they are HARDEST on, not against
  // the page. Secondary text is read on cards as often as on the page, and a
  // variant solved to 7:1 on white came out at 6:1 on the darkest container -
  // which is the 191 places that use it failing where nobody was looking.
  // `surfaceContainerHigh` is the hardest surface in BOTH modes, and for the
  // same reason: it is the container furthest from the ink. In Light mode the
  // containers descend, so High is the darkest; in Dark mode they climb, so
  // High is the lightest. `surfaceContainerLowest` is the easiest either way.
  const hardestSurface = ramp.surfaceContainerHigh;
  const onSurfaceVariant = solveTone({
    hue: neutralHue,
    chroma: inkChroma * 1.4,
    from: hardestSurface,
    dir,
    min: floors.onSurfaceVariant,
  }).hex;
  const outline = solveTone({
    hue: neutralHue,
    chroma: inkChroma,
    from: hardestSurface,
    dir,
    min: floors.outline,
  }).hex;
  const outlineVariant = atL(neutralHue, baseL + HAIRLINE_OFFSET[mode], neutralChroma * 2.6);

  // ── the accents ──────────────────────────────────────────────────────────
  // The accent hue is the theme's own, unless Dynamic Accent is on, in which
  // case it is the gradient's mid stop - accent and ambient background then
  // agree by construction.
  const declaredAccent = rgbToOklch(parseColor(spec.accent).rgb);
  const gradientMid = rgbToOklch(parseColor(spec.gradient[1]).rgb);
  const accentHue = a.dynamicAccent ? gradientMid.h : declaredAccent.h;
  const accentChroma = clampChroma(
    a.dynamicAccent ? Math.max(declaredAccent.c, 0.12) : declaredAccent.c,
    0.22,
  );
  const primaryColor = rgbToOklch(parseColor(spec.primary).rgb);
  const secondaryColor = rgbToOklch(parseColor(spec.secondary).rgb);

  const primaryFamily = accentFamily({
    hue: primaryColor.h, chroma: primaryColor.c, dark, baseL,
    inkFloor: NON_TEXT_FLOOR, containerFloor: BODY_FLOOR, declared: spec.primary,
  });
  const secondaryFamily = accentFamily({
    hue: secondaryColor.h, chroma: secondaryColor.c, dark, baseL,
    inkFloor: BODY_FLOOR, containerFloor: BODY_FLOOR, declared: spec.secondary,
  });
  const tertiaryFamily = accentFamily({
    hue: HUE.tertiary, chroma: HUE_CHROMA.tertiary, dark, baseL,
    inkFloor: BODY_FLOOR, containerFloor: BODY_FLOOR,
  });
  const errorFamily = accentFamily({
    hue: HUE.error, chroma: HUE_CHROMA.error, dark, baseL,
    inkFloor: BODY_FLOOR, containerFloor: BODY_FLOOR,
  });
  const warningFamily = accentFamily({
    hue: HUE.warning, chroma: HUE_CHROMA.warning, dark, baseL,
    inkFloor: BODY_FLOOR, containerFloor: BODY_FLOOR,
  });
  const successFamily = accentFamily({
    hue: HUE.success, chroma: HUE_CHROMA.success, dark, baseL,
    inkFloor: BODY_FLOOR, containerFloor: BODY_FLOOR,
  });
  const accentFamilyTokens = accentFamily({
    hue: accentHue, chroma: accentChroma, dark, baseL,
    inkFloor: NON_TEXT_FLOOR, containerFloor: BODY_FLOOR,
    // Dynamic Accent derives the hue from the gradient, so there is nothing
    // declared to prefer there and the solver supplies the tone.
    declared: a.dynamicAccent ? undefined : spec.accent,
  });

  const primary = primaryFamily.fill;
  const secondary = secondaryFamily.fill;
  const tertiary = tertiaryFamily.fill;

  /**
   * The brand fill, and the ink that sits on it.
   *
   * `primarySolid` is solved against WHITE and white is the ink, always: the
   * shipped bundle documents white-on-solid at 5.2:1 in both modes, and the only
   * reason it can stay white across eleven themes is that this solve makes it
   * true. For Cyber's cyan it lands on a deep teal - the same hue, stepped until
   * the button is readable.
   */
  const primarySolid = solveTone({
    hue: primaryColor.h,
    chroma: primaryColor.c,
    from: '#FFFFFF',
    dir: 'darker',
    min: SOLID_FILL_FLOOR,
    startL: primaryColor.l,
  }).hex;

  // The four inks a solid secondary fill accepts, stepped by contrast. The hue
  // is the fill's own, which is why Cyber's violet gets a violet ramp instead of
  // the app's shared amber one.
  const secondaryInkChroma = clampChroma(secondaryColor.c * 0.42, 0.09);
  // The floors are TARGETS. A fill cannot always reach them: the best ink any
  // colour can carry is bounded by its own lightness, so asking Cyber's violet
  // for a 7:1 label would send the solver to the end of the gamut and hand back
  // the same 4.36:1 either way. Capping the ask at the reachable ceiling keeps
  // the ramp honest - the strongest entry really is the strongest ink the fill
  // has - and the audit reports the shortfall rather than hiding it.
  const secondaryCeiling = maxContrast(secondary);
  const secondaryInk = (floor: number, chroma: number) =>
    inkFor(secondary, secondaryColor.h, chroma, Math.min(floor, secondaryCeiling));
  const onSecondaryRamp: ThemeSecondaryRampTokens = {
    primary: secondaryInk(SECONDARY_RAMP_FLOORS[0], secondaryInkChroma),
    detail: secondaryInk(SECONDARY_RAMP_FLOORS[1], secondaryInkChroma),
    muted: secondaryInk(SECONDARY_RAMP_FLOORS[2], secondaryInkChroma * 0.8),
    faint: secondaryInk(
      Math.max(SECONDARY_RAMP_FLOORS[3], floors.secondaryBody),
      secondaryInkChroma * 0.6,
    ),
  };

  // The pale amber panel's rule and border: the fill's hue, held just below its
  // own container, so the pair reads as an edge rather than as a second accent.
  const amberContainerL = rgbToOklch(parseColor(secondaryFamily.container).rgb).l;
  const amberSurface: ThemeAmberSurfaceTokens = {
    rule: atL(secondaryColor.h, amberContainerL - AMBER_RULE_OFFSET, clampChroma(secondaryColor.c * 0.5, 0.1)),
    border: atL(secondaryColor.h, amberContainerL - AMBER_BORDER_OFFSET, clampChroma(secondaryColor.c * 0.62, 0.12)),
  };

  const paletteTokens: ThemePaletteTokens = {
    primary,
    onPrimary: primaryFamily.onFill,
    primaryContainer: primaryFamily.container,
    onPrimaryContainer: primaryFamily.onContainer,
    primarySolid,
    secondary,
    onSecondary: secondaryFamily.onFill,
    secondaryContainer: secondaryFamily.container,
    onSecondaryContainer: secondaryFamily.onContainer,
    tertiary,
    onTertiary: tertiaryFamily.onFill,
    tertiaryContainer: tertiaryFamily.container,
    onTertiaryContainer: tertiaryFamily.onContainer,
    error: errorFamily.fill,
    onError: errorFamily.onFill,
    errorContainer: errorFamily.container,
    onErrorContainer: errorFamily.onContainer,
    success: successFamily.fill,
    onSuccess: successFamily.onFill,
    successContainer: successFamily.container,
    onSuccessContainer: successFamily.onContainer,
    warning: warningFamily.fill,
    onWarning: warningFamily.onFill,
    warningContainer: warningFamily.container,
    onWarningContainer: warningFamily.onContainer,
    background: base,
    surface: base,
    surfaceContainerLowest: ramp.surfaceContainerLowest,
    surfaceContainerLow: ramp.surfaceContainerLow,
    surfaceContainer: ramp.surfaceContainer,
    surfaceContainerHigh: ramp.surfaceContainerHigh,
    onSurface,
    onSurfaceVariant,
    outline,
    outlineVariant,
    // The scrim is the page's own ink, not a black: a black scrim over a warm
    // surface reads as a hole, and this is the app's shipped colour.
    scrim: dark ? 'rgba(0, 0, 0, 0.55)' : `rgba(${hexChannels(onSurface).r}, ${hexChannels(onSurface).g}, ${hexChannels(onSurface).b}, 0.32)`,
  };
  // ── the glass layer ──────────────────────────────────────────────────────
  // The backdrop is the gradient's mid stop and the fields are its two ends, so
  // the ambient layer is entirely the theme's own three colours.
  const native = spec.dialect === mode;
  const [declaredWarm, declaredBase, declaredCool] = spec.gradient;
  const backdrop = native
    ? declaredBase
    : atL(
        rgbToOklch(parseColor(declaredBase).rgb).h,
        BASE_L[mode],
        clampChroma(rgbToOklch(parseColor(declaredBase).rgb).c, 0.03),
      );
  const fields = {
    topLeft: field(modeTone(declaredWarm, mode, native), backdrop),
    bottomRight: field(modeTone(declaredCool, mode, native), backdrop),
  };
  const allFields = [...fields.topLeft, ...fields.bottomRight, backdrop];
  const glassDir: Dir = dark ? 'lighter' : 'darker';
  // The glass ink is cast in the BACKDROP's hue, not the page's: a warm brown
  // label on a cool field is the single most obviously wrong colour a glass
  // panel can have, and this is where it used to come from.
  const glassHue = rgbToOklch(parseColor(backdrop).rgb).h;
  const glassInkChroma = 0.02;

  const glassAccent = (hue: number, chroma: number) =>
    solveAgainstFields({
      hue,
      chroma: clampChroma(chroma * 0.62, 0.13),
      dir: glassDir,
      fields: allFields,
      min: 6,
    }).hex;

  const glassTokens: ThemeGlassTokens = {
    backdrop,
    fieldTopLeft: fields.topLeft,
    fieldBottomRight: fields.bottomRight,
    tint: `rgba(255, 255, 255, ${a.treatment.tintAlpha})`,
    tintStrong: `rgba(255, 255, 255, ${a.treatment.tintStrongAlpha})`,
    rim: `rgba(255, 255, 255, ${a.treatment.rimAlpha})`,
    rimFaint: `rgba(255, 255, 255, ${a.treatment.rimFaintAlpha})`,
    shadow: dark
      ? 'rgba(0, 0, 0, 0.5)'
      : `rgba(${shadowNeutral.r}, ${shadowNeutral.g}, ${shadowNeutral.b}, 0.16)`,
    grain: dark
      ? 'rgba(255, 255, 255, 0.4)'
      : `rgba(${grainNeutral.r}, ${grainNeutral.g}, ${grainNeutral.b}, 0.5)`,
    onGlass: solveAgainstFields({
      hue: glassHue, chroma: glassInkChroma, dir: glassDir, fields: allFields, min: 10,
    }).hex,
    onGlassVariant: solveAgainstFields({
      hue: glassHue, chroma: glassInkChroma * 1.7, dir: glassDir, fields: allFields, min: 7,
    }).hex,
    accentPrimary: glassAccent(accentHue, primaryColor.c),
    accentSecondary: glassAccent(secondaryColor.h, secondaryColor.c),
    accentTertiary: glassAccent(HUE.tertiary, HUE_CHROMA.tertiary),
    blur: a.treatment.blur,
  };

  const accentTokens: ThemeAccentTokens = {
    // The accent role is the theme's accent, which for `kondukt` is its primary
    // (that is why `accent.primary.fg` and `palette.primary` are the same hex
    // in the bundle as shipped) and for every other theme is the distinct
    // third hue the brief names.
    primary: {
      fg: roleFill(
        accentFamilyTokens.fill,
        accentHue,
        accentChroma,
        accentFamilyTokens.container,
        base,
      ),
      container: accentFamilyTokens.container,
      onContainer: accentFamilyTokens.onContainer,
    },
    secondary: {
      // Never the raw secondary: an amber that light cannot carry a label, so
      // the role colour is a darker step of the same hue - which is what the
      // shipped bundle's `accent.secondary.fg` has always been.
      // Solved against its own CONTAINER, because that is the pair it is drawn
      // on. Solving it against the fill produced a dark brown that then failed
      // on a dark container - the mark was unreadable in exactly the mode the
      // container was built for.
      fg: inkFor(
        secondaryFamily.container,
        secondaryColor.h,
        clampChroma(secondaryColor.c * 0.62, 0.12),
        NON_TEXT_FLOOR,
      ),
      container: secondaryFamily.container,
      onContainer: secondaryFamily.onContainer,
    },
    tertiary: {
      fg: roleFill(tertiary, HUE.tertiary, HUE_CHROMA.tertiary, tertiaryFamily.container, base),
      container: tertiaryFamily.container,
      onContainer: tertiaryFamily.onContainer,
    },
  };

  const tintedGlass: ThemeTintedGlassTokens = {
    // Both were hand-copied literals of two palette roles; deriving them is why
    // a themed pill stops being warm orange.
    accent: primarySolid,
    error: paletteTokens.error,
  };

  const derived: ThemeTokenValues = {
    palette: paletteTokens,
    glass: glassTokens,
    accent: accentTokens,
    onSecondaryRamp,
    amberSurface,
    tintedGlass,
    onPrimarySolid: '#FFFFFF',
  };

  const patched = applyOverrides(derived, spec, appearance, mode);

  // The stops are the bundle's OWN field, read back off the tokens: that is what
  // `GlassBackdrop` paints, so it is what the gradient has to name. Taking them
  // straight from the spec would describe a light theme's field inside a dark
  // bundle and quietly disagree with what is on screen.
  const backgroundGradient: BackgroundGradient = {
    colors: [patched.glass.fieldTopLeft[0], patched.glass.backdrop, patched.glass.fieldBottomRight[0]],
    start: a.direction.start,
    end: a.direction.end,
    intensity: appearance.background === 'solid' ? 0 : a.intensity,
    mode: appearance.background,
  };

  const semantic: ThemeSemanticTokens = {
    primary: patched.palette.primary,
    secondary: patched.palette.secondary,
    accent: patched.accent.primary.fg,
    background: patched.palette.background,
    backgroundGradient,
    surface: patched.palette.surface,
    surfaceElevated: patched.palette.surfaceContainerHigh,
    text: patched.palette.onSurface,
    textSecondary: patched.palette.onSurfaceVariant,
    outline: patched.palette.outline,
    outlineVariant: patched.palette.outlineVariant,
    icon: patched.palette.onSurfaceVariant,
    success: patched.palette.success,
    warning: patched.palette.warning,
    error: patched.palette.error,
  };

  return {
    ...patched,
    mode,
    id: spec.id,
    dialect: spec.dialect,
    appearance,
    semantic,
  };
}

/** Whether two appearances are the same setting on every axis. */
function sameAppearance(a: Appearance, b: Appearance): boolean {
  return (Object.keys(a) as (keyof Appearance)[]).every((key) => a[key] === b[key]);
}

/**
 * The authored tokens, applied last.
 *
 * Last matters: an authored value is a hand-measured decision, and a
 * hand-measured decision is the last word. The audit then measures the patched
 * bundle, so an override that breaks a floor fails the same run as everything
 * else.
 *
 * THE APPEARANCE GATE. Overrides apply at the DEFAULT appearance only. An
 * appearance axis exists to re-step a theme - `contrast: 'high'` is a promise
 * that the text gets stronger - so a palette pinned for the standard look must
 * not also pin the high-contrast answer, or the axis would silently do nothing
 * for exactly the theme most people are running. Everything else in the registry
 * is unaffected: only a spec that declares overrides can be gated by this.
 */
function applyOverrides(
  values: ThemeTokenValues,
  spec: ThemeSpec,
  appearance: Appearance,
  mode: ThemeMode,
): ThemeTokenValues {
  if (!spec.overrides || !sameAppearance(appearance, DEFAULT_APPEARANCE)) return values;
  const overrides = spec.overrides[mode];
  if (!overrides) return values;
  return {
    palette: { ...values.palette, ...overrides.palette },
    glass: { ...values.glass, ...overrides.glass },
    accent: { ...values.accent, ...overrides.accent },
    onSecondaryRamp: { ...values.onSecondaryRamp, ...overrides.onSecondaryRamp },
    amberSurface: { ...values.amberSurface, ...overrides.amberSurface },
    tintedGlass: { ...values.tintedGlass, ...overrides.tintedGlass },
    onPrimarySolid: overrides.onPrimarySolid ?? values.onPrimarySolid,
  };
}
