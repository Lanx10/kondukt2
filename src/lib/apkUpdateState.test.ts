/**
 * Self-check for the pure half of the GitHub Releases APK updater.
 *
 * Run with: npx tsx src/lib/apkUpdateState.test.ts
 *
 * Covers the rules the service and the Settings card depend on: numeric
 * (not lexicographic) version ordering, malformed metadata handled without
 * crashes, APK URLs confined to the configured repository, the
 * update/mandatory verdict, throttle windows, and the friendly copy.
 */

import {
  classifyApkError,
  compareSemver,
  formatBytes,
  isTrustedApkUrl,
  parseRelease,
  parseSemver,
  resolveApkUpdate,
  sanitizeApkFileName,
  shouldApkAutoCheck,
  stripTagPrefix,
  apkStatusText,
  type ApkRelease,
  type ReleaseSource,
} from './apkUpdateState';

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

const source: ReleaseSource = {
  owner: 'Lanx10',
  repository: 'kondukt2',
  tagPrefix: 'v',
};

// ── semver parsing ─────────────────────────────────────────────────────────
check('parses 1.2.3', parseSemver('1.2.3'), [1, 2, 3]);
check('parses v1.2.3', parseSemver('v1.2.3'), [1, 2, 3]);
check('trims whitespace', parseSemver('  1.0.0  '), [1, 0, 0]);
check('rejects 1.2', parseSemver('1.2'), null);
check('rejects 1.2.3.4', parseSemver('1.2.3.4'), null);
check('rejects 1.2.x', parseSemver('1.2.x'), null);
check('rejects empty', parseSemver(''), null);
check('rejects null', parseSemver(null), null);
check('rejects garbage', parseSemver('banana'), null);
check('rejects pre-release', parseSemver('1.2.0-beta.1'), null);
check('tolerates letter suffix 1.0.0a', parseSemver('1.0.0a'), [1, 0, 0]);
check('suffix compares as base triple', compareSemver('1.0.0a', '1.0.1'), -1);
check('rejects huge parts', parseSemver('1.99999999999999999999.0'), null);

// ── semver comparison ──────────────────────────────────────────────────────
check('1.10.0 beats 1.9.0 (numeric, not lexicographic)', compareSemver('1.10.0', '1.9.0'), 1);
check('1.9.0 loses to 1.10.0', compareSemver('1.9.0', '1.10.0'), -1);
check('equal versions', compareSemver('1.2.3', '1.2.3'), 0);
check('v-prefix equal', compareSemver('v1.2.3', '1.2.3'), 0);
check('major dominates', compareSemver('2.0.0', '1.99.99'), 1);
check('patch dominates', compareSemver('1.0.1', '1.0.0'), 1);
check('malformed a → null', compareSemver('oops', '1.0.0'), null);
check('malformed b → null', compareSemver('1.0.0', 'oops'), null);
check('null → null', compareSemver(null, '1.0.0'), null);

check('stripTagPrefix v', stripTagPrefix('v1.2.0', 'v'), '1.2.0');
check('stripTagPrefix no-op', stripTagPrefix('1.2.0', 'v'), '1.2.0');

// ── trusted URLs ───────────────────────────────────────────────────────────
check(
  'trusted release download url',
  isTrustedApkUrl(
    'https://github.com/Lanx10/kondukt2/releases/download/v1.2.0/kondukt-1.2.0.apk',
    source,
  ),
  true,
);
check(
  'foreign owner rejected',
  isTrustedApkUrl(
    'https://github.com/evil/kondukt2/releases/download/v1.2.0/x.apk',
    source,
  ),
  false,
);
check(
  'non-github host rejected',
  isTrustedApkUrl('https://evil.example.com/kondukt-1.2.0.apk', source),
  false,
);
check(
  'looks-like url without releases/download rejected',
  isTrustedApkUrl('https://github.com/Lanx10/kondukt2/archive/refs/tags/v1.zip', source),
  false,
);

// ── release parsing ────────────────────────────────────────────────────────
const baseRelease = {
  tag_name: 'v1.2.0',
  name: '1.2.0',
  draft: false,
  prerelease: false,
  published_at: '2026-09-30T00:00:00Z',
  body: 'Improved ticket entry\nFixed trip history',
  assets: [
    {
      name: 'kondukt-1.2.0.apk',
      browser_download_url:
        'https://github.com/Lanx10/kondukt2/releases/download/v1.2.0/kondukt-1.2.0.apk',
      size: 12_345_678,
    },
  ],
};

const parsed = parseRelease(baseRelease, source);
check('asset-only release parses', parsed.ok, true);
if (parsed.ok) {
  check('version from tag', parsed.release.version, '1.2.0');
  check('apk name', parsed.release.apkName, 'kondukt-1.2.0.apk');
  check('size from asset', parsed.release.sizeBytes, 12_345_678);
  check('notes from body lines', parsed.release.releaseNotes, [
    'Improved ticket entry',
    'Fixed trip history',
  ]);
  check('no manifest → no minimumVersion', parsed.release.minimumVersion, null);
  check('no manifest → no sha256', parsed.release.sha256, null);
  check('publishedAt parsed', parsed.release.publishedAt, Date.parse('2026-09-30T00:00:00Z'));
}

const manifestBody = JSON.stringify({
  version: '1.2.0',
  versionCode: 12,
  minimumVersion: '1.0.0',
  apkUrl:
    'https://github.com/Lanx10/kondukt2/releases/download/v1.2.0/kondukt-1.2.0.apk',
  releaseNotes: ['Improved ticket entry', 'Fixed trip history'],
  sha256: 'A'.repeat(64),
});
const withManifest = parseRelease({ ...baseRelease, body: manifestBody }, source);
check('manifest release parses', withManifest.ok, true);
if (withManifest.ok) {
  check('manifest versionCode', withManifest.release.versionCode, 12);
  check('manifest minimumVersion', withManifest.release.minimumVersion, '1.0.0');
  check('manifest notes', withManifest.release.releaseNotes, [
    'Improved ticket entry',
    'Fixed trip history',
  ]);
  check('manifest sha256 lowercased', withManifest.release.sha256, 'a'.repeat(64));
}

check(
  'bad manifest JSON falls back to tag',
  (() => {
    const r = parseRelease({ ...baseRelease, body: '{not json' }, source);
    return r.ok ? r.release.version : 'fail';
  })(),
  '1.2.0',
);
check(
  'manifest version wins over tag',
  (() => {
    const r = parseRelease(
      { ...baseRelease, body: JSON.stringify({ version: '1.3.0' }) },
      source,
    );
    return r.ok ? r.release.version : 'fail';
  })(),
  '1.3.0',
);
check('no assets, no manifest url → no-apk', parseRelease({ ...baseRelease, assets: [] }, source), {
  ok: false,
  problem: 'no-apk',
});
check(
  'foreign asset url → invalid-url',
  parseRelease(
    {
      ...baseRelease,
      assets: [
        {
          name: 'x.apk',
          browser_download_url: 'https://evil.example.com/x.apk',
          size: 1,
        },
      ],
    },
    source,
  ),
  { ok: false, problem: 'invalid-url' },
);
check(
  'missing tag → invalid-metadata',
  parseRelease({ ...baseRelease, tag_name: 42 }, source),
  { ok: false, problem: 'invalid-metadata' },
);
check(
  'garbage tag → invalid-metadata',
  parseRelease({ ...baseRelease, tag_name: 'latest' }, source),
  { ok: false, problem: 'invalid-metadata' },
);
check('draft → invalid-metadata', parseRelease({ ...baseRelease, draft: true }, source), {
  ok: false,
  problem: 'invalid-metadata',
});
check(
  'prerelease → invalid-metadata',
  parseRelease({ ...baseRelease, prerelease: true }, source),
  { ok: false, problem: 'invalid-metadata' },
);
check('null payload → invalid-metadata', parseRelease(null, source), {
  ok: false,
  problem: 'invalid-metadata',
});
check(
  'bad sha256 ignored',
  (() => {
    const r = parseRelease(
      { ...baseRelease, body: JSON.stringify({ sha256: 'nope' }) },
      source,
    );
    return r.ok ? r.release.sha256 : 'fail';
  })(),
  null,
);

// ── verdict ────────────────────────────────────────────────────────────────
const release: ApkRelease = {
  version: '1.2.0',
  tag: 'v1.2.0',
  apkName: 'kondukt-1.2.0.apk',
  apkUrl:
    'https://github.com/Lanx10/kondukt2/releases/download/v1.2.0/kondukt-1.2.0.apk',
  sizeBytes: 1000,
  versionCode: null,
  minimumVersion: null,
  releaseNotes: [],
  sha256: null,
  publishedAt: null,
};
const allow = { allowMandatoryUpdates: true };
const deny = { allowMandatoryUpdates: false };

check(
  'older install → update',
  resolveApkUpdate({ version: '1.1.0', versionCode: 2 }, release, allow),
  'update',
);
check(
  'same version → uptodate',
  resolveApkUpdate({ version: '1.2.0', versionCode: 3 }, release, allow),
  'uptodate',
);
check(
  'newer install → uptodate',
  resolveApkUpdate({ version: '1.3.0', versionCode: 4 }, release, allow),
  'uptodate',
);
check(
  'malformed installed version → invalid',
  resolveApkUpdate({ version: '1.2', versionCode: 1 }, release, allow),
  'invalid',
);
check(
  'unknown installed version → invalid',
  resolveApkUpdate({ version: null, versionCode: 1 }, release, allow),
  'invalid',
);
check(
  '1.9.0 vs 1.10.0 release → update (numeric compare)',
  resolveApkUpdate({ version: '1.9.0', versionCode: 1 }, { ...release, version: '1.10.0' }, allow),
  'update',
);
check(
  'equal version, higher versionCode → update',
  resolveApkUpdate(
    { version: '1.2.0', versionCode: 3 },
    { ...release, versionCode: 4 },
    allow,
  ),
  'update',
);
check(
  'equal version, lower/equal versionCode → uptodate',
  resolveApkUpdate(
    { version: '1.2.0', versionCode: 4 },
    { ...release, versionCode: 4 },
    allow,
  ),
  'uptodate',
);
check(
  'below minimumVersion → mandatory when allowed',
  resolveApkUpdate(
    { version: '0.9.0', versionCode: 1 },
    { ...release, minimumVersion: '1.0.0' },
    allow,
  ),
  'mandatory',
);
check(
  'below minimumVersion → plain update when disallowed',
  resolveApkUpdate(
    { version: '0.9.0', versionCode: 1 },
    { ...release, minimumVersion: '1.0.0' },
    deny,
  ),
  'update',
);
check(
  'above minimumVersion → plain update',
  resolveApkUpdate(
    { version: '1.1.0', versionCode: 2 },
    { ...release, minimumVersion: '1.0.0' },
    allow,
  ),
  'update',
);
check(
  'update existing alone never forces',
  resolveApkUpdate({ version: '1.1.0', versionCode: 2 }, release, allow),
  'update',
);

// ── error classification ───────────────────────────────────────────────────
check('offline message on check', classifyApkError('Network request failed', 'check'), 'offline');
check('timeout on download', classifyApkError('timed out', 'download'), 'offline');
check('403 on check → rate_limit', classifyApkError('403 Forbidden', 'check'), 'rate_limit');
check('rate limit text', classifyApkError('API rate limit exceeded', 'check'), 'rate_limit');
check('unknown check failure → server', classifyApkError('boom', 'check'), 'server');
check('stage verify → verify', classifyApkError('whatever', 'verify'), 'verify');
check('stage install → install', classifyApkError('whatever', 'install'), 'install');
check('download stage stays download', classifyApkError('UnableToDownload', 'download'), 'download');
check('undefined message safe', classifyApkError(undefined, 'check'), 'server');

// ── throttle ───────────────────────────────────────────────────────────────
const hour = 60 * 60 * 1000;
check('never checked → allowed', shouldApkAutoCheck(null, 1000, 6 * hour), true);
check('just checked → blocked', shouldApkAutoCheck(1000, 1000 + hour, 6 * hour), false);
check('stale check → allowed', shouldApkAutoCheck(0, 6 * hour, 6 * hour), true);
check('failed check throttles too', shouldApkAutoCheck(1000, 2000, 6 * hour), false);
check('negative timestamp → allowed', shouldApkAutoCheck(-5, 10, 6 * hour), true);

// ── copy & formatting ──────────────────────────────────────────────────────
check('idle copy', apkStatusText('idle', null), 'Check for a new version of Kondukt from GitHub Releases.');
check(
  'download percent',
  apkStatusText('downloading', null, { received: 50, total: 100 }),
  'Downloading update… 50%',
);
check(
  'download clamps at 100%',
  apkStatusText('downloading', null, { received: 150, total: 100 }),
  'Downloading update… 100%',
);
check(
  'download without total shows bytes',
  apkStatusText('downloading', null, { received: 2048, total: -1 }),
  'Downloading update… 2.0 KB',
);
check('error copy wins', apkStatusText('error', 'offline'), 'No internet connection. Check again when you’re back online.');
check('available copy', apkStatusText('available', null), 'An update is available to download.');

check('formatBytes B', formatBytes(512), '512 B');
check('formatBytes KB', formatBytes(2048), '2.0 KB');
check('formatBytes MB', formatBytes(12_345_678), '11.8 MB');
check('formatBytes negative', formatBytes(-1), '—');

check('sanitize plain name', sanitizeApkFileName('kondukt-1.2.0.apk'), 'kondukt-1.2.0.apk');
check('sanitize strips path', sanitizeApkFileName('../../evil/../kondukt.apk'), 'kondukt.apk');
check('sanitize strips weird chars', sanitizeApkFileName('a b;c.apk'), 'a_b_c.apk');
check('sanitize appends .apk', sanitizeApkFileName('payload'), 'payload.apk');
check('sanitize leading dots', sanitizeApkFileName('...hidden.apk'), 'hidden.apk');

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
