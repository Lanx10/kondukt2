import { priceTicket } from './addTicketFare';
import {
  SEED_TERMINALS,
  buildSeed,
  seedDistanceMilli,
  seedRules,
} from './seedData';

/**
 * Self-check for the demo dataset.
 *
 * Run with: npx tsx src/lib/seedData.test.ts
 *
 * Seeded records are read by every screen, so a seed that disagrees with the
 * app is worse than no seed: the device's copy of this data once carried a
 * 4.4 km route stored as 12.6 km and a ₱96.00 fare where the calculator prices
 * ₱193.95, and nothing failed — the numbers were simply wrong, in the app's own
 * name. Each check below is one of those relationships.
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

// A clock in the middle of a shift — the ordinary case the dataset has to suit.
const NOON = new Date(2026, 8, 29, 12, 0, 0).getTime();
const seed = buildSeed(NOON);
const rules = seedRules();

// ── relationships ──────────────────────────────────────────────────────────
const tripIds = new Set(seed.trips.map((trip) => trip.id));
check('every ticket belongs to a trip that exists', seed.tickets.every((t) => tripIds.has(t.trip_id)), true);
check(
  'every ticket names its own trip’s terminals',
  seed.tickets.every((ticket) => {
    const trip = seed.trips.find((candidate) => candidate.id === ticket.trip_id)!;
    return (
      ticket.origin_location_snapshot === trip.origin_location_snapshot &&
      ticket.destination_location_snapshot === trip.destination_location_snapshot
    );
  }),
  true,
);
check(
  'every route name is a registered terminal',
  seed.trips.every((trip) =>
    SEED_TERMINALS.some((terminal) => terminal.name === trip.origin_location_snapshot) &&
    SEED_TERMINALS.some((terminal) => terminal.name === trip.destination_location_snapshot),
  ),
  true,
);
check('trip status agrees with ended_at', seed.trips.every((trip) => (trip.ended_at === null) === (trip.status === 'ACTIVE')), true);
check('exactly one trip is running', seed.trips.filter((t) => t.status === 'ACTIVE').length, 1);
check('there are completed trips to list', seed.trips.filter((t) => t.status === 'COMPLETED').length > 0, true);

// ── distances are the registry's own arithmetic ────────────────────────────
check(
  'every distance is the difference of its two KM markers',
  seed.trips.every(
    (trip) =>
      trip.distance_km_milli ===
      seedDistanceMilli(trip.origin_location_snapshot, trip.destination_location_snapshot),
  ),
  true,
);
check('the long run is 217.4 km', seedDistanceMilli('Iba, Zambales', 'Caloocan, Kalakhang Maynila'), 217_400);
check('a short hop is 4.4 km', seedDistanceMilli('Olongapo, Olongapo', 'Santa Cruz, Olongapo'), 4_400);

// ── fares are the calculator's output ──────────────────────────────────────
check(
  'every fare per passenger is priceTicket’s answer',
  seed.tickets.every((ticket) => {
    const trip = seed.trips.find((candidate) => candidate.id === ticket.trip_id)!;
    const priced = priceTicket({
      distanceMilli: trip.distance_km_milli,
      usesExpressWay: trip.uses_sctex === 1,
      passengerType: ticket.passenger_type,
      quantity: ticket.passenger_quantity,
      rules,
    });
    return priced !== null && priced.perPassengerCentavos === ticket.final_fare_per_passenger;
  }),
  true,
);
check(
  'every total is fare × quantity (money is derived, never authored)',
  seed.tickets.every(
    (ticket) =>
      ticket.total_fare === ticket.final_fare_per_passenger * ticket.passenger_quantity,
  ),
  true,
);
check(
  // Inside the minimum distance the fare is the flat minimum fare. Past it
  // the fare is distance × rate with no floor, so with these seeded rates a
  // mid-length leg can price under the minimum fare — that is the rule, not a
  // missing lift.
  'a ticket inside the minimum distance charges exactly the minimum fare',
  seed.tickets
    .filter((ticket) => {
      const trip = seed.trips.find((candidate) => candidate.id === ticket.trip_id)!;
      return trip.distance_km_milli <= rules.minimumDistanceMilli;
    })
    .every((ticket) => ticket.final_fare_per_passenger === rules.minimumFareCentavos),
  true,
);
// The two the calculator's arithmetic actually decides, by name.
const expressRegular = seed.tickets.find(
  (ticket) => ticket.trip_id === 1 && ticket.passenger_type === 'REGULAR',
)!;
check('86.2 km express, regular: ₱194.00 (₱193.95 rounds up)', expressRegular.final_fare_per_passenger, 19_400);
check('86.2 km express, regular: ₱388.00 for two', expressRegular.total_fare, 38_800);
const expressStudent = seed.tickets.find(
  (ticket) => ticket.trip_id === 1 && ticket.passenger_type === 'STUDENT',
)!;
check('86.2 km express, student: ₱112.00 (₱112.06 rounds down, the discounted express rate)', expressStudent.final_fare_per_passenger, 11_200);
const hop = seed.tickets.find((ticket) => ticket.trip_id === 2)!;
check('4.4 km ordinary: lifted to the ₱50 minimum', hop.final_fare_per_passenger, 5_000);
const longRun = seed.tickets.find(
  (ticket) => ticket.trip_id === 5 && ticket.passenger_type === 'REGULAR',
)!;
check('217.4 km express, regular: ₱489.00', longRun.final_fare_per_passenger, 48_900);

// ── timestamps are in the past, and inside their own run ───────────────────
check('no seeded stamp is in the future', seed.tickets.every((t) => t.created_at <= NOON), true);
check('no trip starts in the future', seed.trips.every((t) => t.started_at <= NOON), true);
check(
  'every boarding falls inside its trip’s own window',
  seed.tickets.every((ticket) => {
    const trip = seed.trips.find((candidate) => candidate.id === ticket.trip_id)!;
    const end = trip.ended_at ?? NOON;
    return ticket.created_at >= trip.started_at && ticket.created_at <= end;
  }),
  true,
);
check(
  'no boarding predates its own trip',
  seed.tickets.every((ticket) => {
    const trip = seed.trips.find((candidate) => candidate.id === ticket.trip_id)!;
    return ticket.created_at >= trip.started_at;
  }),
  true,
);

// The same dataset opened just after midnight must stay in the past too — the
// clock that made the old seed show a trip "started 6:30 AM" at 00:17.
const AFTER_MIDNIGHT = new Date(2026, 8, 29, 0, 17, 0).getTime();
const lateSeed = buildSeed(AFTER_MIDNIGHT);
check('a 00:17 launch stamps nothing in the future', lateSeed.tickets.every((t) => t.created_at <= AFTER_MIDNIGHT), true);
check('a 00:17 launch starts no trip in the future', lateSeed.trips.every((t) => t.started_at <= AFTER_MIDNIGHT), true);

// ── the running trip is genuinely running ─────────────────────────────────
const running = seed.trips.find((trip) => trip.status === 'ACTIVE')!;
check('the running trip started before now', running.started_at <= NOON, true);
check('the running trip has boardings recorded against it', seed.tickets.some((t) => t.trip_id === running.id), true);
check(
  'passenger categories cover all four the store accepts',
  [...new Set(seed.tickets.map((t) => t.passenger_type))].sort(),
  ['PWD', 'REGULAR', 'SENIOR_CITIZEN', 'STUDENT'],
);

// ── the two stores read the same registry ─────────────────────────────────
check('five terminals are registered', seed.terminals.length, 5);
check('three municipalities are registered', seed.municipalities.length, 3);
check(
  'every terminal links to a registered municipality or none',
  seed.terminals.every(
    (terminal) =>
      terminal.municipality_id === null ||
      seed.municipalities.some((municipality) => municipality.id === terminal.municipality_id),
  ),
  true,
);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
