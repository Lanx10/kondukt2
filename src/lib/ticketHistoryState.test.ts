import {
  buildTicketHistoryRows,
  fareWord,
  passengerCountLabel,
  readablePassengerType,
  ticketCountLabel,
  ticketHistorySubtitle,
  ticketHistoryTotals,
  ticketRowAnnouncement,
  toTicketHistoryState,
} from './ticketHistoryState';
import type { TicketRowRecord, TripRowRecord } from '../data/schema';

/**
 * Self-check for the Trip Ticket History screen's scoping, ordering and
 * display mapping.
 *
 * Run with: npx tsx src/lib/ticketHistoryState.test.ts
 *
 * The fragile parts: the trip-id guard (one trip's tickets must never appear
 * under another), the oldest-first tie-break (the book fills in order), the
 * fold that carries the trip, pluralization, and the readable type mapping.
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

const row = (
  id: number,
  tripId: number,
  createdAt: number,
  type: TicketRowRecord['passenger_type'],
  qty: number,
): TicketRowRecord =>
  ({
    id,
    trip_id: tripId,
    created_at: createdAt,
    origin_location_snapshot: 'Santa Maria, Bulacan',
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    passenger_type: type,
    passenger_quantity: qty,
    final_fare_per_passenger: 162_00,
    total_fare: 162_00 * qty,
  }) as TicketRowRecord;

const trip = (status: TripRowRecord['status']): TripRowRecord =>
  ({
    id: 1,
    trip_number: '6',
    origin_location_snapshot: 'Santa Cruz, Olongapo',
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    started_at: 1_000,
    ended_at: status === 'ACTIVE' ? null : 2_000,
    distance_km_milli: 86_200,
    status,
    uses_sctex: 1,
  }) as TripRowRecord;

// ── scoping ─────────────────────────────────────────────────────────────────
const scoped = buildTicketHistoryRows(
  [row(1, 7, 300, 'REGULAR', 1), row(2, 8, 900, 'REGULAR', 2), row(3, 7, 600, 'PWD', 1)],
  7,
);
check('only the requested trip survives the guard', scoped.map((r) => r.ticketId), [1, 3]);
check(
  'a newer ticket from another trip never appears',
  scoped.some((r) => r.ticketId === 2),
  false,
);

// ── ordering ────────────────────────────────────────────────────────────────
const ordered = buildTicketHistoryRows(
  [row(1, 7, 500, 'REGULAR', 1), row(3, 7, 900, 'REGULAR', 1), row(2, 7, 900, 'REGULAR', 1)],
  7,
);
check('oldest first — the way the book fills', ordered.map((r) => r.ticketId), [1, 2, 3]);
check(
  'same timestamp breaks by lower id first',
  ordered[1].ticketId < ordered[2].ticketId,
  true,
);

// ── pluralization ───────────────────────────────────────────────────────────
check('singular by count', passengerCountLabel(1), '1 passenger');
check('plural by count', passengerCountLabel(2), '2 passengers');
check('zero reads as plural', passengerCountLabel(0), '0 passengers');
check('one ticket singular', ticketCountLabel(1), '1 ticket');
check('zero tickets plural', ticketCountLabel(0), '0 tickets');

// ── readable types and fare names ───────────────────────────────────────────
check('SENIOR_CITIZEN reads as Senior citizen', readablePassengerType('SENIOR_CITIZEN'), 'Senior citizen');
check('PWD reads as PWD', readablePassengerType('PWD'), 'PWD');
check('REGULAR reads as Regular', readablePassengerType('REGULAR'), 'Regular');
check('STUDENT reads as Student', readablePassengerType('STUDENT'), 'Student');
check('the card names the fare', fareWord('SENIOR_CITIZEN'), 'Senior citizen fare');
check('an acronym stays an acronym in the fare name', fareWord('PWD'), 'PWD fare');

// ── the chrome subtitle names the trip ──────────────────────────────────────
check('a running trip says so', ticketHistorySubtitle(trip('ACTIVE'), '6'), 'Trip #6 · running');
check('a closed trip is just its number', ticketHistorySubtitle(trip('COMPLETED'), '6'), 'Trip #6');
check('no trip on this device', ticketHistorySubtitle(null, ''), 'No trip on this device');

// ── totals for the footer ───────────────────────────────────────────────────
const ready = toTicketHistoryState(
  { trip: trip('ACTIVE'), tickets: [row(1, 1, 100, 'REGULAR', 1), row(2, 1, 200, 'PWD', 2)] },
  1,
);
check('non-empty emission is ready', ready.kind, 'ready');
if (ready.kind === 'ready') {
  check('ready carries the mapped rows', ready.tickets.length, 2);
  check('ready carries the trip for the chrome', ready.tripNumber, '6');
  check(
    'totals count tickets, passengers and centavos',
    ready.totals,
    { count: 2, pax: 3, total: 162_00 * 3 },
  );
}

// ── branch fold ─────────────────────────────────────────────────────────────
const empty = toTicketHistoryState({ trip: trip('COMPLETED'), tickets: [] }, 7);
check('empty first emission is empty, not loading', empty.kind, 'empty');
check(
  'an empty book still carries its trip',
  empty.kind === 'empty' ? empty.tripNumber : 'missing',
  '6',
);
check('totals over nothing read as zeros', ticketHistoryTotals([]), { count: 0, pax: 0, total: 0 });

// ── announcement ────────────────────────────────────────────────────────────
const first = ready.kind === 'ready' ? ready.tickets[0] : (null as never);
const announcement = ticketRowAnnouncement(
  first,
  (c) => `₱${(c / 100).toFixed(2)}`,
  () => '7:45 AM · Mon, Sep 28',
  '6',
);
check(
  'announcement carries ticket, route, stamp, fare name, money and trip',
  announcement,
  'Ticket 1. Santa Maria, Bulacan to Caloocan, Kalakhang Maynila. Taken 7:45 AM · Mon, Sep 28. Regular fare, 1 passenger. ₱162.00 each, ₱162.00 collected. Trip 6. Open the receipt.',
);
check('the id reads as a ticket number, not a row handle', announcement.startsWith('Ticket 1.'), true);
check('announcement never uses the # row-handle form', announcement.includes('#1'), false);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
