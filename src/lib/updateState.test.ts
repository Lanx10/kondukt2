import {
  UPDATE_CHECK_MIN_INTERVAL_MS,
  UPDATE_COPY,
  autoCheckFailureNote,
  checkLogLine,
  classifyUpdateError,
  isUpdateBusy,
  shouldAutoCheck,
  updateStatusText,
  type UpdatePhase,
} from './updateState';

/**
 * Self-check for the update system's pure rules.
 *
 * Run with: npx tsx src/lib/updateState.test.ts
 *
 * The throttle is the load-bearing rule: too eager and an offline operator's
 * phone retries on every resume; too shy and a fix lands days late. The
 * classification is the other: every thrown expo-updates error must land on
 * one of the four friendly sentences, never on the exception itself.
 */

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok ${name}`);
  }
}

const HOUR = 3_600_000;
const now = 1_000_000_000_000;

// ── throttle ──────────────────────────────────────────────────────────────
check('first-ever auto check allowed', shouldAutoCheck(null, now), true);
check('garbage timestamp allowed', shouldAutoCheck(Number.NaN, now), true);
check('fresh attempt throttles', shouldAutoCheck(now - HOUR, now), false);
check(
  'interval boundary allows',
  shouldAutoCheck(now - UPDATE_CHECK_MIN_INTERVAL_MS, now),
  true,
);
check(
  'one ms short of interval throttles',
  shouldAutoCheck(now - UPDATE_CHECK_MIN_INTERVAL_MS + 1, now),
  false,
);
check('ancient attempt allowed', shouldAutoCheck(now - 48 * HOUR, now), true);

// ── error classification ──────────────────────────────────────────────────
check(
  'network error → offline',
  classifyUpdateError('Network request failed', 'check'),
  'offline',
);
check(
  'fetch failure → offline',
  classifyUpdateError('Failed to fetch', 'check'),
  'offline',
);
check(
  'timeout → offline',
  classifyUpdateError('Operation timed out', 'check'),
  'offline',
);
check(
  'unknown error → server',
  classifyUpdateError('Manifest is invalid', 'check'),
  'server',
);
check('null message → server', classifyUpdateError(null, 'check'), 'server');
check(
  'development-mode refusal → disabled',
  classifyUpdateError(
    'ERR_UPDATES_DISABLED: You cannot check for updates in development mode.',
    'check',
  ),
  'disabled',
);
check(
  'download failure is never offline',
  classifyUpdateError('Network request failed', 'download'),
  'download',
);
check(
  'apply failure maps to the restart copy',
  classifyUpdateError('anything', 'apply'),
  'apply',
);
check('error+apply copy', updateStatusText('error', 'apply'), UPDATE_COPY.apply);

// ── status copy ───────────────────────────────────────────────────────────
const phases: UpdatePhase[] = [
  'idle',
  'checking',
  'available',
  'downloading',
  'ready',
  'uptodate',
  'disabled',
  'error',
];
for (const phase of phases) {
  const text = updateStatusText(phase, null);
  check(`copy for ${phase} is non-empty`, text.length > 0, true);
}
check('error+offline copy', updateStatusText('error', 'offline'), UPDATE_COPY.offline);
check('error+server copy', updateStatusText('error', 'server'), UPDATE_COPY.server);
check('error+download copy', updateStatusText('error', 'download'), UPDATE_COPY.download);
check('uptodate copy', updateStatusText('uptodate', null), UPDATE_COPY.uptodate);
check(
  'no copy leaks an exception',
  Object.values(UPDATE_COPY).every(
    (line) => !line.includes('Error:') && !line.includes('    at '),
  ),
  true,
);

// ── busy flag ─────────────────────────────────────────────────────────────
check('checking is busy', isUpdateBusy('checking'), true);
check('downloading is busy', isUpdateBusy('downloading'), true);
check('available is not busy', isUpdateBusy('available'), false);
check('ready is not busy', isUpdateBusy('ready'), false);
check('error is not busy', isUpdateBusy('error'), false);

// ── log helpers stay informational ────────────────────────────────────────
check(
  'check log line has outcome only',
  checkLogLine('unavailable'),
  'updates: check → unavailable',
);
check(
  'auto failure note offline',
  autoCheckFailureNote('offline'),
  'updates: automatic check skipped, device offline',
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
