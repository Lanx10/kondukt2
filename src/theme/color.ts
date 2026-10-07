/**
 * The colour maths behind the theme registry.
 *
 * One module holds every primitive the registry needs so the theme files stay
 * declarations, not arithmetic: parse a colour, read it in OKLCH, step a tone,
 * and measure the result the way WCAG measures it.
 *
 * WHY OKLCH AND NOT HSL. A tonal palette is a set of same-hue steps, and HSL
 * does not hold a hue across lightness: darkening #E65100 by 15 points moves
 * its hue 2 degrees and its saturation 4 points, so a six-step ramp built in
 * HSL drifts off the brand hue by the time it reaches the darkest step. OKLab
 * is perceptually uniform — a step in L is a step in perceived lightness, and
 * hue is a separate axis. The app's own palette proves the point: its five warm
 * neutrals all sit at hue 56-61 degrees, which is what a hand-authored M3
 * tonal palette looks like.
 *
 * WHY THE AUDIT LIVES HERE AND NOT IN THE TEST. `src/lib/themeContrast.test.ts`
 * measures contrast, and this app's rule is that a colour cannot be re-stepped
 * without the measurement following it. Two copies of the contrast maths would
 * be two answers to the same question, so the maths moved here and the test
 * imports it. The test keeps the self-checks against published WCAG reference
 * values, which is what proves this copy is the same maths.
 */

export type Rgb = { r: number; g: number; b: number };

/** Perceptual coordinates. `l` is 0-1, `c` is 0-0.4ish, `h` is degrees 0-360. */
export type Oklch = { l: number; c: number; h: number };

/** A parsed colour plus its alpha, so translucent tokens composite correctly. */
export type Color = { rgb: Rgb; a: number };

const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;

const clamp01 = (value: number) => clamp(value, 0, 1);

/**
 * Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(...)` and `rgba(...)`.
 *
 * Throws on anything it cannot read, because a theme token that cannot be read
 * is a defect that must fail loudly at the first render rather than paint
 * transparent for a whole session. Every token in the registry is authored as
 * a hex string, so the `rgb()`/`rgba()` arms exist only for the two legacy
 * literals that are written that way.
 */
export function parseColor(value: string): Color {
  const raw = value.trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : '';
  const expand = (pair: string) => parseInt(pair.length === 1 ? pair + pair : pair, 16);
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      return {
        rgb: { r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]) },
        a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        rgb: {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
        },
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const functional = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (functional) {
    const parts = functional[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return { rgb: { r: parts[0], g: parts[1], b: parts[2] }, a: parts[3] ?? 1 };
    }
  }
  throw new Error(`cannot read "${value}" as a colour`);
}

/** The `#rrggbb` form of a colour. Alpha is not carried — use `withAlpha`. */
export function formatHex(value: Rgb | Color): string {
  const rgb: Rgb = 'rgb' in value ? value.rgb : value;
  const channel = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/**
 * A token as `rgba(r, g, b, a)`.
 *
 * React Native takes `rgba()` strings for every alpha token in the bundle and
 * cannot read an 8-digit hex in a style value on every platform, so translucent
 * tokens are written this way. Fully opaque input is returned as plain hex,
 * which is what keeps the derived bundle comparable to the hand-authored one.
 */
export function withAlpha(color: Color, alpha = color.a): string {
  if (alpha >= 1) return formatHex(color);
  const { r, g, b } = color.rgb;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(alpha.toFixed(3))})`;
}

// ── sRGB ↔ OKLab ───────────────────────────────────────────────────────────

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return clamp(c * 255, 0, 255);
};

/** sRGB in, OKLCH out. */
export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const degrees = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: (degrees + 360) % 360 };
}

/** OKLCH in, sRGB out, with the chroma clipped to stay in gamut. */
export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const inRange = (chroma: number): Rgb => {
    const A = chroma * cos;
    const B = chroma * sin;
    const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
    const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
    const s_ = l - 0.0894841775 * A - 1.291485548 * B;
    const lc = l_ * l_ * l_;
    const mc = m_ * m_ * m_;
    const sc = s_ * s_ * s_;
    const channels = [
      4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
      -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
      -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
    ];
    return { r: fromLinear(channels[0]), g: fromLinear(channels[1]), b: fromLinear(channels[2]) };
  };
  // Out-of-gamut is detected by re-running with no chroma: if the channels are
  // already outside 0-255 at C=0 then the L itself is impossible, and there is
  // nothing to clip.
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const probe = inRange(mid);
    const clipped =
      probe.r < -0.5 || probe.r > 255.5 || probe.g < -0.5 || probe.g > 255.5 ||
      probe.b < -0.5 || probe.b > 255.5;
    if (clipped) hi = mid;
    else lo = mid;
  }
  return inRange(lo);
}

/** The largest chroma sRGB can show at this lightness and hue. */
export function maxChroma(l: number, h: number): number {
  let lo = 0;
  let hi = 0.45;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const rgb = oklchToRgb({ l, c: mid, h });
    // `oklchToRgb` clamps rather than reports, so the probe asks for the
    // unclamped conversion through a round trip: if the round trip loses
    // lightness the chroma was too high.
    const back = rgbToOklch(rgb);
    if (Math.abs(back.l - l) > 0.004 || back.c < mid - 0.004) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * A hex at a given lightness, keeping hue and as much chroma as sRGB allows.
 *
 * This is the registry's only way to make a colour: never "darken this hex"
 * (which moves hue) but "put this hue at this lightness".
 */
export function tone({ l, c, h }: Oklch): string {
  return formatHex(oklchToRgb({ l: clamp01(l), c: Math.max(0, c), h }));
}

/** A hex at a hue and lightness, with the chroma capped so it stays vivid. */
export function atL(h: number, l: number, c: number): string {
  return tone({ l, c: Math.min(c, maxChroma(l, h)), h });
}

// ── WCAG ───────────────────────────────────────────────────────────────────

/**
 * WCAG 2.1 relative luminance. Deliberately the sRGB formula from the
 * specification rather than the OKLab lightness: WCAG is calibrated to this
 * curve, so measuring in OKLCH would change the numbers a reader can check.
 */
export function luminance(value: string): number {
  const { rgb, a } = parseColor(value);
  return relativeLuminance(composite({ rgb, a }, WHITE));
}

/** Source-over compositing, so a translucent token is measured over what it really paints. */
export function composite(fg: Color, bg: Rgb): Rgb {
  const a = fg.a + 1 * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0 };
  const mix = (f: number, b: number) => Math.round((f * fg.a + b * (1 - fg.a)) / a);
  return { r: mix(fg.rgb.r, bg.r), g: mix(fg.rgb.g, bg.g), b: mix(fg.rgb.b, bg.b) };
}

/** Relative luminance of an opaque colour. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/**
 * The contrast ratio of `foreground` over `background`, composited first.
 *
 * Two colours, one number: the WCAG ratio, with the translucent foreground
 * composited onto the opaque background before it is measured. Both arguments
 * accept anything `parseColor` reads.
 */
export function contrast(foreground: string, background: string): number {
  const bg = composite(parseColor(background), WHITE);
  const front = composite(parseColor(foreground), bg);
  const [a, b] = [relativeLuminance(front), relativeLuminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** Linear interpolation between two colours, in OKLCH so the hue does not swing. */
export function mix(from: string, to: string, amount: number): string {
  const a = rgbToOklch(parseColor(from).rgb);
  const b = rgbToOklch(parseColor(to).rgb);
  let delta = ((b.h - a.h + 540) % 360) - 180;
  return tone({
    l: a.l + (b.l - a.l) * amount,
    c: a.c + (b.c - a.c) * amount,
    h: (a.h + delta * amount + 360) % 360,
  });
}

/**
 * Straight sRGB interpolation, for gradients rather than for tones.
 *
 * The OKLCH mix above is right for placing a tone and wrong for a gradient's
 * middle stop: interpolating hue from a warm peach to a cool blue passes
 * through pink, so a field's midpoint reads as a colour nobody chose. A
 * gradient between two authored stops blends the two authored stops.
 */
export function mixSrgb(from: string, to: string, amount: number): string {
  const a = parseColor(from).rgb;
  const b = parseColor(to).rgb;
  const mix1 = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return formatHex({ r: mix1(a.r, b.r), g: mix1(a.g, b.g), b: mix1(a.b, b.b) });
}

/**
 * Whether a colour can carry text at all, by either extreme ink.
 *
 * Contrast is symmetric, so the best of white and black is the ceiling any
 * solid ink can reach against this colour. A fill whose own floor is
 * unreachable is a fill the registry has to re-step; a fill that clears with
 * black - an amber card, which the app has always done - keeps its declared
 * value.
 */
export function carryable(value: string, floor: number): boolean {
  return contrast('#FFFFFF', value) >= floor || contrast('#000000', value) >= floor;
}

/**
 * The best contrast ANY ink can reach against this fill.
 *
 * This is the ceiling the transform and the audit both need: a floor above it
 * is not a design target, it is an arithmetic impossibility, and demanding it
 * would make the solver walk to the end of the gamut and report a failure that
 * no amount of re-authoring could fix. Cyber's `#7C4DFF` secondary tops out at
 * 4.36:1, which is why its ink ramp is asked for the strongest ink the fill can
 * actually carry rather than for a number the fill cannot reach.
 */
export function maxContrast(value: string): number {
  return Math.max(contrast('#FFFFFF', value), contrast('#000000', value));
}

// ── the tone solver ───────────────────────────────────────────────────────

/**
 * The registry's guarantee: a role is placed at the lightness that MEETS its
 * floor, not at a lightness someone liked.
 *
 * `solveTone` walks outward from a reference colour, one small step at a time,
 * and stops at the first tone whose contrast against that reference clears
 * `min`. Monotonic in L on one side of the reference, so the walk is exact and
 * deterministic — no binary search, no tolerance, no "roughly 4.5".
 *
 * It is what makes "every theme has sufficient contrast" a property of the
 * engine instead of a hope: the audit re-measures the result, and the only way
 * a floor can fail is gamut (the walk ran off the end of the sRGB gamut) — and
 * that case is reported, not clipped away.
 */
export function solveTone({
  hue,
  chroma,
  from,
  dir,
  min,
  startL,
}: {
  /** Hue to hold, in degrees. Null takes the reference colour's own hue. */
  hue?: number;
  /** Upper bound on chroma; the solver takes what the gamut allows. */
  chroma: number;
  /** The colour being read against. */
  from: string;
  /** `darker` walks down in lightness, `lighter` up. */
  dir: 'darker' | 'lighter';
  /** The WCAG ratio to clear. */
  min: number;
  /** Where to begin the walk. Defaults to the reference colour's lightness. */
  startL?: number;
}): { hex: string; ratio: number; reached: boolean } {
  const reference = parseColor(from);
  const h = hue ?? rgbToOklch(reference.rgb).h;
  let l = startL ?? rgbToOklch(reference.rgb).l;
  const step = 0.005;
  const limit = dir === 'darker' ? 0 : 1;
  // At most ~200 steps: 0.005 per step across the whole lightness range.
  for (let i = 0; i <= 200; i++) {
    if (dir === 'darker' ? l <= 0 : l >= 1) {
      const edge = atL(h, limit, chroma);
      return { hex: edge, ratio: contrast(edge, from), reached: false };
    }
    const candidate = atL(h, l, chroma);
    const ratio = contrast(candidate, from);
    if (ratio >= min) return { hex: candidate, ratio, reached: true };
    l += dir === 'darker' ? -step : step;
  }
  const last = atL(h, limit, chroma);
  return { hex: last, ratio: contrast(last, from), reached: false };
}