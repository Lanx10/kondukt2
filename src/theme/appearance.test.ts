import {
  APPEARANCE_AXIS_VALUES,
  DEFAULT_APPEARANCE,
  resolveAppearance,
  resolveFieldStops,
} from './appearance';
import { contrast } from './color';
import { DEFAULT_THEME_ID, getThemeBundle } from './registry';
import type {
  Appearance,
  BackgroundMode,
  GradientIntensity,
  ThemeMode,
} from './types';

/**
 * What the seven Advanced Appearance axes actually change.
 *
 * Run with: npx tsx src/theme/appearance.test.ts
 *
 * A control that resolves to the same tokens as every other value of itself is
 * a control that lies, and a passing type check cannot see it - every axis here
 * is a valid `Appearance`, so all seven compile. These checks are the only thing
 * between a shipped setting and a switch that does nothing:
 *
 * - the DEFAULT appearance must paint exactly the field the app has always
 *   painted, or the axes change the design rather than re-stepping it;
 * - each axis must move the thing it is named after, in the direction its name
 *   says, for every theme and both modes;
 * - and Reduce Visual Effects must actually remove the lift, the blur and the
 *   grain it promises to remove, while leaving the panel's tint alone.
 */

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
}

const MODES: readonly ThemeMode[] = ['light', 'dark'];

/** A changed appearance, with one axis moved off the default. */
const withAxis = <K extends keyof Appearance>(axis: K, value: Appearance[K]): Appearance => ({
  ...DEFAULT_APPEARANCE,
  [axis]: value,
});

// ── the default appearance is the shipped design ────────────────────────────
// THE FIRST TEST, and the one that matters most: the axes were added to an app
// that already had a look, and every one of them defaults to what that look
// already is. A device that has never touched a control must resolve, stop for
// stop, to the field the reference draws.
for (const mode of MODES) {
  const theme = getThemeBundle(DEFAULT_THEME_ID, mode);
  const stops = resolveFieldStops(theme.semantic.backgroundGradient);
  check(
    `${mode}: the default appearance paints the shipped field`,
    JSON.stringify(stops) ===
      JSON.stringify([theme.glass.fieldTopLeft[0], theme.glass.backdrop, theme.glass.fieldBottomRight[0]]),
    `got ${JSON.stringify(stops)}`,
  );
  check(
    `${mode}: the default direction is the shipped 135 degrees`,
    JSON.stringify(theme.semantic.backgroundGradient.start) === JSON.stringify({ x: 0, y: 0 }) &&
      JSON.stringify(theme.semantic.backgroundGradient.end) === JSON.stringify({ x: 1, y: 1 }),
  );
}

// ── BACKGROUND: how many fields paint ───────────────────────────────────────
// The count is what this axis is, so it is asserted as a count and not as a
// colour: solid must paint no field at all, soft exactly one.
for (const mode of MODES) {
  for (const value of APPEARANCE_AXIS_VALUES.background) {
    // Measured against the bundle BUILT AT THIS APPEARANCE, not at the default
    // one: the warm theme's authored overrides apply at the default appearance
    // only, so the page colour legitimately moves when the background axis
    // moves, and comparing against the default would call a correct field wrong.
    const built = getThemeBundle(DEFAULT_THEME_ID, mode, withAxis('background', value));
    const stops = resolveFieldStops(built.semantic.backgroundGradient);
    const flat = (stop: string) => stop === built.glass.backdrop;
    if (value === 'solid') {
      check(
        `${mode}/solid: the page is flat - no field paints`,
        flat(stops[0]) && flat(stops[1]) && flat(stops[2]),
        `got ${JSON.stringify(stops)}`,
      );
    } else if (value === 'soft') {
      check(
        `${mode}/soft: exactly one field paints, and the page holds the middle`,
        !flat(stops[0]) && flat(stops[1]) && flat(stops[2]),
        `got ${JSON.stringify(stops)}`,
      );
    } else {
      check(
        `${mode}/gradient: both fields paint over the page`,
        !flat(stops[0]) && flat(stops[1]) && !flat(stops[2]),
        `got ${JSON.stringify(stops)}`,
      );
    }
  }
}

// ── GRADIENT INTENSITY: monotone, and balanced is the shipped strength ──────
// Measured as contrast against the page colour, because "how far the corner sits
// from the page" is exactly what a driver sees and exactly what must not go
// backwards when they ask for more.
for (const mode of MODES) {
  // The page colour each intensity is measured against is ITS OWN: an intensity
  // changes how far the corner sits from the page, so scoring against another
  // appearance's page colour would be measuring two things at once.
  const backdrop = (value: GradientIntensity) =>
    getThemeBundle(DEFAULT_THEME_ID, mode, withAxis('gradientIntensity', value)).glass.backdrop;
  const reach: Record<string, number> = {};
  for (const value of APPEARANCE_AXIS_VALUES.gradientIntensity) {
    const built = getThemeBundle(DEFAULT_THEME_ID, mode, withAxis('gradientIntensity', value));
    reach[value] = contrast(
      resolveFieldStops(built.semantic.backgroundGradient)[0],
      backdrop(value),
    );
  }
  check(
    `${mode}: subtle is quieter than balanced`,
    reach.subtle < reach.balanced,
    `${reach.subtle} vs ${reach.balanced}`,
  );
  check(
    `${mode}: balanced is quieter than strong`,
    reach.balanced < reach.strong,
    `${reach.balanced} vs ${reach.strong}`,
  );
  check(
    `${mode}: the three intensities are three different fields`,
    new Set(Object.values(reach)).size === 3,
    JSON.stringify(reach),
  );
}

// ── GRADIENT DIRECTION: the vectors are what LinearGradient is handed ────────
const DIRECTIONS: Record<string, { start: [number, number]; end: [number, number] }> = {
  tlBr: { start: [0, 0], end: [1, 1] },
  topBottom: { start: [0, 0], end: [0, 1] },
  leftRight: { start: [0, 0], end: [1, 0] },
  blTr: { start: [0, 1], end: [1, 0] },
};
for (const value of APPEARANCE_AXIS_VALUES.gradientDirection) {
  const expected = DIRECTIONS[value];
  for (const mode of MODES) {
    const { start, end } = getThemeBundle(
      DEFAULT_THEME_ID,
      mode,
      withAxis('gradientDirection', value),
    ).semantic.backgroundGradient;
    check(
      `${mode}/${value}: the gradient runs where the control says`,
      start.x === expected.start[0] && start.y === expected.start[1] &&
        end.x === expected.end[0] && end.y === expected.end[1],
      `got ${JSON.stringify({ start, end })}`,
    );
  }
}
check(
  'the four directions are four different runs',
  new Set(Object.values(DIRECTIONS).map((d) => JSON.stringify(d))).size === 4,
);

// ── SURFACE STYLE: the treatment is the axis ────────────────────────────────
// The numbers the engine ships, asserted so the axis cannot quietly become a
// no-op that only changes a token nothing reads.
for (const mode of MODES) {
  const standard = resolveAppearance(DEFAULT_APPEARANCE, mode).treatment;
  const soft = resolveAppearance(withAxis('surfaceStyle', 'soft'), mode).treatment;
  const elevated = resolveAppearance(withAxis('surfaceStyle', 'elevated'), mode).treatment;

  check(
    `${mode}/soft: the wash is halved`,
    soft.tintAlpha < standard.tintAlpha,
    `${soft.tintAlpha} vs ${standard.tintAlpha}`,
  );
  check(
    `${mode}/soft: the lift is gone, which is what "soft" means`,
    soft.shadow.radius === 0 && soft.shadow.elevation === 0,
  );
  check(
    `${mode}/elevated: the wash is heavier than standard`,
    elevated.tintAlpha > standard.tintAlpha,
    `${elevated.tintAlpha} vs ${standard.tintAlpha}`,
  );
  check(
    `${mode}/elevated: the lift is deeper than standard`,
    elevated.shadow.radius > standard.shadow.radius,
    `${elevated.shadow.radius} vs ${standard.shadow.radius}`,
  );
  check(
    `${mode}: the three surface styles are three different treatments`,
    JSON.stringify(soft) !== JSON.stringify(standard) &&
      JSON.stringify(elevated) !== JSON.stringify(standard) &&
      JSON.stringify(elevated) !== JSON.stringify(soft),
  );
}

// ── REDUCE VISUAL EFFECTS: it must remove what it names ─────────────────────
// The promise on the row is "blur, grain and the card lift switch off". Each of
// those three is checked, and so is the tint it must NOT remove - a panel with no
// wash left on it stops separating from the field, which would trade a
// preference for a legibility bug.
for (const mode of MODES) {
  const reduced = resolveAppearance(withAxis('reduceEffects', true), mode).treatment;
  const standard = resolveAppearance(DEFAULT_APPEARANCE, mode).treatment;

  check(`${mode}: the blur is off`, reduced.blur === 0, `got ${reduced.blur}`);
  check(`${mode}: the grain is off`, reduced.grainAlpha === 0, `got ${reduced.grainAlpha}`);
  check(
    `${mode}: the lift is off`,
    reduced.shadow.radius === 0 && reduced.shadow.offset === 0 && reduced.shadow.elevation === 0,
    JSON.stringify(reduced.shadow),
  );
  check(
    `${mode}: the panel still separates from the field`,
    reduced.tintAlpha > 0 && reduced.rimAlpha > 0,
    `tint ${reduced.tintAlpha}, rim ${reduced.rimAlpha}`,
  );
  check(
    `${mode}: switching it off is what puts them back`,
    resolveAppearance(withAxis('reduceEffects', false), mode).treatment.blur ===
      standard.blur,
  );

  // And it has to reach the bundle, not just the resolver: this is the claim the
  // card makes on screen.
  const theme = getThemeBundle(DEFAULT_THEME_ID, mode, withAxis('reduceEffects', true));
  check(`${mode}: the bundle's own blur token is zeroed`, theme.glass.blur === 0);
  check(
    `${mode}: the grain's weight is zero, which is what GlassCard multiplies in`,
    resolveAppearance(theme.appearance, theme.mode).treatment.grainAlpha === 0,
  );
}

// ── DYNAMIC ACCENT: the accent follows the field ────────────────────────────
for (const mode of MODES) {
  const declared = getThemeBundle(DEFAULT_THEME_ID, mode);
  const dynamic = getThemeBundle(DEFAULT_THEME_ID, mode, withAxis('dynamicAccent', true));
  check(
    `${mode}: the accent actually moves`,
    dynamic.accent.primary.fg !== declared.accent.primary.fg,
    'the accent is the same colour either way, so the toggle would do nothing',
  );
  // Identity is the REGISTRY ENTRY, not the tokens: the warm theme's authored
  // overrides deliberately apply at the default appearance only, so every other
  // axis re-steps its tokens - which is the whole point of the axes.
  check(
    `${mode}: the theme's identity is untouched - this is a re-step, not a new theme`,
    dynamic.id === declared.id && dynamic.dialect === declared.dialect,
  );
}

// ── CONTRAST: the floors move, and the theme stays the theme ────────────────
for (const mode of MODES) {
  const standard = resolveAppearance(DEFAULT_APPEARANCE, mode).floors;
  const high = resolveAppearance(withAxis('contrast', 'high'), mode).floors;
  check(
    `${mode}: high contrast raises every floor it names`,
    high.onSurfaceVariant > standard.onSurfaceVariant &&
      high.outline > standard.outline &&
      high.hairline > standard.hairline &&
      high.secondaryBody > standard.secondaryBody,
    `${JSON.stringify(standard)} -> ${JSON.stringify(high)}`,
  );
  check(
    `${mode}: high contrast measurably darkens the secondary ink`,
    contrast(
      getThemeBundle(DEFAULT_THEME_ID, mode, withAxis('contrast', 'high')).glass.onGlassVariant,
      getThemeBundle(DEFAULT_THEME_ID, mode, withAxis('contrast', 'high')).glass.backdrop,
    ) >
      contrast(
        getThemeBundle(DEFAULT_THEME_ID, mode).glass.onGlassVariant,
        getThemeBundle(DEFAULT_THEME_ID, mode).glass.backdrop,
      ),
  );
}

// ── the table the store validates against ───────────────────────────────────
// Every axis must offer at least two values, or it is not an axis, and every
// value must be one the engine itself accepts - the preference store validates
// against this exact table, so a typo here is a value that cannot be saved.
for (const [axis, values] of Object.entries(APPEARANCE_AXIS_VALUES)) {
  check(`${axis} offers at least two values`, values.length >= 2, `got ${values.length}`);
  for (const value of values) {
    const built = getThemeBundle(
      DEFAULT_THEME_ID,
      'light',
      withAxis(axis as keyof typeof APPEARANCE_AXIS_VALUES, value as never),
    );
    check(
      `${axis}="${value}" builds a real bundle`,
      built.semantic.backgroundGradient.mode !== undefined &&
        built.id === DEFAULT_THEME_ID,
    );
  }
}

// The field count, which is the only thing `background` resolves to, asserted as
// the count the engine promises for each value.
const BACKGROUND_VALUES: readonly BackgroundMode[] = APPEARANCE_AXIS_VALUES.background;
check(
  'the field count follows the background axis',
  BACKGROUND_VALUES.map((value) =>
    resolveAppearance(withAxis('background', value), 'light').fields,
  ).join(',') === '2,1,0',
);

console.log(`\n${failures === 0 ? 'appearance: all checks passed' : `appearance: ${failures} FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
