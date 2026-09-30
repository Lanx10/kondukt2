import {
  estimateNote,
  filterTerminals,
  formatPreviewDate,
  formatPreviewTime,
  measureTrip,
  routeDistance,
  validateRoute,
} from './addTripState';
import { seedRules } from './seedData';
import type { TerminalRowRecord } from '../data/schema';

/**
 * Self-check for the Add-trip route rules.
 *
 * Run with: npx tsx src/lib/addTripState.test.ts
 *
 * The validation order is the spec's: the active-trip rule first, because
 * "choose a terminal" is advice that cannot fix a trip that is already
 * running. Every message names its own cause.
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

function terminal(over: Partial<TerminalRowRecord> = {}): TerminalRowRecord {
  return {
    id: 1,
    name: 'Santa Cruz, Olongapo',
    km_marker: 228_000,
    is_active: 1,
    municipality_id: null,
    ...over,
  };
}

const santaCruz = terminal();
const caloocan = terminal({ id: 2, name: 'Caloocan, Kalakhang Maynila', km_marker: 314_200 });

// ── validation order ────────────────────────────────────────────────────────
check(
  'active trip is reported first, before missing terminals',
  validateRoute({ hasActiveTrip: true, origin: null, destination: null }),
  'A trip is already running. End it before starting another.',
);
check(
  'missing origin names the origin',
  validateRoute({ hasActiveTrip: false, origin: null, destination: caloocan }),
  'Choose a departure terminal.',
);
check(
  'missing destination names the destination',
  validateRoute({ hasActiveTrip: false, origin: santaCruz, destination: null }),
  'Choose a destination terminal.',
);
check(
  'same terminal on both ends is its own message',
  validateRoute({ hasActiveTrip: false, origin: santaCruz, destination: santaCruz }),
  'Origin and destination are the same terminal.',
);
check(
  'negative KM marker is named',
  validateRoute({
    hasActiveTrip: false,
    origin: terminal({ km_marker: -1 }),
    destination: caloocan,
  }),
  'A terminal KM marker is not configured.',
);
check(
  'a valid route validates to null',
  validateRoute({ hasActiveTrip: false, origin: santaCruz, destination: caloocan }),
  null,
);

// ── distance ────────────────────────────────────────────────────────────────
check(
  'distance is absolute across directions',
  routeDistance(santaCruz, caloocan),
  routeDistance(caloocan, santaCruz),
);
check('the seed pair produces 86.200 km', routeDistance(santaCruz, caloocan), 86_200);
check('unselected end is null, not zero', routeDistance(santaCruz, null), null);
check(
  'negative marker is null, not zero',
  routeDistance(terminal({ km_marker: -5 }), caloocan),
  null,
);

// ── search ──────────────────────────────────────────────────────────────────
const list = [santaCruz, caloocan, terminal({ id: 3, name: 'Iba, Zambales' })];
check('search is case-insensitive', filterTerminals(list, 'santa').length, 1);
check('search on km-ordered list preserves order', filterTerminals(list, 'a').length, 3);
check('search miss is empty', filterTerminals(list, 'vigan'), []);

// ── formatters ──────────────────────────────────────────────────────────────
// ── measure ──────────────────────────────────────────────────────────────────
const rules = seedRules();
const measured = measureTrip({ origin: santaCruz, destination: caloocan, usesSctex: false, rules });
check('the seed pair measures ok', measured.ok, true);
check('route distance is the absolute marker gap', measured.distMilli, 86_200);
check('ordinary road adds no adjustment', measured.billableMilli, 86_200);
check('ordinary road bills the ordinary rate', measured.rateCentavos, rules.ratePerKmCentavos);
const express = measureTrip({ origin: santaCruz, destination: caloocan, usesSctex: true, rules });
check('sctex adds its half kilometre after the floor', express.billableMilli, 86_700);
check('sctex bills the express rate', express.rateCentavos, rules.expressRatePerKmCentavos);
const floored = measureTrip({
  origin: terminal({ id: 3, km_marker: 1_000 }),
  destination: terminal({ id: 4, km_marker: 2_000 }),
  usesSctex: false,
  rules,
});
check('a hop under the minimum distance bills the floor', floored.billableMilli, rules.minimumDistanceMilli);
check('the floor marks itself as binding', floored.minDistBinds, true);
check(
  'missing ends refuse with the choose sentence',
  measureTrip({ origin: null, destination: caloocan, usesSctex: false, rules }).reason,
  'Choose an origin and a destination.',
);
check(
  'the same terminal on both ends is refused',
  measureTrip({ origin: santaCruz, destination: santaCruz, usesSctex: false, rules }).ok,
  false,
);

// ── estimate note ────────────────────────────────────────────────────────────
check(
  'the plain branch names the minimum fare',
  estimateNote({ measure: measured, rules }),
  'On this road the route distance is the billable distance.' +
    ' The minimum fare of ₱50.00 applies to every boarding on it.',
);
check(
  'the floor branch names both distances and the fare',
  estimateNote({ measure: floored, rules }),
  'These two terminals are 1.0 km apart, so 4.5 km is billed against the 4.5 km minimum distance.' +
    ' The minimum fare of ₱50.00 applies to every boarding on it.',
);
check(
  'the toll branch carries the adjustment through',
  estimateNote({ measure: express, rules }),
  'The billable distance is 86.7 km — the 86.2 km route plus 0.5 km on this road — ' +
    'and the expressway rate applies to all of it.' +
    ' The minimum fare of ₱50.00 applies to every boarding on it.',
);

// ── formatters ──────────────────────────────────────────────────────────────
const stamp = new Date(2026, 8, 26, 14, 5).getTime();
check('preview time is 24-hour', formatPreviewTime(stamp), '14:05');
check('preview date is medium', formatPreviewDate(stamp), 'Sep 26, 2026');

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
