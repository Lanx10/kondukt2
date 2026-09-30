/**
 * The store's schema version, its bootstrap DDL, and the statements that bring
 * an older database up to it.
 *
 * Pure — no `expo-sqlite`, no React — for one reason: this is where the store
 * went wrong, and a pure module is the only version of it plain `tsx` can test
 * against a real SQLite engine (`storeSchema.test.ts` runs the statements
 * below on a genuine database).
 *
 * ── The defect this file exists to make impossible ─────────────────────────
 * The bootstrap used to create `trips` **with** `uses_sctex`, then stamp the
 * fresh database `v4` — the version *before* that column — in a literal
 * written at the end of the seed. The next launch read `v4` and applied the
 * `v5` step, an `ALTER TABLE trips ADD COLUMN uses_sctex` against a table that
 * already had it. SQLite rejects a duplicate column, the seed threw, and
 * because `openDatabase` caches its promise the rejection was shared by every
 * later caller: **the whole app failed to read any record from its second
 * launch onward**, which on a device looks exactly like losing every trip.
 *
 * Two rules close it, and both are structural rather than a corrected literal:
 *
 *  1. `SEEDED_VERSION` is the single version literal, and the fresh seed
 *     writes THIS constant — a database can no longer be stamped behind the
 *     schema it was just built with.
 *  2. Every migration step is **idempotent against the live schema**: it reads
 *     the table's actual columns and emits an `ALTER` only for a column that is
 *     genuinely missing. A device already stamped `v4` — every install of the
 *     broken build — now heals instead of aborting, and a re-run can never
 *     duplicate.
 */

/** The version a database carries once it matches the schema below exactly. */
export const SEEDED_VERSION = 'v5';

/**
 * The tables, in creation order: `municipalities` before `terminals`, because
 * the terminal row's link references it.
 *
 * These are the same bytes the first launch runs and the same bytes a rebuilt
 * database is recreated from, so there is exactly one definition of the schema
 * in the app.
 */
export const TRIPS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_number TEXT NOT NULL,
  origin_location_snapshot TEXT NOT NULL,
  destination_location_snapshot TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  distance_km_milli INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED')),
  uses_sctex INTEGER NOT NULL DEFAULT 0
)`;

export const PASSENGER_TRANSACTIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS passenger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  created_at INTEGER NOT NULL,
  origin_location_snapshot TEXT NOT NULL,
  destination_location_snapshot TEXT NOT NULL,
  passenger_type TEXT NOT NULL
    CHECK (passenger_type IN ('REGULAR', 'STUDENT', 'SENIOR_CITIZEN', 'PWD')),
  passenger_quantity INTEGER NOT NULL,
  final_fare_per_passenger INTEGER NOT NULL,
  total_fare INTEGER NOT NULL
)`;

export const PASSENGER_TRANSACTIONS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_transactions_trip
  ON passenger_transactions (trip_id, created_at DESC, id DESC)`;

export const META_TABLE_SQL = `CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

export const MUNICIPALITIES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS municipalities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  province TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
)`;

export const TERMINALS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS terminals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  km_marker INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  municipality_id INTEGER REFERENCES municipalities(id)
)`;

/**
 * The fare configuration tables.
 *
 * They belong to `fareStore`'s read/write path, and the DDL lives here for the
 * same reason the tables above do: the *seed* writes a configuration row, so
 * the schema that row needs has to exist before the first fare read — and two
 * copies of the same `CREATE TABLE` is how this store drifted in the first
 * place. `fareStore` still owns the additive column migration for devices that
 * installed before the express-way columns existed.
 */
export const FARE_CONFIGURATION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS fare_configuration (
  id INTEGER PRIMARY KEY,
  minimum_fare INTEGER NOT NULL,
  minimum_distance_milli INTEGER NOT NULL,
  rate_per_km INTEGER NOT NULL,
  deluxe_rate_per_km INTEGER NOT NULL,
  special_rate_per_km INTEGER NOT NULL,
  deluxe_discount_bp INTEGER NOT NULL,
  sctex_discount_bp INTEGER NOT NULL,
  express_rate_per_km INTEGER NOT NULL DEFAULT 0,
  express_deluxe_rate_per_km INTEGER NOT NULL DEFAULT 0,
  special_express_rate_per_km INTEGER NOT NULL DEFAULT 0,
  special_deluxe_rate_per_km INTEGER NOT NULL DEFAULT 0,
  special_express_deluxe_rate_per_km INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export const SCTEX_CONFIGURATION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sctex_fare_configuration (
  id INTEGER PRIMARY KEY,
  km_adjustment_milli INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

/** Every statement the first launch runs, in order, as one SQL string. */
export const BOOTSTRAP_SQL = [
  TRIPS_TABLE_SQL,
  PASSENGER_TRANSACTIONS_TABLE_SQL,
  PASSENGER_TRANSACTIONS_INDEX_SQL,
  META_TABLE_SQL,
  MUNICIPALITIES_TABLE_SQL,
  TERMINALS_TABLE_SQL,
  FARE_CONFIGURATION_TABLE_SQL,
  SCTEX_CONFIGURATION_TABLE_SQL,
].join(';\n');

/** The tables a rebuild-from-scratch drops before recreating them. */
export const REBUILT_TABLES = [
  'passenger_transactions',
  'trips',
  'meta',
  'terminals',
  'municipalities',
] as const;

/**
 * `ALTER TABLE … ADD COLUMN …`, or null when the column is already there.
 *
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so the presence check is the
 * caller's: the column list comes from `PRAGMA table_info`. An `ALTER` for a
 * column that exists is not a no-op — it is an error that aborts the whole
 * open — which is precisely the failure this guard removes.
 */
export function addColumnStatement(
  table: string,
  column: string,
  definition: string,
  existingColumns: readonly string[],
): string | null {
  if (existingColumns.includes(column)) return null;
  return `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`;
}

/** Stamps the database as current. Parameter-free so it can be planned purely. */
export function markSeededStatement(version: string = SEEDED_VERSION) {
  return `UPDATE meta SET value = '${version}' WHERE key = 'seeded'`;
}

/** The columns a planner needs, read from the live schema. */
export type SchemaColumns = {
  trips: readonly string[];
  terminals: readonly string[];
};

/**
 * The statements that bring an existing database to `SEEDED_VERSION`, or an
 * empty list when it is already there.
 *
 * Only the two additive versions are migrated: `v1`/`v2` and an unstamped
 * database are rebuilt by the caller from `BOOTSTRAP_SQL` (no user data has
 * ever shipped under them). Everything returned here is safe to run on a
 * database that is partly migrated already, which is the state every device
 * carrying the broken build is in.
 */
export function upgradeStatements(input: {
  seeded: string | null;
  columns: SchemaColumns;
}): string[] {
  const { seeded, columns } = input;
  if (seeded === SEEDED_VERSION) return [];
  if (seeded !== 'v3' && seeded !== 'v4') return [];

  const statements: string[] = [];
  if (seeded === 'v3') {
    // v4: municipalities plus the terminal link column, without touching the
    // trips or ledger tables a device may already carry.
    statements.push(MUNICIPALITIES_TABLE_SQL);
    const link = addColumnStatement(
      'terminals',
      'municipality_id',
      'INTEGER REFERENCES municipalities(id)',
      columns.terminals,
    );
    if (link) statements.push(link);
  }
  // v5: `trips.uses_sctex`, the road the trip was started on. DEFAULT 0 is the
  // honest backfill — a trip stored before this column existed ran on the
  // ordinary road, and inventing an adjustment for it would reprice boardings
  // that were already sold.
  const road = addColumnStatement(
    'trips',
    'uses_sctex',
    'INTEGER NOT NULL DEFAULT 0',
    columns.trips,
  );
  if (road) statements.push(road);
  statements.push(markSeededStatement());
  return statements;
}
