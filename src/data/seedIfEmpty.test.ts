/// <reference types="node" />
// The reference above is this file's own: the project's tsconfig extends
// `expo/tsconfig.base`, whose `customConditions` keep `@types/node` out of the
// automatic type-library inclusion, and this test drives a real SQLite engine
// (`node:sqlite`) instead of a mock.
import { DatabaseSync } from 'node:sqlite';
import { priceTicket } from '../lib/addTicketFare';
import {
  SEED_FARE,
  SEED_SCTEX,
  buildSeed,
  seedDistanceMilli,
  seedRules,
} from '../lib/seedData';
import { BOOTSTRAP_SQL, SEEDED_VERSION } from '../lib/storeSchema';
import { seedIfEmpty } from './tripTicketsStore';

/**
 * Self-check for the REAL seed path, run against a real SQLite engine.
 *
 * Run with: npx tsx src/data/seedIfEmpty.test.ts
 *
 * `seedIfEmpty` is the function the app's first launch runs — not a copy of
 * it, not `buildSeed` alone. The demo dataset had once drifted into three
 * hand-written copies that disagreed with each other and with the terminal KM
 * markers (a 4.4 km route stored as 12.6 km, fares no configuration could
 * produce); this suite pins the one path that ships: the rows the database
 * actually holds must equal `buildSeed(now)` field for field, every distance
 * must be its marker difference, and every fare must re-derive through
 * `priceTicket` from the seeded rules.
 *
 * Two inputs are pinned so equality is exact rather than approximate: a fixed
 * `now` (every stored timestamp is a pure function of it) and `demo: true`
 * (the insert branch, chosen directly rather than through `__DEV__`). The
 * release branch — stamp, no records — is exercised on a second database,
 * because that is the path a shipped build takes.
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

/** The subset of the expo-sqlite handle `seedIfEmpty` calls, over node:sqlite. */
function shim(db: DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      const info = db.prepare(sql).run(...(params as never[]));
      return {
        changes: Number(info.changes),
        // node:sqlite spells it `lastInsertRowid`; the handle the seed path
        // sees is expo-sqlite's, which spells the second `I`.
        lastInsertRowId: Number(info.lastInsertRowid),
      };
    },
    getFirstAsync: async <T,>(sql: string, ...params: unknown[]): Promise<T | null> =>
      (db.prepare(sql).get(...(params as never[])) ?? null) as T | null,
    getAllAsync: async <T,>(sql: string, ...params: unknown[]): Promise<T[]> =>
      db.prepare(sql).all(...(params as never[])) as T[],
    withTransactionAsync: async (task: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // The transaction is already unwound; the original error is the one
          // worth propagating.
        }
        throw error;
      }
    },
  };
}

/** The seed path's own handle type — `seedIfEmpty` never leaves this module. */
type SeedHandle = Parameters<typeof seedIfEmpty>[0];

/** Which columns of a row differ from the expectation; `[]` is equality. */
function rowDiff(actual: Record<string, unknown>, expected: Record<string, unknown>): string[] {
  const cols = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  return [...cols].filter((col) => JSON.stringify(actual[col]) !== JSON.stringify(expected[col]));
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

// Midday keeps every start-of-today-derived timestamp inside one calendar day.
const NOW = new Date(2026, 8, 30, 12, 0, 0).getTime();

async function main() {
  const expected = buildSeed(NOW);

  // ── the demo path, exactly as first launch runs it ────────────────────────
  const db = new DatabaseSync(':memory:');
  db.exec(BOOTSTRAP_SQL);
  await seedIfEmpty(shim(db) as unknown as SeedHandle, { now: NOW, demo: true });

  check(
    'row counts equal buildSeed',
    [
      count(db, 'trips'),
      count(db, 'passenger_transactions'),
      count(db, 'municipalities'),
      count(db, 'terminals'),
    ],
    [
      expected.trips.length,
      expected.tickets.length,
      expected.municipalities.length,
      expected.terminals.length,
    ],
  );

  const dbTrips = db.prepare('SELECT * FROM trips ORDER BY id').all() as Record<string, unknown>[];
  const tripMismatches = dbTrips.flatMap((row, i) =>
    rowDiff(row, expected.trips[i] as unknown as Record<string, unknown>),
  );
  check('every stored trip equals buildSeed’s, field for field', tripMismatches, []);

  const dbTickets = db
    .prepare('SELECT * FROM passenger_transactions ORDER BY id')
    .all() as Record<string, unknown>[];
  const ticketMismatches = dbTickets.flatMap((row, i) =>
    rowDiff(row, expected.tickets[i] as unknown as Record<string, unknown>),
  );
  check('every stored fare equals buildSeed’s, field for field', ticketMismatches, []);

  // The distance invariant, read back from the DATABASE rather than from the
  // builder: markers are the registry, and the stored route must be theirs.
  check(
    'every stored distance is the difference of its two KM markers',
    dbTrips.every(
      (row) =>
        row.distance_km_milli ===
        seedDistanceMilli(
          row.origin_location_snapshot as string,
          row.destination_location_snapshot as string,
        ),
    ),
    true,
  );

  // The fare invariant, recomputed from the DATABASE's own rows: distance,
  // road, type and quantity in, the stored peso out — the chain the app's
  // Add-ticket screen walks on every boarding.
  const tripsById = new Map(dbTrips.map((row) => [row.id as number, row]));
  check(
    'every stored fare re-derives through priceTicket from the seeded rules',
    dbTickets.every((row) => {
      const trip = tripsById.get(row.trip_id as number);
      if (!trip) return false;
      const priced = priceTicket({
        distanceMilli: trip.distance_km_milli as number,
        usesExpressWay: (trip.uses_sctex as number) === 1,
        passengerType: row.passenger_type as 'REGULAR',
        quantity: row.passenger_quantity as number,
        rules: seedRules(),
      });
      return (
        priced !== null &&
        priced.perPassengerCentavos === row.final_fare_per_passenger &&
        priced.totalCentavos === row.total_fare
      );
    }),
    true,
  );
  check(
    'every total is fare × quantity',
    dbTickets.every(
      (row) =>
        row.total_fare ===
        (row.final_fare_per_passenger as number) * (row.passenger_quantity as number),
    ),
    true,
  );
  check(
    'exactly one trip is running',
    dbTrips.filter((row) => row.status === 'ACTIVE').length,
    1,
  );

  // Configuration the seeded fares were priced from.
  const fareRow = db.prepare('SELECT * FROM fare_configuration WHERE id = 1').get() as
    | Record<string, unknown>
    | undefined;
  check(
    'fare configuration equals SEED_FARE and is stamped with the seed clock',
    fareRow
      ? {
          matches: Object.entries(SEED_FARE).every(
            ([key, value]) => fareRow[key] === (value as unknown),
          ),
          created_at: fareRow.created_at,
        }
      : null,
    { matches: true, created_at: NOW },
  );
  const sctexRow = db.prepare('SELECT * FROM sctex_fare_configuration WHERE id = 1').get() as
    | { km_adjustment_milli: number }
    | undefined;
  check('sctex row equals SEED_SCTEX', sctexRow?.km_adjustment_milli, SEED_SCTEX.km_adjustment_milli);
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get() as
    | { value: string }
    | undefined;
  check('meta stamped SEEDED_VERSION', meta?.value, SEEDED_VERSION);

  // The guard itself: a stamped database is never seeded twice.
  const before = JSON.stringify(db.prepare('SELECT * FROM passenger_transactions ORDER BY id').all());
  await seedIfEmpty(shim(db) as unknown as SeedHandle, { now: NOW + 3_600_000, demo: true });
  const after = JSON.stringify(db.prepare('SELECT * FROM passenger_transactions ORDER BY id').all());
  check('a second seed on a stamped database writes nothing', after, before);

  // ── the release path: stamp only, no records ──────────────────────────────
  const release = new DatabaseSync(':memory:');
  release.exec(BOOTSTRAP_SQL);
  await seedIfEmpty(shim(release) as unknown as SeedHandle, { demo: false });
  check(
    'release seed writes no records at all',
    [
      count(release, 'trips'),
      count(release, 'passenger_transactions'),
      count(release, 'municipalities'),
      count(release, 'terminals'),
      count(release, 'fare_configuration'),
    ],
    [0, 0, 0, 0, 0],
  );
  const releaseMeta = release
    .prepare("SELECT value FROM meta WHERE key = 'seeded'")
    .get() as { value: string } | undefined;
  check('release seed still stamps the version', releaseMeta?.value, SEEDED_VERSION);

  console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
