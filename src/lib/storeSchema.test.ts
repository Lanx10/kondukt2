/// <reference types="node" />
// The reference above is this file's own: the project's tsconfig extends
// `expo/tsconfig.base`, whose `customConditions` keep `@types/node` out of the
// automatic type-library inclusion, and this is the one test that drives a real
// SQLite engine (`node:sqlite`) instead of a mock.
import { DatabaseSync } from 'node:sqlite';
import {
  BOOTSTRAP_SQL,
  MUNICIPALITIES_TABLE_SQL,
  SEEDED_VERSION,
  addColumnStatement,
  upgradeStatements,
} from './storeSchema';

/**
 * Self-check for the store's schema versioning, run against a real SQLite
 * engine (`node:sqlite`), not a mock.
 *
 * Run with: npx tsx src/lib/storeSchema.test.ts
 *
 * The bug this suite exists for: the first launch created `trips` WITH
 * `uses_sctex` and stamped the database `v4`, so the second launch applied the
 * `v5` step — `ALTER TABLE trips ADD COLUMN uses_sctex` — against a table that
 * already had the column. SQLite refuses a duplicate column, the seed threw,
 * `openDatabase` cached the rejection, and every later read in the process
 * failed: on a device that is "the app is broken and my trips are gone" from
 * the second launch onward.
 *
 * So the two things tested here are the two that were wrong:
 *  1. A database bootstrapped from `BOOTSTRAP_SQL` and stamped `SEEDED_VERSION`
 *     must plan NO statements (nothing left to migrate) — the stamp and the
 *     schema cannot disagree.
 *  2. A device already stamped `v4` (the broken build's state) must plan no
 *     `ALTER` for a column it already has, and the plan must EXECUTE cleanly.
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
function checkDoesNotThrow(name: string, run: () => void) {
  try {
    run();
    console.log(`pass  ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}\n        threw ${(error as Error).message}`);
  }
}

/** A database built by the same statement the first launch runs. */
function bootstrapped() {
  const db = new DatabaseSync(':memory:');
  db.exec(BOOTSTRAP_SQL);
  return db;
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (row) => row.name,
  );
}

function stamp(db: DatabaseSync, version: string) {
  db.exec("INSERT INTO meta (key, value) VALUES ('seeded', '" + version + "')");
}

function runAll(db: DatabaseSync, statements: string[]) {
  for (const statement of statements) db.exec(statement);
}

// ── 1. A freshly bootstrapped database has nothing left to migrate ──────────
{
  const db = bootstrapped();
  const columns = { trips: columnsOf(db, 'trips'), terminals: columnsOf(db, 'terminals') };
  check('bootstrap creates uses_sctex itself', columns.trips.includes('uses_sctex'), true);
  check('bootstrap links terminals to municipalities', columns.terminals.includes('municipality_id'), true);
  check('bootstrap splits the two registries', columns.terminals.includes('kind'), true);
  check(
    'the version the fresh seed stamps plans no migration',
    upgradeStatements({ seeded: SEEDED_VERSION, columns }),
    [],
  );
  check('bootstrap is repeatable', (() => {
    db.exec(BOOTSTRAP_SQL);
    return true;
  })(), true);
}

// ── 2. The regression: a database stamped 'v4' by the broken build ─────────
{
  const db = bootstrapped(); // it already has uses_sctex, yet claims v4
  stamp(db, 'v4');
  const columns = { trips: columnsOf(db, 'trips'), terminals: columnsOf(db, 'terminals') };
  const plan = upgradeStatements({ seeded: 'v4', columns });
  check('no ALTER for a column that is already there', plan.some((s) => /ALTER TABLE trips/.test(s)), false);
  check('the plan only restamps the version', plan.length, 1);
  checkDoesNotThrow('the plan runs on a v4-stamped database', () => runAll(db, plan));
  check(
    'and the database then reads as current',
    db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get(),
    { value: SEEDED_VERSION },
  );
  check(
    'so a third launch plans nothing',
    upgradeStatements({ seeded: SEEDED_VERSION, columns }),
    [],
  );
}

// ── 3. A genuine v3 database still upgrades ────────────────────────────────
{
  const db = new DatabaseSync(':memory:');
  db.exec(BOOTSTRAP_SQL);
  // Roll it back to the v3 shape: no road column, no municipality link, no
  // municipalities table (v3 created terminals but not the grouping).
  db.exec('DROP TABLE terminals');
  db.exec('DROP TABLE municipalities');
  db.exec(`CREATE TABLE terminals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    km_marker INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  )`);
  db.exec('DROP TABLE trips');
  db.exec(`CREATE TABLE trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_number TEXT NOT NULL,
    origin_location_snapshot TEXT NOT NULL,
    destination_location_snapshot TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    distance_km_milli INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED'))
  )`);

  const columns = { trips: columnsOf(db, 'trips'), terminals: columnsOf(db, 'terminals') };
  const plan = upgradeStatements({ seeded: 'v3', columns });
  check('a v3 device gets the grouping table', plan[0], MUNICIPALITIES_TABLE_SQL);
  check('a v3 device gets the terminal link', plan.some((s) => /ALTER TABLE terminals/.test(s)), true);
  check('a v3 device gets the road column', plan.some((s) => /ALTER TABLE trips ADD COLUMN uses_sctex/.test(s)), true);
  checkDoesNotThrow('the v3 plan runs', () => runAll(db, plan));
  check(
    'the upgraded terminal table reads back with its link',
    columnsOf(db, 'terminals').includes('municipality_id'),
    true,
  );
  check(
    'an upgraded v3 database plans nothing on the next launch',
    upgradeStatements({
      seeded: SEEDED_VERSION,
      columns: { trips: columnsOf(db, 'trips'), terminals: columnsOf(db, 'terminals') },
    }),
    [],
  );
}

// ── 4. A half-migrated v3 device (municipalities already there) ────────────
{
  const db = new DatabaseSync(':memory:');
  db.exec(BOOTSTRAP_SQL);
  db.exec('DROP TABLE terminals');
  db.exec(`CREATE TABLE terminals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    km_marker INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  )`);
  const plan = upgradeStatements({
    seeded: 'v3',
    columns: { trips: columnsOf(db, 'trips'), terminals: columnsOf(db, 'terminals') },
  });
  // The plan is a function of the LIVE schema, so a database that already has
  // the grouping table (an earlier attempt that got that far) is only asked
  // for what it is missing — and re-planning after a run asks for nothing.
  checkDoesNotThrow('a half-migrated v3 database runs its plan', () => runAll(db, plan));
  const replan = upgradeStatements({
    seeded: 'v3', // never restamped because the plan was interrupted
    columns: { trips: columnsOf(db, 'trips'), terminals: columnsOf(db, 'terminals') },
  });
  check('re-planning asks for no duplicate column', replan.some((s) => /ALTER TABLE/.test(s)), false);
  checkDoesNotThrow('and the re-plan runs cleanly', () => runAll(db, replan));
}

// ── 5. A device stamped 'v5' gains the registry column ─────────────────────
{
  const db = bootstrapped();
  // Roll it back to the v5 shape: the stop registry with no discriminator, so
  // Terminal Configuration and Barangay Configuration read the same rows.
  db.exec('DROP TABLE terminals');
  db.exec(`CREATE TABLE terminals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    km_marker INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    municipality_id INTEGER REFERENCES municipalities(id)
  )`);
  // Unlinked, exactly like the seed's own Subic row: the assertion below is
  // about the new column, not the link.
  db.exec(
    `INSERT INTO terminals (name, km_marker, is_active, municipality_id)
     VALUES ('Iba, Zambales', 96800, 1, NULL)`,
  );
  stamp(db, 'v5');

  const columns = { trips: columnsOf(db, 'trips'), terminals: columnsOf(db, 'terminals') };
  const plan = upgradeStatements({ seeded: 'v5', columns });
  check(
    'a v5 device gets the registry column',
    plan.some((s) => /ALTER TABLE terminals ADD COLUMN kind/.test(s)),
    true,
  );
  check('and only the column and the restamp', plan.length, 2);
  checkDoesNotThrow('the v5 plan runs', () => runAll(db, plan));
  check(
    'the rows it already holds are filed as barangays',
    db.prepare('SELECT kind FROM terminals').get(),
    { kind: 'BARANGAY' },
  );
  check(
    'a fourth launch plans nothing',
    upgradeStatements({
      seeded: SEEDED_VERSION,
      columns: { trips: columnsOf(db, 'trips'), terminals: columnsOf(db, 'terminals') },
    }),
    [],
  );
}

// ── 6. The planner's one primitive ─────────────────────────────────────────
check('a missing column gets an ALTER', addColumnStatement('trips', 'uses_sctex', 'INTEGER NOT NULL DEFAULT 0', ['id']), 'ALTER TABLE trips ADD COLUMN uses_sctex INTEGER NOT NULL DEFAULT 0');
check('a present column gets nothing', addColumnStatement('trips', 'uses_sctex', 'INTEGER NOT NULL DEFAULT 0', ['id', 'uses_sctex']), null);

// ── 7. Unknown / unstamped databases are the caller's rebuild case ─────────
check('an unstamped database plans nothing here', upgradeStatements({ seeded: null, columns: { trips: [], terminals: [] } }), []);
check('a v1 database plans nothing here', upgradeStatements({ seeded: 'v1', columns: { trips: [], terminals: [] } }), []);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
