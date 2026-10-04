/// <reference types="node" />
/**
 * The import writers, driven against a REAL SQLite engine.
 *
 * Run with: npx tsx src/data/transferImport.test.ts
 *
 * `transferState.test.ts` proves the file is read and judged correctly. This
 * one proves the WRITING half against the database the app actually ships:
 *
 *   1. A barangay round trip lands every municipality and every stop, with the
 *      stop's link resolved to the id the store assigned and the registered KM
 *      stored to the thousandth.
 *   2. The `kind` discriminator is honoured, so an imported stop cannot leak
 *      into the other Configuration screen's registry.
 *   3. The store's own duplicate rule refuses a second import and says so with
 *      the repository's sentence — the same one `saveTerminal` returns.
 *   4. A deactivated row is restored DEACTIVATED. Restoring it active would
 *      silently put a stop an operator took out of service back on the road.
 *   5. An import NEVER DELETES: rows the device already held are still there
 *      afterwards, which is what makes a restore additive rather than a
 *      destructive replace.
 *
 * `node:sqlite` stands in for `expo-sqlite` through the same shim
 * `seedIfEmpty.test.ts` uses — a real engine, not a mock, because the claims
 * above are about SQL this store executes.
 */
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import type * as SQLite from 'expo-sqlite';
import { BOOTSTRAP_SQL } from '../lib/storeSchema';
import {
  importMunicipalities,
  importStops,
  municipalityKey,
} from './tripTicketsStore';

function shim(db: DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      const info = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(info.changes), lastInsertRowId: Number(info.lastInsertRowid) };
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
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as SQLite.SQLiteDatabase;
}

type StopRow = {
  id: number;
  name: string;
  km_marker: number;
  is_active: number;
  municipality_id: number | null;
  kind: string;
};
type MunicipalityRow = {
  id: number;
  name: string;
  province: string;
  is_active: number;
};

/** The parsed file's municipalities and stops, as the screens hand them over. */
const FILE_MUNICIPALITIES = [
  { name: 'Olongapo City', province: 'Zambales', is_active: 1 as const },
  { name: 'Subic', province: 'Zambales', is_active: 0 as const },
];
const FILE_STOPS = [
  { name: 'Santa Cruz, Olongapo City', km_marker: 232400, is_active: 1 as const },
  { name: 'Sto. Niño, Subic', km_marker: 240000, is_active: 0 as const },
];

async function main() {
  const db = new DatabaseSync(':memory:');
  db.exec(BOOTSTRAP_SQL);
  const handle = shim(db);

  // ── 1 + 2 + 4: a round trip onto an empty device ──────────────────────────
  const municipalities = await importMunicipalities(FILE_MUNICIPALITIES, handle);
  assert.equal(municipalities.failed, false, 'municipalities write reported a failure');
  assert.equal(municipalities.inserted, 2);
  assert.equal(municipalities.skipped.length, 0);

  // The store's own id, looked up by the key the caller writes — never a
  // client-minted one.
  const olongapoId = municipalities.idsByName.get(
    municipalityKey('Olongapo City', 'Zambales'),
  );
  assert.equal(typeof olongapoId, 'number', 'the store assigned an id for the municipality');

  const stops = await importStops(
    [
      { ...FILE_STOPS[0], municipality_id: olongapoId ?? null },
      // The link is resolved BY NAME, so this is the store's id for Subic, not
      // the file's position — the two only agree on a device that imported both
      // registries from the same file.
      {
        ...FILE_STOPS[1],
        municipality_id: municipalities.idsByName.get(municipalityKey('Subic', 'Zambales')) ?? null,
      },
    ],
    'BARANGAY',
    handle,
  );
  assert.equal(stops.failed, false, 'the stops write reported a failure');
  assert.equal(stops.inserted, 2);
  assert.equal(stops.skipped.length, 0);

  const storedStops = db
    .prepare('SELECT * FROM terminals ORDER BY id')
    .all() as unknown as StopRow[];
  assert.equal(storedStops.length, 2);
  assert.equal(
    storedStops[0].km_marker,
    232400,
    'the registered KM is stored to the thousandth, not the one-decimal display',
  );
  assert.equal(storedStops[0].municipality_id, olongapoId, 'the stop links to the stored municipality');
  assert.equal(
    storedStops[0].kind,
    'BARANGAY',
    "the kind discriminator is honoured, so Terminal Configuration cannot list these",
  );
  assert.equal(
    storedStops[1].is_active,
    0,
    'a deactivated row is restored deactivated, not silently put back in service',
  );

  const storedMunicipalities = db
    .prepare('SELECT * FROM municipalities ORDER BY id')
    .all() as unknown as MunicipalityRow[];
  assert.equal(storedMunicipalities[0].province, 'Zambales');
  assert.equal(
    storedMunicipalities[1].is_active,
    0,
    "a deactivated municipality is restored deactivated too",
  );

  // ── 3: the same file again is refused by the store's own rule ─────────────
  const again = await importStops(
    [{ ...FILE_STOPS[0], municipality_id: olongapoId ?? null }],
    'BARANGAY',
    handle,
  );
  assert.equal(again.inserted, 0, 'the duplicate was not inserted');
  assert.equal(again.skipped.length, 1);
  assert.equal(
    again.skipped[0].reason,
    'Santa Cruz is already registered in Olongapo City.',
    'the store names what and where, exactly as saveTerminal does',
  );
  const municipalitiesAgain = await importMunicipalities(FILE_MUNICIPALITIES, handle);
  assert.equal(municipalitiesAgain.inserted, 0);
  assert.equal(
    municipalitiesAgain.skipped[0].reason,
    'Olongapo City is already listed in Zambales.',
  );

  // ── 5: an import is additive — it never deletes ──────────────────────────
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM terminals').get() as { n: number }).n,
    2,
    'the rows the device already held are still there after a refused import',
  );

  // A genuinely new row alongside the duplicates lands, and only that one.
  const partial = await importStops(
    [
      { name: 'Santa Cruz, Olongapo City', km_marker: 232400, is_active: 1, municipality_id: olongapoId ?? null },
      { name: 'Mabini, Olongapo City', km_marker: 235000, is_active: 1, municipality_id: olongapoId ?? null },
    ],
    'BARANGAY',
    handle,
  );
  assert.equal(partial.inserted, 1, 'one new row lands');
  assert.equal(partial.skipped.length, 1, 'and the duplicate beside it is refused, not fatal');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM terminals').get() as { n: number }).n,
    3,
  );

  // ── A terminal import files under TERMINAL, and cannot overwrite a barangay ──
  const terminals = await importStops(
    [
      { name: 'Santa Cruz, Olongapo City', km_marker: 232400, is_active: 1, municipality_id: null },
    ],
    'TERMINAL',
    handle,
  );
  assert.equal(
    terminals.inserted,
    0,
    'a terminal with a barangay’s composed name is the same lower(name) and is refused',
  );

  const terminalOnly = await importStops(
    [{ name: 'Bus Terminal', km_marker: 231000, is_active: 1, municipality_id: null }],
    'TERMINAL',
    handle,
  );
  assert.equal(terminalOnly.inserted, 1);
  const kinds = db
    .prepare('SELECT kind FROM terminals ORDER BY id')
    .all() as unknown as { kind: string }[];
  assert.deepEqual(
    kinds.map((row) => row.kind),
    ['BARANGAY', 'BARANGAY', 'BARANGAY', 'TERMINAL'],
    'each row is filed under the registry that wrote it',
  );

  // ── An empty file is a no-op, not an error ──────────────────────────────────
  const none = await importStops([], 'BARANGAY', handle);
  assert.deepEqual(none, { inserted: 0, skipped: [], failed: false });
  const noMunicipalities = await importMunicipalities([], handle);
  assert.equal(noMunicipalities.inserted, 0);
  assert.equal(noMunicipalities.failed, false);

  // ── A failure reports `failed` and inserts NOTHING ─────────────────────────
  // The screen's contract after a failed municipality write is to stop, not
  // to continue: continuing would write every stop with a null link, because
  // the ids it needs are the ones the failure cost. So the store must not
  // report a partial insert as a success, and it must not leave rows behind.
  const broken = shim(new DatabaseSync(':memory:'));
  const municipalitiesOnBroken = await importMunicipalities(FILE_MUNICIPALITIES, broken);
  assert.equal(municipalitiesOnBroken.failed, true, 'a handle without the tables fails');
  assert.equal(municipalitiesOnBroken.inserted, 0);
  assert.equal(municipalitiesOnBroken.idsByName.size, 0, 'and hands back no ids to link to');

  const stopsOnBroken = await importStops(
    [{ name: 'Santa Cruz, Olongapo City', km_marker: 232400, is_active: 1, municipality_id: null }],
    'BARANGAY',
    broken,
  );
  assert.equal(stopsOnBroken.failed, true);
  assert.equal(stopsOnBroken.inserted, 0);

  console.log('ok — transferImport: round trip, kind discriminator, duplicates, additive writes');
}

void main();
