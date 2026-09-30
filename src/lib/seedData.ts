import { priceTicket, type FareRules } from './addTicketFare';
import type { PassengerType, TripRowRecord, TicketRowRecord, TerminalRowRecord, MunicipalityRowRecord } from '../data/schema';

/**
 * The one description of the demo dataset, shared by both stores.
 *
 * The app seeds a fresh device so the screens have something true to show. It
 * used to be described **twice** — once in SQL for the device and once again as
 * JavaScript objects in the browser backend — and the two had drifted: the
 * device's version carried distances that contradicted its own terminal KM
 * markers (a 4.4 km route stored as 12.6 km), fares no configuration on the
 * device could produce (₱96.00 for an 86.2 km express run the calculator prices
 * at ₱193.95), and no fare row at all, so the seeded running trip could not be
 * recorded against until somebody configured fares by hand. The browser's copy
 * was the correct one; this module is it, and both readers now consume it.
 *
 * Three rules make the dataset self-consistent, and `seedData.test.ts` asserts
 * each of them:
 *
 *  1. **Distances are derived, never authored.** Every bootstrapping trip on a
 *     terminal pair carries the difference of the two markers, which is exactly
 *     what `measureTrip`/`startTrip` compute when a conductor picks the route —
 *     so the seeds cannot describe a journey the app could not have produced.
 *  2. **Fares are the calculator's output.** Each ticket's per-passenger fare
 *     comes from `priceTicket` against `SEED_RULES` (the configuration below),
 *     and its total is `fare × quantity` — the same product `recordTicketRow`
 *     writes. A seeded peso is therefore explicable by the same rules a live
 *     ticket is.
 *  3. **Timestamps are anchored to the clock that opened the app, never to a
 *     future hour of the day.** The running trip starts `now − 30 min` and its
 *     boardings land in the minutes before the read. The previous version
 *     pinned them to `startOfToday + 6.5 h`, so an app opened at 00:17 showed a
 *     trip "started 6:30 AM" that had not happened yet, with an elapsed time of
 *     0m and boardings stamped in the future.
 */

// ── the configuration every seeded fare is worked out from ───────────────────

/**
 * Centavos per km, thousandths of a km — the store's own units.
 *
 * The ordinary/express pair and the discounted pair are the numbers the Fare
 * Configuration screen's preview and the Add-ticket calculator both charge, so
 * a seeded ticket and a live one can be compared line for line.
 */
export const SEED_FARE = {
  minimum_fare: 5_000,
  minimum_distance_milli: 4_500,
  rate_per_km: 175,
  deluxe_rate_per_km: 250,
  special_rate_per_km: 100,
  express_rate_per_km: 225,
  express_deluxe_rate_per_km: 300,
  special_express_rate_per_km: 130,
  special_deluxe_rate_per_km: 140,
  special_express_deluxe_rate_per_km: 170,
} as const;

export const SEED_SCTEX = { km_adjustment_milli: 500 } as const;

/** `SEED_FARE` in the shape the calculator reads. */
export function seedRules(): FareRules {
  return {
    minimumFareCentavos: SEED_FARE.minimum_fare,
    minimumDistanceMilli: SEED_FARE.minimum_distance_milli,
    ratePerKmCentavos: SEED_FARE.rate_per_km,
    expressRatePerKmCentavos: SEED_FARE.express_rate_per_km,
    specialRatePerKmCentavos: SEED_FARE.special_rate_per_km,
    specialExpressRatePerKmCentavos: SEED_FARE.special_express_rate_per_km,
    sctexAdjustmentMilli: SEED_SCTEX.km_adjustment_milli,
  };
}

// ── the registry the routes are measured on ─────────────────────────────────

export const SEED_MUNICIPALITIES: (MunicipalityRowRecord & { id: number })[] = [
  { id: 1, name: 'Olongapo', province: 'Zambales', is_active: 1 },
  { id: 2, name: 'Caloocan', province: 'Metro Manila', is_active: 1 },
  { id: 3, name: 'Iba', province: 'Zambales', is_active: 1 },
];

/**
 * The stop registry, KM markers included. Every seeded trip's distance is the
 * difference between two of these, so the route a trip describes and the route
 * the Add-trip picker offers are the same road.
 */
export const SEED_TERMINALS: (TerminalRowRecord & { id: number })[] = [
  { id: 1, name: 'Santa Cruz, Olongapo', km_marker: 228_000, is_active: 1, municipality_id: 1 },
  { id: 2, name: 'Caloocan, Kalakhang Maynila', km_marker: 314_200, is_active: 1, municipality_id: 2 },
  { id: 3, name: 'Olongapo, Olongapo', km_marker: 232_400, is_active: 1, municipality_id: 1 },
  { id: 4, name: 'Subic, Subic', km_marker: 249_600, is_active: 1, municipality_id: null },
  { id: 5, name: 'Iba, Zambales', km_marker: 96_800, is_active: 1, municipality_id: 3 },
];

const terminalByName = (name: string) => {
  const terminal = SEED_TERMINALS.find((candidate) => candidate.name === name);
  if (!terminal) throw new Error(`seed route names an unregistered terminal: ${name}`);
  return terminal;
};

/** The driven distance between two named terminals, in milli-km. */
export function seedDistanceMilli(origin: string, destination: string): number {
  return Math.abs(terminalByName(destination).km_marker - terminalByName(origin).km_marker);
}

// ── the trips, and the boardings on them ────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * One boarding, in the order it is recorded: when, who, how many.
 *
 * `offsetMinutes` is measured **after the trip started** — a boarding cannot
 * predate the run it is on, and the window is what `seedData.test.ts` checks.
 */
type Boarding = { offsetMinutes: number; type: PassengerType; quantity: number };

type TripSpec = {
  tripNumber: string;
  origin: string;
  destination: string;
  /** Minutes before `now`, or a day offset for the historical runs. */
  startedAt: (now: number, startOfToday: number) => number;
  /** Null while the trip is running. */
  endedAt: ((now: number, startOfToday: number) => number) | null;
  usesExpressWay: boolean;
  boardings: Boarding[];
};

/**
 * Six trips: one running, one finished earlier in the same shift, and four
 * historical runs across the four days before it — so History has a list, the
 * tiles have a previous day to compare against, and the storage note has more
 * than one day on it.
 */
const TRIP_SPECS: TripSpec[] = [
  {
    // The running trip. Boardings are spread over the half hour before the
    // read, so every stored stamp is in the past on any clock.
    tripNumber: '6',
    origin: 'Santa Cruz, Olongapo',
    destination: 'Caloocan, Kalakhang Maynila',
    startedAt: (now) => now - 30 * MINUTE,
    endedAt: null,
    usesExpressWay: true,
    boardings: [
      { offsetMinutes: 5, type: 'REGULAR', quantity: 2 },
      { offsetMinutes: 10, type: 'STUDENT', quantity: 1 },
      { offsetMinutes: 15, type: 'SENIOR_CITIZEN', quantity: 2 },
      { offsetMinutes: 20, type: 'PWD', quantity: 1 },
    ],
  },
  {
    // The shift's earlier, completed run.
    tripNumber: '5',
    origin: 'Olongapo, Olongapo',
    destination: 'Santa Cruz, Olongapo',
    startedAt: (now) => now - 6 * HOUR,
    endedAt: (now) => now - 1 * HOUR,
    usesExpressWay: false,
    boardings: [
      { offsetMinutes: 30, type: 'REGULAR', quantity: 3 },
      { offsetMinutes: 100, type: 'SENIOR_CITIZEN', quantity: 1 },
      { offsetMinutes: 200, type: 'REGULAR', quantity: 2 },
    ],
  },
  {
    tripNumber: '4',
    origin: 'Santa Cruz, Olongapo',
    destination: 'Subic, Subic',
    startedAt: (_now, startOfToday) => startOfToday - DAY + 2 * HOUR,
    endedAt: (_now, startOfToday) => startOfToday - DAY + 9 * HOUR,
    usesExpressWay: false,
    boardings: [
      { offsetMinutes: 60, type: 'REGULAR', quantity: 2 },
      { offsetMinutes: 180, type: 'PWD', quantity: 1 },
      { offsetMinutes: 300, type: 'STUDENT', quantity: 4 },
    ],
  },
  {
    tripNumber: '3',
    origin: 'Olongapo, Olongapo',
    destination: 'Subic, Subic',
    startedAt: (_now, startOfToday) => startOfToday - 2 * DAY + 5 * HOUR,
    endedAt: (_now, startOfToday) => startOfToday - 2 * DAY + 11 * HOUR,
    usesExpressWay: false,
    boardings: [
      { offsetMinutes: 60, type: 'REGULAR', quantity: 1 },
      { offsetMinutes: 180, type: 'SENIOR_CITIZEN', quantity: 3 },
    ],
  },
  {
    tripNumber: '2',
    origin: 'Iba, Zambales',
    destination: 'Caloocan, Kalakhang Maynila',
    startedAt: (_now, startOfToday) => startOfToday - 3 * DAY + 4 * HOUR,
    endedAt: (_now, startOfToday) => startOfToday - 3 * DAY + 14 * HOUR,
    usesExpressWay: true,
    boardings: [
      { offsetMinutes: 120, type: 'REGULAR', quantity: 1 },
      { offsetMinutes: 300, type: 'STUDENT', quantity: 2 },
      { offsetMinutes: 480, type: 'PWD', quantity: 1 },
    ],
  },
  {
    tripNumber: '1',
    origin: 'Iba, Zambales',
    destination: 'Santa Cruz, Olongapo',
    startedAt: (_now, startOfToday) => startOfToday - 4 * DAY + 6 * HOUR,
    endedAt: (_now, startOfToday) => startOfToday - 4 * DAY + 13 * HOUR,
    usesExpressWay: false,
    boardings: [
      { offsetMinutes: 60, type: 'REGULAR', quantity: 2 },
      { offsetMinutes: 300, type: 'SENIOR_CITIZEN', quantity: 1 },
    ],
  },
];

export type SeedTripRow = TripRowRecord & { id: number };
export type SeedTicketRow = TicketRowRecord & { id: number };

export type SeedData = {
  trips: SeedTripRow[];
  tickets: SeedTicketRow[];
  municipalities: (MunicipalityRowRecord & { id: number })[];
  terminals: (TerminalRowRecord & { id: number })[];
};

/**
 * The whole dataset, relative to the clock that opened the app.
 *
 * Ids are stable and dense (trips 1..n, tickets in recording order) so both
 * stores can insert rows and refer to them, and every ticket's trip id exists
 * and every trip's terminal pair is registered — the relationships the ledger
 * screens walk.
 */
export function buildSeed(now: number): SeedData {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const rules = seedRules();
  const trips: SeedTripRow[] = [];
  const tickets: SeedTicketRow[] = [];

  TRIP_SPECS.forEach((spec, index) => {
    const tripId = index + 1;
    const startedAt = spec.startedAt(now, startOfToday);
    const distance = seedDistanceMilli(spec.origin, spec.destination);
    trips.push({
      id: tripId,
      trip_number: spec.tripNumber,
      origin_location_snapshot: spec.origin,
      destination_location_snapshot: spec.destination,
      started_at: startedAt,
      ended_at: spec.endedAt ? spec.endedAt(now, startOfToday) : null,
      distance_km_milli: distance,
      status: spec.endedAt ? 'COMPLETED' : 'ACTIVE',
      uses_sctex: spec.usesExpressWay ? 1 : 0,
    });

    for (const boarding of spec.boardings) {
      // The calculator prices every seeded boarding — the same function the
      // Add-ticket screen calls, so the seed cannot disagree with a live fare.
      const priced = priceTicket({
        distanceMilli: distance,
        usesExpressWay: spec.usesExpressWay,
        passengerType: boarding.type,
        quantity: boarding.quantity,
        rules,
      });
      if (!priced) throw new Error('seed boarding could not be priced');
      tickets.push({
        id: tickets.length + 1,
        trip_id: tripId,
        created_at: startedAt + boarding.offsetMinutes * MINUTE,
        // The snapshots are the trip's own terminals, which is what a recorded
        // boarding inherits from the pair the conductor chose.
        origin_location_snapshot: spec.origin,
        destination_location_snapshot: spec.destination,
        passenger_type: boarding.type,
        passenger_quantity: boarding.quantity,
        final_fare_per_passenger: priced.perPassengerCentavos,
        total_fare: priced.totalCentavos,
      });
    }
  });

  return {
    trips,
    tickets,
    // Copies, not the module's own objects: the browser backend writes to the
    // rows it holds (deactivating a terminal, ending a trip), and a second seed
    // in the same process must start from the registry's declared values rather
    // than from whatever the first one mutated.
    municipalities: SEED_MUNICIPALITIES.map((row) => ({ ...row })),
    terminals: SEED_TERMINALS.map((row) => ({ ...row })),
  };
}
