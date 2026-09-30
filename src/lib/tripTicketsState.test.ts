import {
  buildTripTicketsState,
  RECENT_TICKET_LIMIT,
  toLoadState,
} from './tripTicketsState';
import type { TicketRowRecord, TripRowRecord } from '../data/schema';

/**
 * Self-check for the ledger arithmetic and the branch mapping.
 *
 * Run with: npx tsx src/lib/tripTicketsState.test.ts
 *
 * The money rules here are the screen's whole point: centavos in, floors not
 * rounds, zero passengers means zero — not NaN, and never a dash.
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

function trip(over: Partial<TripRowRecord> = {}): TripRowRecord {
  return {
    id: 6,
    trip_number: '6',
    origin_location_snapshot: 'Santa Cruz, Olongapo',
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    started_at: 0,
    ended_at: null,
    distance_km_milli: 86_200,
    status: 'ACTIVE',
    uses_sctex: over.uses_sctex ?? 0,
    ...over,
  };
}

function ticket(over: Partial<TicketRowRecord> = {}): TicketRowRecord {
  return {
    id: 1,
    trip_id: 6,
    created_at: 0,
    origin_location_snapshot: 'Santa Cruz, Olongapo',
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    passenger_type: 'REGULAR',
    passenger_quantity: 1,
    final_fare_per_passenger: 96_00,
    total_fare: 96_00,
    ...over,
  };
}

// ── totals ──────────────────────────────────────────────────────────────────
const rows = [
  ticket({ id: 1, passenger_quantity: 2, total_fare: 192_00 }),
  ticket({ id: 2, passenger_quantity: 1, total_fare: 76_80, passenger_type: 'STUDENT' }),
];
const state = buildTripTicketsState(trip(), rows);
check('totalTickets is the row count', state.totalTickets, 2);
check('totalPassengers sums quantities', state.totalPassengers, 3);
check('totalEarnings sums total_fare', state.totalEarnings, 268_80);
check(
  'average floors to the cent',
  state.averageFarePerPassenger,
  Math.floor(268_80 / 3),
);

// Cent-level flooring, not rounding: 268.80 / 3 = 89.60 exactly; make it land
// on a repeating decimal instead.
const floorState = buildTripTicketsState(trip(), [
  ticket({ id: 1, passenger_quantity: 3, total_fare: 100_00 }),
]);
check('floors, never rounds up', floorState.averageFarePerPassenger, 3333);

// ── the empty ledger ────────────────────────────────────────────────────────
const empty = buildTripTicketsState(trip(), []);
check('no tickets is zero tickets', empty.totalTickets, 0);
check('no passengers is zero passengers', empty.totalPassengers, 0);
check('no earnings is zero earnings', empty.totalEarnings, 0);
check('zero passengers guards the average to 0', empty.averageFarePerPassenger, 0);
check('zero never renders NaN', Number.isFinite(empty.averageFarePerPassenger), true);

// ── ordering and parity ─────────────────────────────────────────────────────
const many = Array.from({ length: 20 }, (_, i) =>
  ticket({ id: i + 1, created_at: 1_000 - i }),
);
const paged = buildTripTicketsState(trip(), many);
check(
  'recentTickets is the first eight rows',
  paged.recentTickets.length,
  RECENT_TICKET_LIMIT,
);
check('recentTickets keeps the newest first', paged.recentTickets[0].ticketId, 1);
check('ticketHistory holds the full ledger', paged.ticketHistory.length, 20);
check(
  'history preserves the SQL order (created_at DESC, id DESC)',
  paged.ticketHistory.map((row) => row.ticketId),
  Array.from({ length: 20 }, (_, i) => i + 1),
);

// Ties on created_at are broken by the SQL `id DESC` term, not by this mapper:
// re-sorting here would be a second opinion about ordering that the index
// quietly stops serving. The mapper's job is to preserve what arrived, ties
// included.
const tied = buildTripTicketsState(trip(), [
  ticket({ id: 9, created_at: 500 }),
  ticket({ id: 7, created_at: 500 }),
  ticket({ id: 3, created_at: 500 }),
]);
check(
  'equal timestamps keep the SQL order verbatim (id DESC from the query)',
  tied.ticketHistory.map((row) => row.ticketId),
  [9, 7, 3],
);

// ── branch mapping ──────────────────────────────────────────────────────────
check('missing trip maps to notFound', toLoadState({ trip: null, tickets: [] }), {
  kind: 'notFound',
});
const ready = toLoadState({ trip: trip(), tickets: rows });
check('a read with a trip maps to ready', ready.kind, 'ready');
check('ready state carries the ledger', ready.kind === 'ready' && ready.state.totalTickets, 2);
check('notFound is an outcome, not a string', 'message' in (toLoadState({ trip: null, tickets: [] }) as object), false);

// Fields map from the snapshot columns, not recomputed.
const mapped = buildTripTicketsState(trip(), [
  ticket({ origin_location_snapshot: 'Iba, Zambales', final_fare_per_passenger: 50_00 }),
]);
check(
  'origin comes from the snapshot column',
  mapped.ticketHistory[0].origin,
  'Iba, Zambales',
);
check(
  'farePerPassenger is the stored final fare',
  mapped.ticketHistory[0].farePerPassenger,
  50_00,
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
