import {
  accent,
  darkAccent,
  darkGlass,
  getTheme,
  glass,
  onAmber,
  onPrimarySolid,
  type KonduktTheme,
  type ThemeMode,
  tintedGlass,
} from '../theme';

/**
 * Contrast audit for the theme tokens.
 *
 * Run with: npx tsx src/lib/themeContrast.test.ts
 *
 * Both palettes are audited here so a colour can never be re-stepped into a
 * new palette without also being re-approved for the other one. Three rules
 * from the dark-mode work are encoded as data rather than left to memory:
 *
 * - Anything filled with `primarySolid` or `tintedGlass` is inked with
 *   `onPrimarySolid`, never `palette.onPrimary` — in dark mode `onPrimary` is
 *   a deep orange at roughly 2:1 on its own brand step.
 * - A solid amber card takes all four inks from the `onAmber` ramp. The
 *   neutral ramp measures about 1.2:1 on amber in dark mode, because
 *   `palette.secondary` there is a *light* amber.
 * - Text over glass clears 4.5:1 against every colour in the glass fields,
 *   not just the backdrop, because the fields show through the blur.
 *
 * Thresholds follow WCAG 2.1: 4.5:1 for body text, 3:1 for large text and
 * for icons and other non-text UI. Hairline dividers and `amberSurface` rules
 * are deliberately absent — they are decorative, and no threshold makes them
 * carry meaning.
 */

type Rgba = { r: number; g: number; b: number; a: number };

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
}

function parseColor(value: string, where: string): Rgba {
  const raw = value.trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : '';
  const expand = (pair: string) => parseInt(pair.length === 1 ? pair + pair : pair, 16);
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]),
        g: expand(hex[1]),
        b: expand(hex[2]),
        a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    }
  }
  throw new Error(`${where}: cannot read "${value}" as a colour`);
}

/** Source-over compositing, so a translucent token audits against what it really paints. */
function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (f: number, b: number) => Math.round((f * fg.a + b * bg.a * (1 - fg.a)) / a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

function luminance(c: Rgba) {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function contrast(fg: string, bg: string, where: string) {
  const opaque = composite(parseColor(bg, where), { r: 255, g: 255, b: 255, a: 0 });
  const front = composite(parseColor(fg, where), opaque);
  const [a, b] = [luminance(front), luminance(opaque)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const BODY = 4.5;
const LARGE_OR_ICON = 3;
const ratio = (n: number) => n.toFixed(2);

// ── the maths itself, against the published reference values ────────────────
check('contrast helper: black on white is 21:1', Math.abs(contrast('#000000', '#FFFFFF', 'self-check') - 21) < 0.01, '');
check('contrast helper: white on black is 21:1', Math.abs(contrast('#FFFFFF', '#000000', 'self-check') - 21) < 0.01, '');
check(
  'contrast helper: #767676 on white is the 4.54:1 AA boundary',
  Math.abs(contrast('#767676', '#FFFFFF', 'self-check') - 4.54) < 0.05,
  '',
);
check(
  'contrast helper: a 50% white wash reads as mid grey, not as white',
  Math.abs(contrast('rgba(255,255,255,0.5)', '#000000', 'self-check') - contrast('#808080', '#000000', 'self-check')) < 0.1,
  '',
);
check(
  'contrast helper: 3-digit hex expands like 6-digit',
  Math.abs(contrast('#fff', '#000', 'self-check') - 21) < 0.01,
  '',
);

type Pair = { name: string; fg: string; bg: string; min: number };

/** Every surface a text token is legitimately drawn on. */
const SURFACES = [
  'background',
  'surface',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
] as const;

function pairsFor(mode: ThemeMode): Pair[] {
  const theme: KonduktTheme = getTheme(mode);
  const p = theme.palette;
  const pairs: Pair[] = [];

  for (const surface of SURFACES) {
    pairs.push(
      { name: `${mode} onSurface on ${surface}`, fg: p.onSurface, bg: p[surface], min: BODY },
      {
        name: `${mode} onSurfaceVariant on ${surface}`,
        fg: p.onSurfaceVariant,
        bg: p[surface],
        min: BODY,
      },
    );
  }

  // The M3 container/foreground pairs, exactly as named.
  pairs.push(
    { name: `${mode} onPrimary on primary (display/icon)`, fg: p.onPrimary, bg: p.primary, min: LARGE_OR_ICON },
    {
      name: `${mode} onPrimaryContainer on primaryContainer`,
      fg: p.onPrimaryContainer,
      bg: p.primaryContainer,
      min: BODY,
    },
    {
      name: `${mode} onSecondary on secondary`,
      fg: p.onSecondary,
      bg: p.secondary,
      min: BODY,
    },
    {
      name: `${mode} onSecondaryContainer on secondaryContainer`,
      fg: p.onSecondaryContainer,
      bg: p.secondaryContainer,
      min: BODY,
    },
    { name: `${mode} onTertiary on tertiary`, fg: p.onTertiary, bg: p.tertiary, min: BODY },
    {
      name: `${mode} onTertiaryContainer on tertiaryContainer`,
      fg: p.onTertiaryContainer,
      bg: p.tertiaryContainer,
      min: BODY,
    },
    { name: `${mode} onError on error`, fg: p.onError, bg: p.error, min: BODY },
    {
      name: `${mode} onErrorContainer on errorContainer`,
      fg: p.onErrorContainer,
      bg: p.errorContainer,
      min: BODY,
    },
  );

  // Filled brand surfaces.
  //
  // `onPrimary`/`onPrimaryContainer` are absent here on purpose: they are the
  // inks for the *tint* steps, and both fail on the solid step (`onPrimary` is
  // 2.6:1 in dark, `onPrimaryContainer` 2.6:1 in light). Anything filled with
  // `primarySolid` or `tintedGlass` takes `onPrimarySolid`, and that is the
  // only combination this file will accept on a solid brand fill.
  //
  // `onPrimary` on the tint itself is held to the non-text floor, not the body
  // floor, because the theme's own note scopes it to the 20px+ display roles
  // and to icons — an 11px label on `primary` needs `primarySolid` instead.
  pairs.push(
    { name: `${mode} onPrimarySolid on primarySolid`, fg: onPrimarySolid, bg: p.primarySolid, min: BODY },
  );

  // Solid amber. `secondary` is a light amber in *both* modes, so every ink on
  // it has to come from the onAmber ramp.
  for (const ink of Object.keys(onAmber)) {
    pairs.push({
      name: `${mode} onAmber.${ink} on secondary`,
      fg: onAmber[ink as keyof typeof onAmber],
      bg: p.secondary,
      min: BODY,
    });
  }

  // The accent roles. `onContainer` is label text and clears the body floor;
  // `fg` is only ever a mark, a dot or an icon (see TripScreen's add-trip icon
  // and LocalStorageCard's tone icon), so it is held to the non-text floor.
  // Body-sized accent text uses `glass.accentPrimary` instead — that darker
  // step exists precisely because the raw role colour cannot carry 4.5:1 on a
  // light surface.
  for (const role of ['primary', 'secondary', 'tertiary'] as const) {
    const a = theme.accent[role];
    pairs.push(
      { name: `${mode} accent.${role}.fg on surface (icon)`, fg: a.fg, bg: p.surface, min: LARGE_OR_ICON },
      {
        name: `${mode} accent.${role}.fg on its container (icon)`,
        fg: a.fg,
        bg: a.container,
        min: LARGE_OR_ICON,
      },
      {
        name: `${mode} accent.${role}.onContainer on its container`,
        fg: a.onContainer,
        bg: a.container,
        min: BODY,
      },
    );
  }

  // Icons and rules that carry meaning: the 3:1 non-text floor.
  pairs.push(
    { name: `${mode} outline on surface`, fg: p.outline, bg: p.surface, min: LARGE_OR_ICON },
    { name: `${mode} primary on surface (icon)`, fg: p.primary, bg: p.surface, min: LARGE_OR_ICON },
    { name: `${mode} error on surface (icon)`, fg: p.error, bg: p.surface, min: LARGE_OR_ICON },
  );

  // Text over glass, against every field colour the blur can let through.
  const fields = [...new Set([theme.glass.backdrop, ...theme.glass.fieldTopLeft, ...theme.glass.fieldBottomRight])];
  for (const field of fields) {
    pairs.push(
      { name: `${mode} onGlass on field ${field}`, fg: theme.glass.onGlass, bg: field, min: BODY },
      {
        name: `${mode} onGlassVariant on field ${field}`,
        fg: theme.glass.onGlassVariant,
        bg: field,
        min: BODY,
      },
      {
        name: `${mode} accentPrimary on field ${field}`,
        fg: theme.glass.accentPrimary,
        bg: field,
        min: BODY,
      },
      {
        name: `${mode} accentSecondary on field ${field}`,
        fg: theme.glass.accentSecondary,
        bg: field,
        min: BODY,
      },
      {
        name: `${mode} accentTertiary on field ${field}`,
        fg: theme.glass.accentTertiary,
        bg: field,
        min: BODY,
      },
    );
  }

  return pairs;
}

// ── the mode-independent glass tints, which both palettes sit on ────────────
const sharedPairs: Pair[] = [
  { name: 'onPrimarySolid on tintedGlass.accent', fg: onPrimarySolid, bg: tintedGlass.accent, min: BODY },
  { name: '#FFFFFF on tintedGlass.error', fg: '#FFFFFF', bg: tintedGlass.error, min: BODY },
];

// ── audit ──────────────────────────────────────────────────────────────────
const failuresBefore = failures;
for (const mode of ['light', 'dark'] as const) {
  console.log(`\n── ${mode} ──`);
  const pairs = [...pairsFor(mode), ...sharedPairs];
  // Worst offenders first, so a regression report leads with the worst number.
  const scored = pairs
    .map((pair) => ({ pair, value: contrast(pair.fg, pair.bg, pair.name) }))
    .sort((a, b) => a.value / a.pair.min - b.value / b.pair.min);
  for (const { pair, value } of scored) {
    check(
      `${pair.name} (needs ${pair.min}:1)`,
      value >= pair.min,
      `${ratio(value)}:1 — ${pair.fg} on ${pair.bg}`,
    );
  }
}

// ── the bundles themselves must stay well-formed ───────────────────────────
console.log('');
for (const mode of ['light', 'dark'] as const) {
  const theme = getTheme(mode);
  check(`${mode} bundle reports its own mode`, theme.mode === mode, `got ${theme.mode}`);
  for (const role of ['primary', 'secondary', 'tertiary'] as const) {
    const a = theme.accent[role];
    check(
      `${mode} accent.${role} has three readable colours`,
      [a?.fg, a?.container, a?.onContainer].every(
        (value) => typeof value === 'string' && Number.isFinite(contrast(value, theme.palette.surface, role)),
      ),
      `got ${JSON.stringify(a)}`,
    );
  }
  check(
    `${mode} glass fields are three-stop arrays`,
    theme.glass.fieldTopLeft.length === 3 && theme.glass.fieldBottomRight.length === 3,
    '',
  );
}
check('the light and dark bundles are distinct objects', getTheme('light') !== getTheme('dark'), '');
// The tokens are `as const`, so TypeScript knows the two backdrops can never
// be equal and would reject the check outright. Widen to string first: the
// point is to prove the dark bundle is a real swap, not a re-export.
check('the glass backdrop really differs between modes', String(glass.backdrop) !== String(darkGlass.backdrop), '');
check(
  'every accent role colour differs between modes',
  (['primary', 'secondary', 'tertiary'] as const).every(
    (role) => String(accent[role].fg) !== String(darkAccent[role].fg),
  ),
  '',
);

console.log(
  failures === failuresBefore
    ? '\nall passed'
    : `\n${failures - failuresBefore} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);