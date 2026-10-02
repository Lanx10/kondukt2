import { parseCachedApkRelease } from './preferences';

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

process.exitCode = failures === 0 ? 0 : 1;
