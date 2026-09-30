import {
  boardingNote,
  computeTripTotals,
  formatBreakdownLine,
  plural,
  readablePassengerType,
  storageNote,
  toCurrentTripState,
} from './currentTripState';
import type { TicketRowRecord, TripRowRecord } from '../data/schema';

/**
 * Self-check for the Current Trip screen's totals fold and branch mapping.
 *
 * Run with: npx tsx src/lib/currentTripState.test.ts
 *
 * The fragile parts: quantity-weighted counting, the merged senior/PWD
 * bucket, fare summed without quantity, and the derived passenger distance.
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

const trip = {
  id: 7,
  trip_number: '7',
  started_at: 1_000,
  ended_at: null,
  origin_location_snapshot: 'Santa Maria, Bulacan',
  destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
  distance_km_milli: 42_000, // 42.000 km
  status: 'ACTIVE',
} as TripRowRecord;

const ticket = (id: number, type: TicketRowRecord['passenger_type'], qty: number, fare: number) =>
  ({
    id,
    trip_id: 7,
    created_at: id * 100,
    origin_location_snapshot: 'Santa Maria, Bulacan',
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    passenger_type: type,
    passenger_quantity: qty,
    final_fare_per_passenger: fare,
    total_fare: fare * qty,
  }) as TicketRowRecord;

// ── totals ──────────────────────────────────────────────────────────────────
const totals = computeTripTotals(
  [
    ticket(1, 'REGULAR', 3, 162_00), // 3 pax, ₱486.00
    ticket(2, 'REGULAR', 1, 162_00),
    ticket(3, 'STUDENT', 2, 129_60),
    ticket(4, 'SENIOR_CITIZEN', 1, 129_60),
    ticket(5, 'PWD', 1, 129_60),
  ],
  trip,
);

check('passengers weighted by quantity', totals.passengers, 8);
check('regular bucket', totals.regular, 4);
check('student bucket', totals.student, 2);
check('senior and PWD share one bucket', totals.seniorAndPwd, 2);
// Collection sums each row's stored total_fare — which is already fare ×
// quantity — exactly once per row: 486_00 + 162_00 + 259_20 + 129_60 + 129_60.
check('collection sums total fare once', totals.collection, 116_640);
check(
  'passenger distance is route distance times passengers',
  totals.passengerDistanceMilli,
  42_000 * 8,
);

const emptyTotals = computeTripTotals([], trip);
check('zero tickets, zero totals', emptyTotals.passengers, 0);
check('zero-ticket distance stays zero', emptyTotals.passengerDistanceMilli, 0);

check(
  'breakdown line joins with middots',
  formatBreakdownLine(totals),
  'REGULAR 4 · STUDENT 2 · SENIOR/PWD 2',
);

// ── readable types ──────────────────────────────────────────────────────────
check('PWD reads as PWD', readablePassengerType('PWD'), 'PWD');
check('SENIOR_CITIZEN reads as Senior citizen', readablePassengerType('SENIOR_CITIZEN'), 'Senior citizen');
check('REGULAR reads as Regular', readablePassengerType('REGULAR'), 'Regular');

// ── branch mapping ──────────────────────────────────────────────────────────
const mapped = toCurrentTripState(trip, [ticket(1, 'REGULAR', 2, 100_00)]);
check('ready carries trip, tickets, totals', mapped.kind, 'ready');
if (mapped.kind === 'ready') {
  check('mapped totals recompute', mapped.totals.passengers, 2);
}

check('null trip maps to empty', toCurrentTripState(null, []).kind, 'empty');
check('no flash: only a positive null maps to empty', toCurrentTripState(null, []).kind !== 'loading', true);

// ── ledger wording ──────────────────────────────────────────────────────────
const rules = { minimumFareCentavos: 5_000, minimumDistanceMilli: 4_500 };

check('plural one', plural(1, 'boarding', 'boardings'), '1 boarding');
check('plural many', plural(15, 'boarding', 'boardings'), '15 boardings');

// The reference's own seed: an 800-millimetre leg lands on both floors and
// prints the distance one first.
check(
  'distance floor wins when both bound',
  boardingNote({ totalCentavos: 10_000, quantity: 2, legMilli: 800, rules }),
  'minimum distance',
);
check(
  'fare floor when the leg is long enough',
  boardingNote({ totalCentavos: 5_000, quantity: 1, legMilli: 13_000, rules }),
  'minimum fare',
);
check(
  'linear row prints the unit price',
  boardingNote({ totalCentavos: 20_184, quantity: 3, legMilli: 29_400, rules }),
  '₱67.28 each',
);
check(
  'unknown leg can still name the fare floor',
  boardingNote({ totalCentavos: 5_000, quantity: 1, legMilli: null, rules }),
  'minimum fare',
);
check(
  'unknown leg never claims the distance floor',
  boardingNote({ totalCentavos: 10_000, quantity: 2, legMilli: null, rules }),
  'minimum fare',
);
check(
  'no rules: the unit price is the only word',
  boardingNote({ totalCentavos: 15_000, quantity: 3, legMilli: 800, rules: null }),
  '₱50.00 each',
);

const noteFull = storageNote({
  totals,
  rows: 5,
  byFare: 3,
  byDistance: 1,
  rules,
});
check('storage note opens with the fold', noteFull.startsWith(
  'Every figure here is a sum of stored rows: 5 boardings, 8 passengers, ₱1,166.40 collected.',
), true);
check('storage note counts both floors', noteFull.includes(
  '1 of 5 are priced above both floors by distance, 3 land on the ₱50.00 minimum fare and 1 on the 4.5 km minimum distance',
), true);
check(
  'storage note drops the floors without rules',
  storageNote({ totals, rows: 5, byFare: 3, byDistance: 1, rules: null }),
  'Every figure here is a sum of stored rows: 5 boardings, 8 passengers, ₱1,166.40 collected.',
);
check(
  'storage note drops the floors with no rows',
  storageNote({
    totals: computeTripTotals([], trip),
    rows: 0,
    byFare: 0,
    byDistance: 0,
    rules,
  }),
  'Every figure here is a sum of stored rows: 0 boardings, 0 passengers, ₱0.00 collected.',
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
