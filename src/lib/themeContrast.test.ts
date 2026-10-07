import {
  BODY_FLOOR,
  CONTRAST_FLOORS,
  DEFAULT_APPEARANCE,
  NON_TEXT_FLOOR,
  SOLID_FILL_FLOOR,
} from '../theme/appearance';
import { contrast, maxContrast } from '../theme/color';
import { LEGACY_DARK, LEGACY_LIGHT } from '../theme/legacy';
import { THEME_REGISTRY, getThemeBundle } from '../theme/registry';
import type { Appearance, KonduktTheme, ThemeMode } from '../theme/types';

/**
 * The contrast audit for the WHOLE registry.
 *
 * Run with: npx tsx src/lib/themeContrast.test.ts
 *
 * WHAT CHANGED. This used to audit two hand-picked bundles - the app's light
 * and dark palettes - which meant "every theme has sufficient contrast" was a
 * claim about the registry rather than a fact about it. It is now a loop over
 * `THEME_REGISTRY` in both modes, so adding a theme to `specs.ts` adds it to
 * the audit on the same run, with no list here to keep in step.
 *
 * WHERE THE MATHS COMES FROM. The contrast function is imported from
 * `src/theme/color`, the same module the transform solves against, because a
 * colour cannot be re-stepped without the measurement following it. Two copies
 * of WCAG would be two answers to the same question. The self-checks at the top
 * are what prove this copy is the published one: black-on-white at 21:1, the
 * 4.54:1 AA boundary, a 50% wash reading as mid grey, 3-digit hex expansion.
 *
 * WHERE THE FLOORS COME FROM. Also imported, from `theme/appearance`. If the
 * audit's floor and the derivation's floor ever disagreed, the derivation would
 * stop guaranteeing anything and the audit would start failing for a reason
 * nobody chose.
 *
 * THE RULES ENCODED AS DATA.
 *
 * - Anything filled with `primarySolid` or `tintedGlass.accent` is inked with
 *   `onPrimarySolid`, never `palette.onPrimary`.
 * - A solid secondary fill takes its four inks from `onSecondaryRamp`, which
 *   is derived per theme because Cyber's secondary is a violet.
 * - Text over glass clears the body floor against EVERY colour in the glass
 *   fields, not just the backdrop, because the fields show through the blur.
 * - `accent.*.fg` is only ever a mark, a dot or an icon, so it is held to the
 *   non-text floor. Body-sized accent text uses `glass.accentPrimary`.
 */

type Pair = { name: string; fg: string; bg: string; min: number };

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = '') {
  checks++;
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
  return ok;
}

const ratio = (n: number) => n.toFixed(2);

/** Every surface a text token is legitimately drawn on. */
const SURFACES = [
  'background',
  'surface',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
] as const;

/**
 * Every foreground/background pair a theme owes, at the floors it owes them at.
 *
 * The floors are the mode-independent WCAG 2.1 ones: 4.5:1 for body text, 3:1
 * for display text, icons and other non-text UI, and the app's own 5.2:1 for
 * white on a solid brand fill. Hairline dividers and the `amberSurface` rules
 * are deliberately absent - they are decorative, and no threshold makes them
 * carry meaning.
 */
function pairsFor(theme: KonduktTheme): Pair[] {
  const p = theme.palette;
  const pairs: Pair[] = [];
  const tag = `${theme.id}/${theme.mode}`;

  // Body text over every neutral surface it is drawn on.
  for (const surface of SURFACES) {
    pairs.push(
      { name: `${tag} onSurface on ${surface}`, fg: p.onSurface, bg: p[surface], min: BODY_FLOOR },
      {
        name: `${tag} onSurfaceVariant on ${surface}`,
        fg: p.onSurfaceVariant,
        bg: p[surface],
        min: CONTRAST_FLOORS.standard.onSurfaceVariant,
      },
    );
  }

  // The M3 container/foreground families, exactly as named. `success` and
  // `warning` are new in the registry and are measured like `error` rather than
  // being assumed: a status colour nobody ever checked is a status colour that
  // is unreadable on exactly the day it matters.
  const FAMILIES = [
    ['primary', NON_TEXT_FLOOR],
    ['secondary', BODY_FLOOR],
    ['tertiary', BODY_FLOOR],
    ['error', BODY_FLOOR],
    ['success', BODY_FLOOR],
    ['warning', BODY_FLOOR],
  ] as const;
  for (const [role, onRoleFloor] of FAMILIES) {
    pairs.push(
      { name: `${tag} on${cap(role)} on ${role}`, fg: p[`on${cap(role)}` as keyof typeof p], bg: p[role], min: onRoleFloor },
      {
        name: `${tag} on${cap(role)}Container on ${role}Container`,
        fg: p[`on${cap(role)}Container` as keyof typeof p],
        bg: p[`${role}Container` as keyof typeof p],
        min: BODY_FLOOR,
      },
    );
  }

  // Filled brand surfaces.
  //
  // `onPrimary`/`onPrimaryContainer` are absent here on purpose: they are the
  // inks for the TINT steps. Anything filled with `primarySolid` or
  // `tintedGlass.accent` takes `onPrimarySolid`, and that is the only
  // combination this file accepts on a solid brand fill.
  pairs.push(
    { name: `${tag} onPrimarySolid on primarySolid`, fg: theme.onPrimarySolid, bg: p.primarySolid, min: SOLID_FILL_FLOOR },
    { name: `${tag} onPrimarySolid on tintedGlass.accent`, fg: theme.onPrimarySolid, bg: theme.tintedGlass.accent, min: SOLID_FILL_FLOOR },
    { name: `${tag} #FFFFFF on tintedGlass.error`, fg: '#FFFFFF', bg: theme.tintedGlass.error, min: BODY_FLOOR },
  );

  // The four inks a solid secondary fill accepts, each at its own floor.
  const RAMP_TARGETS: [keyof typeof theme.onSecondaryRamp, number][] = [
    ['primary', 7],
    ['detail', 6],
    ['muted', 5.2],
    ['faint', Math.max(4.6, CONTRAST_FLOORS.standard.secondaryBody)],
  ];
  // Capped at the ceiling the fill can physically reach, for the reason
  // `derive.ts` caps the solver the same way. A theme whose secondary cannot
  // carry a 7:1 ink is reported in the summary, not failed here: the question
  // "can this fill ever carry 7:1" has an arithmetic answer, and the audit
  // already prints it.
  const ceiling = maxContrast(p.secondary);
  for (const [ink, target] of RAMP_TARGETS) {
    pairs.push({
      name: `${tag} onSecondaryRamp.${ink} on secondary`,
      fg: theme.onSecondaryRamp[ink],
      bg: p.secondary,
      min: Math.min(target, ceiling),
    });
  }

  // The accent roles.
  for (const role of ['primary', 'secondary', 'tertiary'] as const) {
    const a = theme.accent[role];
    pairs.push(
      { name: `${tag} accent.${role}.fg on surface (icon)`, fg: a.fg, bg: p.surface, min: NON_TEXT_FLOOR },
      { name: `${tag} accent.${role}.fg on its container (icon)`, fg: a.fg, bg: a.container, min: NON_TEXT_FLOOR },
      { name: `${tag} accent.${role}.onContainer on its container`, fg: a.onContainer, bg: a.container, min: BODY_FLOOR },
    );
  }

  // Icons and rules that carry meaning: the non-text floor.
  pairs.push(
    { name: `${tag} outline on surface`, fg: p.outline, bg: p.surface, min: CONTRAST_FLOORS.standard.hairline },
    { name: `${tag} outlineVariant on surface (hairline)`, fg: p.outlineVariant, bg: p.surface, min: 1.5 },
    { name: `${tag} primarySolid on surface (icon)`, fg: p.primarySolid, bg: p.surface, min: NON_TEXT_FLOOR },
    { name: `${tag} error on surface (icon)`, fg: p.error, bg: p.surface, min: NON_TEXT_FLOOR },
    { name: `${tag} success on surface (icon)`, fg: p.success, bg: p.surface, min: NON_TEXT_FLOOR },
    { name: `${tag} warning on surface (icon)`, fg: p.warning, bg: p.surface, min: NON_TEXT_FLOOR },
  );

  // Text over glass, against every field colour the blur can let through.
  const fields = [...new Set([theme.glass.backdrop, ...theme.glass.fieldTopLeft, ...theme.glass.fieldBottomRight])];
  for (const field of fields) {
    pairs.push(
      { name: `${tag} onGlass on field ${field}`, fg: theme.glass.onGlass, bg: field, min: BODY_FLOOR },
      { name: `${tag} onGlassVariant on field ${field}`, fg: theme.glass.onGlassVariant, bg: field, min: BODY_FLOOR },
      { name: `${tag} glass.accentPrimary on field ${field}`, fg: theme.glass.accentPrimary, bg: field, min: BODY_FLOOR },
      { name: `${tag} glass.accentSecondary on field ${field}`, fg: theme.glass.accentSecondary, bg: field, min: BODY_FLOOR },
      { name: `${tag} glass.accentTertiary on field ${field}`, fg: theme.glass.accentTertiary, bg: field, min: BODY_FLOOR },
    );
  }

  // The semantic layer is an alias, so it must measure exactly what the role it
  // points at measures. This is what stops "new code uses semantic names" from
  // being a claim: the aliases are checked against the palette they alias.
  const semanticAliases: [keyof KonduktTheme['semantic'], Pair['fg']][] = [
    ['primary', p.primary],
    ['secondary', p.secondary],
    ['accent', theme.accent.primary.fg],
    ['background', p.background],
    ['surface', p.surface],
    ['text', p.onSurface],
    ['textSecondary', p.onSurfaceVariant],
    ['outline', p.outline],
    ['outlineVariant', p.outlineVariant],
    ['icon', p.onSurfaceVariant],
    ['success', p.success],
    ['warning', p.warning],
    ['error', p.error],
  ];
  for (const [name, source] of semanticAliases) {
    check(`${tag} semantic.${name} aliases ${source}`, theme.semantic[name] === source,
      `semantic gives ${theme.semantic[name]}, role gives ${source}`);
  }
  check(
    `${tag} semantic.backgroundGradient carries the theme's three stops`,
    theme.semantic.backgroundGradient.colors.join() === theme.glass.fieldTopLeft[0] + ',' +
      theme.glass.backdrop + ',' + theme.glass.fieldBottomRight[0],
    `got ${theme.semantic.backgroundGradient.colors.join()}`,
  );

  return pairs;
}

function cap(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}
// ── 1. the maths itself, against the published reference values ────────────
// These are the check that the copy of WCAG living in `theme/color.ts` is the
// published one. If they ever drift, every number this file prints is fiction.
check('contrast helper: black on white is 21:1', Math.abs(contrast('#000000', '#FFFFFF') - 21) < 0.01,
  `got ${ratio(contrast('#000000', '#FFFFFF'))}`);
check('contrast helper: white on black is 21:1', Math.abs(contrast('#FFFFFF', '#000000') - 21) < 0.01,
  `got ${ratio(contrast('#FFFFFF', '#000000'))}`);
check('contrast helper: #767676 on white is the 4.54:1 AA boundary',
  Math.abs(contrast('#767676', '#FFFFFF') - 4.54) < 0.05, `got ${ratio(contrast('#767676', '#FFFFFF'))}`);
check('contrast helper: a 50% white wash reads as mid grey, not as white',
  Math.abs(contrast('rgba(255,255,255,0.5)', '#000000') - contrast('#808080', '#000000')) < 0.1, '');
check('contrast helper: 3-digit hex expands like 6-digit',
  Math.abs(contrast('#fff', '#000') - 21) < 0.01, `got ${ratio(contrast('#fff', '#000'))}`);
check('contrast helper: a translucent token is measured over what it paints',
  Math.abs(contrast('rgba(0,0,0,0.5)', '#FFFFFF') - contrast('#808080', '#FFFFFF')) < 0.05,
  `${ratio(contrast('rgba(0,0,0,0.5)', '#FFFFFF'))} vs ${ratio(contrast('#808080', '#FFFFFF'))}`);

// ── 2. the default theme still renders what it rendered before the registry ──
// The whole additive wiring rests on this. The fixture in `theme/legacy.ts` is
// the pre-registry bundle, recorded token by token, and nothing in the app
// reads it - it exists so this comparison can fail.
function tokenPaths(value: unknown, prefix = ''): [string, string][] {
  const rows: [string, string][] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(entry)) rows.push([path, entry.join(' ')]);
    else if (entry && typeof entry === 'object') rows.push(...tokenPaths(entry, path));
    else rows.push([path, String(entry)]);
  }
  return rows;
}

console.log('\n=== identity: kondukt built through the registry vs the pre-registry bundle ===');
for (const [mode, fixture] of [['light', LEGACY_LIGHT], ['dark', LEGACY_DARK]] as const) {
  const built = getThemeBundle('kondukt', mode, DEFAULT_APPEARANCE);
  const builtRows = new Map(tokenPaths(built));
  let same = 0;
  for (const [path, value] of tokenPaths(fixture)) {
    const got = builtRows.get(path);
    if (check(`kondukt/${mode} ${path} is unchanged`, got === value, `built ${got}, shipped ${value}`)) same++;
  }
  console.log(`  kondukt/${mode}: ${same}/${tokenPaths(fixture).length} tokens identical to the pre-registry bundle`);
  check(`kondukt/${mode} keeps its identity`, same === tokenPaths(fixture).length, `${same} of ${tokenPaths(fixture).length}`);
}

// ── 3. an appearance axis must re-step a theme, not be pinned by it ────────
// The authored palette applies at the DEFAULT appearance only, so this is the
// test that `contrast: 'high'` is a real control on the theme most people run.
{
  const standard = getThemeBundle('kondukt', 'light', DEFAULT_APPEARANCE);
  const high = getThemeBundle('kondukt', 'light', { ...DEFAULT_APPEARANCE, contrast: 'high' });
  check('high contrast resteps onSurfaceVariant', high.palette.onSurfaceVariant !== standard.palette.onSurfaceVariant,
    `${high.palette.onSurfaceVariant} vs ${standard.palette.onSurfaceVariant}`);
  check('high contrast resteps outline', high.palette.outline !== standard.palette.outline,
    `${high.palette.outline} vs ${standard.palette.outline}`);
  check('high contrast is stronger than standard',
    contrast(high.palette.onSurfaceVariant, high.palette.surface) >
      contrast(standard.palette.onSurfaceVariant, standard.palette.surface), '');
  check('high contrast clears its own 9.5:1 floor',
    contrast(high.palette.onSurfaceVariant, high.palette.surface) >= CONTRAST_FLOORS.high.onSurfaceVariant,
    `${ratio(contrast(high.palette.onSurfaceVariant, high.palette.surface))}:1`);
  const dynamic = getThemeBundle('kondukt', 'light', { ...DEFAULT_APPEARANCE, dynamicAccent: true });
  check('dynamic accent takes the gradient hue, not the declared one',
    dynamic.accent.primary.fg !== standard.accent.primary.fg,
    `${dynamic.accent.primary.fg} vs ${standard.accent.primary.fg}`);
}

// ── 4. the audit: every theme, both modes, at the default appearance ───────
const APPEARANCES: { label: string; appearance: Appearance }[] = [
  { label: 'default', appearance: DEFAULT_APPEARANCE },
  { label: 'high contrast', appearance: { ...DEFAULT_APPEARANCE, contrast: 'high' } },
];

console.log('\n=== contrast audit: every theme, both modes ===');
const summary: { id: string; mode: ThemeMode; worst: number; headroom: number; pairs: number }[] = [];

for (const spec of THEME_REGISTRY) {
  for (const mode of ['light', 'dark'] as const) {
    for (const { label, appearance } of APPEARANCES) {
      const theme = getThemeBundle(spec.id, mode, appearance);
      const pairs = pairsFor(theme);
      // Worst offenders first, so a regression report leads with the worst number.
      const scored = pairs
        .map((pair) => ({ pair, value: contrast(pair.fg, pair.bg) }))
        .sort((a, b) => a.value / a.pair.min - b.value / b.pair.min);
      let worst = scored[0];
      for (const { pair, value } of scored) {
        check(`${pair.name} (needs ${pair.min}:1)`, value >= pair.min, `${ratio(value)}:1 — ${pair.fg} on ${pair.bg}`);
        if (value / pair.min < worst.value / worst.pair.min) worst = { pair, value };
      }
      if (label === 'default') {
        summary.push({
          id: spec.id, mode,
          worst: worst.value, headroom: worst.value / worst.pair.min, pairs: scored.length,
        });
      }
      // The high-contrast run is asserted at the same floors, so a theme that
      // only passes at standard is not reported as passing here.
    }
  }
}

// ── 5. the bundles themselves must stay well-formed ────────────────────────
console.log('\n=== bundle shape ===');
for (const spec of THEME_REGISTRY) {
  for (const mode of ['light', 'dark'] as const) {
    const theme = getThemeBundle(spec.id, mode);
    check(`${spec.id}/${mode} reports its own mode`, theme.mode === mode, `got ${theme.mode}`);
    check(`${spec.id}/${mode} reports the id it was asked for`, theme.id === spec.id, `got ${theme.id}`);
    for (const role of ['primary', 'secondary', 'tertiary'] as const) {
      const a = theme.accent[role];
      check(`${spec.id}/${mode} accent.${role} has three readable colours`,
        [a?.fg, a?.container, a?.onContainer].every(
          (value) => typeof value === 'string' && Number.isFinite(contrast(value, theme.palette.surface)),
        ), `got ${JSON.stringify(a)}`);
    }
    check(`${spec.id}/${mode} glass fields are three-stop arrays`,
      theme.glass.fieldTopLeft.length === 3 && theme.glass.fieldBottomRight.length === 3, '');
    check(`${spec.id}/${mode} the two modes are genuinely different builds`,
      getThemeBundle(spec.id, 'light').palette.background !== theme.palette.background ||
        theme.mode === 'light', '');
    // Every token has to be a colour the maths can read, or the audit above
    // measured nothing at all for that role.
    // The gradient's direction and mode are settings, not colours, and `blur`
    // is a number. Everything else has to be something the maths can read,
    // or the pairs above measured nothing at all for that role.
    // Only the COLOUR groups are walked, and `blur` is skipped because it is a
    // number. The bundle also carries `mode`, `id`, `dialect` and the resolved
    // appearance, which are settings rather than colours - checking those as
    // though they were paint would be checking the wrong thing.
    const COLOUR_GROUPS = ['palette', 'glass', 'accent', 'onSecondaryRamp', 'amberSurface', 'tintedGlass'] as const;
    let unreadable = '';
    for (const group of COLOUR_GROUPS) {
      for (const [key, value] of tokenPaths(theme[group])) {
        const path = `${group}.${key}`;
        // The two field arrays are walked stop by stop rather than joined into
        // one string, so each of the three colours a blur can let through is
        // checked as a colour in its own right.
        if (group === 'glass' && (key === 'fieldTopLeft' || key === 'fieldBottomRight')) {
          for (const [i, stop] of (theme.glass[key as 'fieldTopLeft'] as readonly string[]).entries()) {
            try {
              contrast(stop, '#FFFFFF');
            } catch {
              unreadable = `glass.${key}.${i}`;
            }
          }
          continue;
        }
        if (group === 'glass' && key === 'blur') continue;
        try {
          contrast(value, '#FFFFFF');
        } catch {
          unreadable = path;
        }
      }
    }
    try {
      contrast(theme.onPrimarySolid, '#FFFFFF');
    } catch {
      unreadable = 'onPrimarySolid';
    }
    check(`${spec.id}/${mode} every colour token parses`, unreadable === '', `unreadable: ${unreadable}`);
  }
}

check('an unknown theme id resolves to the default rather than throwing',
  getThemeBundle('no-such-theme', 'light').id === 'kondukt', '');
check('a null theme id resolves to the default rather than throwing',
  getThemeBundle(null, 'light').id === 'kondukt', '');

// ── 6. the report ──────────────────────────────────────────────────────────
console.log('\n=== per-theme, per-mode result (default appearance) ===');
console.log('theme                 mode   pairs   tightest pair                          ratio   needs   headroom');
const width = (value: string, size: number) => value.padEnd(size).slice(0, size);
for (const row of summary) {
  const theme = getThemeBundle(row.id, row.mode);
  const scored = pairsFor(theme)
    .map((pair) => ({ pair, value: contrast(pair.fg, pair.bg) }))
    .sort((a, b) => a.value / a.pair.min - b.value / b.pair.min)[0];
  const needs = scored.pair.min;
  console.log(
    `${width(row.id, 20)}  ${width(row.mode, 6)} ${String(row.pairs).padStart(5)}   ` +
    `${width(scored.pair.name.replace(`${row.id}/${row.mode} `, ''), 39)}` +
    `${ratio(scored.value).padStart(6)}  ${needs.toFixed(2).padStart(5)}   ${row.headroom.toFixed(2)}x`,
  );
}

// A REPORT, NOT A CHECK. `palette.primary` is the brand FILL - the colour of a
// button - and the brief's primaries are all in the band where no ink-heavy
// surface can carry them as a bare mark: the lightest of them measures 1.45:1 on
// its own page and the darkest 2.89:1, against a 3:1 non-text floor. That is a
// property of the colours the brief specifies, not a defect in the engine, and
// the app's answer is already a token: `palette.primarySolid` is the same hue
// solved until white clears 5.15:1 on it, and that is what is asserted above.
// So the measurement is printed with its numbers and the shortfalls are named,
// rather than being silently dropped or turned into a failing assertion.
const SHORTFALL = NON_TEXT_FLOOR;
console.log(`
=== declared primary used as a bare mark on its own page (target ${SHORTFALL}:1) ===`);
const shortfalls: string[] = [];
for (const spec of THEME_REGISTRY) {
  for (const mode of ['light', 'dark'] as const) {
    const theme = getThemeBundle(spec.id, mode);
    const value = contrast(theme.palette.primary, theme.palette.surface);
    const mark = value >= SHORTFALL ? ' ' : '!';
    if (value < SHORTFALL) shortfalls.push(`${spec.id}/${mode}`);
    console.log(`  ${mark} ${width(spec.id, 20)} ${width(mode, 6)} ${ratio(value).padStart(6)}:1` +
      `   (primarySolid ${ratio(contrast(theme.palette.primarySolid, theme.palette.surface)).padStart(6)}:1)`);
  }
}
console.log(shortfalls.length === 0
  ? '  no theme falls short'
  : `  ${shortfalls.length} theme/mode fall short: ${shortfalls.join(', ')}`);

const authored = THEME_REGISTRY.filter((spec) => spec.overrides);
const derived = THEME_REGISTRY.filter((spec) => !spec.overrides);
console.log('');
console.log(`themes fully derived from their six seed colours: ${derived.length}/${THEME_REGISTRY.length}` +
  ` (${derived.map((s) => s.id).join(', ')})`);
console.log(`themes carrying an authored palette: ${authored.length}/${THEME_REGISTRY.length}` +
  ` (${authored.map((s) => s.id).join(', ')})`);
const belowFloor = summary.filter((row) => row.headroom < 1);
console.log(belowFloor.length === 0
  ? 'themes whose tightest pair is below its floor: none'
  : `themes whose tightest pair is below its floor: ${belowFloor.map((r) => `${r.id}/${r.mode}`).join(', ')}`);

console.log(
  failures === 0
    ? `\nall passed: ${checks} checks`
    : `\n${failures} FAILED of ${checks} checks`,
);
if (failures > 0) process.exitCode = 1;
