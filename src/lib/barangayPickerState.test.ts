import {
  barangayNameOf,
  destinationStopsAfterOrigin,
  filterBarangaysByQuery,
  municipalityNameOf,
  nearestOriginStop,
  rowAnnouncement,
  toBarangayRow,
  toPickerState,
  tripStopsWithinBounds,
  type BarangayRow,
} from './barangayPickerState';
import type { TerminalRowRecord } from '../data/schema';

/**
 * Self-check for the Barangay Picker's eligibility pipeline, search, and fold.
 *
 * Run with: npx tsx src/lib/barangayPickerState.test.ts
 *
 * The fragile parts: bounds are inclusive, direction flips the sort, the
 * boarding side returns exactly one row, the destination side is strict about
 * the origin, a missing terminal empties the list, and search narrows after
 * eligibility.
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

const terminal = (id: number, name: string, km: number, active = 1): TerminalRowRecord =>
  ({ id, name, km_marker: km, is_active: active }) as TerminalRowRecord;

// A descending trip: Santa Cruz (314.2 km) → Iba (96.8 km). Stops in between.
const stops: BarangayRow[] = [
  toBarangayRow(terminal(1, 'Santa Cruz, Olongapo', 314_200)),
  toBarangayRow(terminal(2, 'Caloocan, Kalakhang Maynila', 228_000)),
  toBarangayRow(terminal(3, 'Subic, Subic', 249_600)),
  toBarangayRow(terminal(4, 'Iba, Zambales', 96_800)),
  toBarangayRow(terminal(5, 'Masinloc, Zambales', 150_000)),
  toBarangayRow(terminal(6, 'Palauig, Zambales', 150_000)), // tie with Masinloc on KM
];

// ── label parsing ───────────────────────────────────────────────────────────
check('barangay name is the label head', barangayNameOf('Santa Cruz, Olongapo'), 'Santa Cruz');
check('municipality is the label tail', municipalityNameOf('Santa Cruz, Olongapo'), 'Olongapo');
check('bare name passes through both', [barangayNameOf('Subic'), municipalityNameOf('Subic')], ['Subic', '']);

// ── bounds and direction ────────────────────────────────────────────────────
check(
  'missing terminal empties the list',
  tripStopsWithinBounds(stops, null, 96_800),
  [],
);
check(
  'missing destination terminal empties the list',
  tripStopsWithinBounds(stops, 314_200, null),
  [],
);

// Descending trip: 314.2 → 96.8. Inclusive bounds, sorted descending, ties by id.
const descending = tripStopsWithinBounds(stops, 314_200, 96_800);
check('descending trip sorts descending', descending.map((r) => r.id), [1, 3, 2, 5, 6, 4]);
check(
  'tie breaks by ascending id',
  descending.filter((r) => r.kmMarker === 150_000).map((r) => r.id),
  [5, 6],
);

// Ascending trip: 96.8 → 314.2.
const ascending = tripStopsWithinBounds(stops, 96_800, 314_200);
check('ascending trip sorts ascending', ascending.map((r) => r.id), [4, 5, 6, 2, 3, 1]);

// Out-of-bounds rows are excluded: a stop beyond either marker.
check(
  'out-of-bounds stops excluded',
  tripStopsWithinBounds(
    [...stops, toBarangayRow(terminal(7, 'Olongapo, Olongapo', 400_000))],
    96_800,
    314_200,
  ).some((r) => r.id === 7),
  false,
);

// ── boarding side ───────────────────────────────────────────────────────────
check(
  'boarding side returns exactly one row',
  nearestOriginStop(descending, 314_200, 96_800).map((r) => r.id),
  [1],
);
check(
  'boarding tie breaks by ascending id',
  nearestOriginStop(
    [toBarangayRow(terminal(9, 'A, M', 100_000)), toBarangayRow(terminal(8, 'B, M', 100_000))],
    100_000,
    50_000,
  ).map((r) => r.id),
  [8],
);
check('boarding with no rows stays empty', nearestOriginStop([], 1, 2), []);

// ── destination side ────────────────────────────────────────────────────────
// Origin = Santa Cruz (id 1, 314.2 km) on the descending trip: everything below it.
const afterTop = destinationStopsAfterOrigin(stops, 1, 314_200, 96_800);
check('destination keeps strictly-below stops', afterTop.map((r) => r.id), [3, 2, 5, 6, 4]);

// A stop at exactly the origin's marker is excluded.
const withTwin = [...stops, toBarangayRow(terminal(7, 'Twin, Olongapo', 314_200))];
check(
  'stop at exactly the origin marker is excluded',
  destinationStopsAfterOrigin(withTwin, 1, 314_200, 96_800).some((r) => r.id === 7),
  false,
);

// Missing origin id → the full in-bounds list, never empty.
check(
  'missing origin id returns full list',
  destinationStopsAfterOrigin(stops, null, 314_200, 96_800).length,
  descending.length,
);
// Unresolvable origin id → same.
check(
  'unknown origin id returns full list',
  destinationStopsAfterOrigin(stops, 99, 314_200, 96_800).length,
  descending.length,
);

// Ascending trip destination: strictly above the origin.
check(
  'ascending destination keeps strictly-above stops',
  destinationStopsAfterOrigin(stops, 4, 96_800, 314_200).map((r) => r.id),
  [5, 6, 2, 3, 1],
);

// ── search ──────────────────────────────────────────────────────────────────
check('search matches name', filterBarangaysByQuery(descending, 'subic').map((r) => r.id), [3]);
check('search matches raw km integer', filterBarangaysByQuery(descending, '249').map((r) => r.id), [3]);
check('search trims', filterBarangaysByQuery(descending, '  iba  ').map((r) => r.id), [4]);
check('blank query returns list unchanged', filterBarangaysByQuery(descending, '   ').length, descending.length);
check('search does not match municipality', filterBarangaysByQuery(descending, 'zambales').length, 0);

// ── fold ────────────────────────────────────────────────────────────────────
check('all data pending with no rows is loading', toPickerState([], [], true, ''), { kind: 'loading' });
check('empty eligible after data is emptyEligible', toPickerState([], [], false, ''), { kind: 'emptyEligible' });
check('trip failure with data is not loading', toPickerState([], [], false, ''), { kind: 'emptyEligible' });
check('query wiping rows is emptyMatches', toPickerState(descending, [], false, 'zzz'), { kind: 'emptyMatches' });
const readyState = toPickerState(descending, filterBarangaysByQuery(descending, 'iba'), false, 'iba');
check('ready carries the filtered row', readyState.kind === 'ready' && readyState.rows.map((r) => r.id), [4]);

// ── announcement ────────────────────────────────────────────────────────────
check(
  'announcement names side and km',
  rowAnnouncement(stops[3], 'boarding', (m) => `${(m / 1000).toFixed(3)} km`),
  'Pick Iba, Zambales, 96.800 km. Choosing the boarding location.',
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
