import { parseAppearanceValue, parseCachedApkRelease, parseThemeId } from './preferences';
import { APPEARANCE_AXIS_VALUES, type AppearanceAxis } from '../theme/appearance';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '../theme/registry';

/**
 * Self-check for the cached-release decoder.
 *
 * Run with: npx tsx src/lib/preferences.test.ts
 *
 * This function parses JSON out of a preference store, so every case here is a
 * value that could actually be sitting on a device: an older build's shape, a
 * truncated write, a hand-edited store, or a publisher who shipped a thousand
 * lines of release notes. The one thing none of them may do is throw — this is
 * read during app start, and an exception here would strand the driver on a
 * splash screen over a change log nobody asked for.
 */

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'pass' : 'FAIL'}  ${name}${
      ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`
    }`,
  );
}

const notes = ['First change', 'Second change'];

// ── nothing usable ──────────────────────────────────────────────────────────
check('a missing key decodes to null', parseCachedApkRelease(null), null);
check('malformed JSON decodes to null', parseCachedApkRelease('{not json'), null);
check('a bare string decodes to null', parseCachedApkRelease('"1.0.4"'), null);
check('JSON null decodes to null', parseCachedApkRelease('null'), null);
check('an array decodes to null', parseCachedApkRelease('[]'), null);
check('a non-string version decodes to null', parseCachedApkRelease('{"version":5}'), null);
check('an empty version decodes to null', parseCachedApkRelease('{"version":""}'), null);
check('a missing version decodes to null', parseCachedApkRelease('{"notes":["a"]}'), null);

// ── a real release ──────────────────────────────────────────────────────────
check(
  'a well-formed release decodes',
  parseCachedApkRelease(JSON.stringify({ version: '1.0.4', notes })),
  { version: '1.0.4', notes },
);
check(
  'a release with no notes key still names its version',
  parseCachedApkRelease('{"version":"1.0.4"}'),
  { version: '1.0.4', notes: [] },
);
check(
  'a release with empty notes is not the same as no release',
  parseCachedApkRelease('{"version":"1.0.4","notes":[]}'),
  { version: '1.0.4', notes: [] },
);

// ── notes that are not notes ────────────────────────────────────────────────
check(
  'non-string notes are dropped, the strings kept in order',
  parseCachedApkRelease('{"version":"1.0.4","notes":["a",7,null,"b",{}]}'),
  { version: '1.0.4', notes: ['a', 'b'] },
);
check(
  'empty notes are dropped',
  parseCachedApkRelease('{"version":"1.0.4","notes":["","a"]}'),
  { version: '1.0.4', notes: ['a'] },
);
check(
  'notes that are not an array read as none rather than crashing',
  parseCachedApkRelease('{"version":"1.0.4","notes":"oops"}'),
  { version: '1.0.4', notes: [] },
);

// ── a publisher who wrote a novel ───────────────────────────────────────────
const many = { version: '1.0.4', notes: Array.from({ length: 500 }, (_, i) => `Change ${i}`) };
check(
  'notes are capped, because this is a preference store and not a library',
  parseCachedApkRelease(JSON.stringify(many))!.notes.length,
  40,
);
check(
  'the cap keeps the first notes, not an arbitrary slice',
  parseCachedApkRelease(JSON.stringify(many))!.notes[0],
  'Change 0',
);

// ── the theme-id codec ──────────────────────────────────────────────────────
// Every case here is a value that could actually be on a handset: a key that
// was never written, a store hand-edited on a rooted device, and - the one that
// actually happens - a theme id written by a build that shipped it and a later
// build that retired it. None of them may resolve to a bundle that does not
// exist, so every unknown reads as "no theme chosen" and the app falls back.
console.log('-- theme id --');
check('a missing key decodes to null', parseThemeId(null), null);
check('an empty string decodes to null', parseThemeId(''), null);
check('whitespace decodes to null', parseThemeId('   '), null);
check('an unknown id decodes to null', parseThemeId('no-such-theme'), null);
check('a retired id decodes to null', parseThemeId('theme-from-an-older-build'), null);
check('an id of the wrong type decodes to null', parseThemeId('1'), null);
check('the stored boolean decodes to null, it is not a theme',
  parseThemeId('1'), null);
check('surrounding whitespace is tolerated',
  parseThemeId('  cyber  '), 'cyber');
for (const spec of THEME_REGISTRY) {
  check(`the registry's own id round-trips: ${spec.id}`, parseThemeId(spec.id), spec.id);
}
check('the default theme id is one of them',
  THEME_REGISTRY.some((spec) => spec.id === DEFAULT_THEME_ID), true);

// ── the appearance codec ─────────────────────────────────────────────────────
// Every case here is a value that could actually be on a handset: a key that
// was never written, a store hand-edited on a rooted device, a value a later
// build retired, and the one that actually happens - an axis written by a build
// that had it and a build that does not. None of them may reach the transform,
// so every unknown reads as "not chosen" and the app opens on its default
// appearance rather than rendering from a value the engine was never told about.
console.log('-- appearance axes --');

const FLAGS: readonly AppearanceAxis[] = ['dynamicAccent', 'reduceEffects'];
const CHOICES = Object.keys(APPEARANCE_AXIS_VALUES) as (keyof typeof APPEARANCE_AXIS_VALUES)[];
const EVERY_AXIS: readonly AppearanceAxis[] = [...CHOICES, ...FLAGS];

check('every axis is covered by the choice table and the two flags', EVERY_AXIS.length, 7);

// A missing key, on every axis, is the first-launch case and must be null so
// the caller fills the axis from DEFAULT_APPEARANCE.
for (const axis of EVERY_AXIS) {
  check(`${axis}: a missing key decodes to null`, parseAppearanceValue(axis, null), null);
  check(`${axis}: an empty string decodes to null`, parseAppearanceValue(axis, ''), null);
  check(`${axis}: whitespace decodes to null`, parseAppearanceValue(axis, '   '), null);
  check(`${axis}: an unknown value decodes to null`, parseAppearanceValue(axis, 'nonsense'), null);
}

// Every value the engine declares must survive the round trip, because the only
// values the screen can ever write are these.
for (const axis of CHOICES) {
  for (const value of APPEARANCE_AXIS_VALUES[axis]) {
    check(`${axis}: the declared value "${value}" round-trips`, parseAppearanceValue(axis, value), value);
  }
  check(`${axis}: surrounding whitespace is tolerated`,
    parseAppearanceValue(axis, `  ${APPEARANCE_AXIS_VALUES[axis][0]}  `), APPEARANCE_AXIS_VALUES[axis][0]);
  check(`${axis}: a value from another axis is refused`,
    parseAppearanceValue(axis, 'kondukt'), null);
}

// THE AXIS DECIDES, NOT THE STRING. This is the case that keeps one axis from
// being written into another's key: "high" is a real contrast value, and it is
// still not a background.
check('a contrast value is not a background',
  parseAppearanceValue('background', 'high'), null);
check('a background value is not a contrast',
  parseAppearanceValue('contrast', 'gradient'), null);
check('a direction is not an intensity',
  parseAppearanceValue('gradientIntensity', 'blTr'), null);
check('a surface style is not a background',
  parseAppearanceValue('background', 'elevated'), null);

// ── the two flags ──
// Flags are booleans and encode as `1` / `0` like every other boolean in this
// store, so the words the app uses are explicitly NOT what it stores.
for (const axis of FLAGS) {
  check(`${axis}: 1 decodes as on`, parseAppearanceValue(axis, '1'), true);
  check(`${axis}: 0 decodes as off`, parseAppearanceValue(axis, '0'), false);
  check(`${axis}: the word true is not what this store holds`,
    parseAppearanceValue(axis, 'true'), null);
  check(`${axis}: the word false is not what this store holds`,
    parseAppearanceValue(axis, 'false'), null);
  check(`${axis}: yes is not a boolean here`, parseAppearanceValue(axis, 'yes'), null);
  check(`${axis}: 2 is not a boolean here`, parseAppearanceValue(axis, '2'), null);
  check(`${axis}: a word from an enumerated axis is refused`,
    parseAppearanceValue(axis, 'high'), null);
}

// And the other way round: a flag's encoding is not one of an axis's words.
for (const axis of CHOICES) {
  check(`${axis}: 1 is not one of this axis's values`, parseAppearanceValue(axis, '1'), null);
  check(`${axis}: 0 is not one of this axis's values`, parseAppearanceValue(axis, '0'), null);
}

process.exitCode = failures === 0 ? 0 : 1;
