import * as SQLite from 'expo-sqlite';

/**
 * The fare configuration store.
 *
 * Two purpose-built tables in the shared `kondukt.db`, created additively —
 * the existing schema is untouched, and this module opens the same database
 * handle the other stores share (`getDefaultDatabase`), so there is no second
 * connection and no migration of existing tables.
 *
 * Shapes mirror the original Kotlin schema:
 * - `fare_configuration`: the singleton fare row (fixed id 1).
 * - `sctex_fare_configuration`: the singleton SCTEX row (fixed id 1), carrying
 *   the KM adjustment.
 *
 * Money is integer centavos, distances integer thousandths of a km, discounts
 * integer hundredths of a percentage point — the scales the fare calculator
 * reads. Conversions live in `fareFormat`, never here.
 *
 * The save is one transaction: both rows commit or neither does, so a failure
 * can never leave a half-applied configuration that reports success.
 */

import { getDefaultDatabase } from './tripTicketsStore';
import {
  FARE_CONFIGURATION_TABLE_SQL,
  SCTEX_CONFIGURATION_TABLE_SQL,
} from '../lib/storeSchema';

const FARE_ID = 1;
const SCTEX_ID = 1;

let tablesReady: Promise<void> | null = null;

/**
 * The four columns the express-way naming and the discounted 2x2 brought.
 *
 * **The express rate IS the SCTEX rate** — they are the same road and the same
 * charge, so the app says "express way" and never "SCTEX". The stored column was
 * `express_rate_per_km`; it is copied into `express_rate_per_km` and no longer
 * read. The old column is left in place rather than dropped: a rename that
 * destroys a column is not reversible, and a dead column costs nothing while a
 * dropped one costs a device its configuration.
 *
 * The three discounted columns give the discounted side the same 2x2 the
 * ordinary side already had. `special_express_rate_per_km` is the only one the
 * calculator reads; the two Deluxe ones are stored and charged from nowhere, and
 * the screen says so in the note under the grid.
 */
const ADDED_COLUMNS = [
  'express_rate_per_km',
  'express_deluxe_rate_per_km',
  'special_express_rate_per_km',
  'special_deluxe_rate_per_km',
  'special_express_deluxe_rate_per_km',
] as const;

/** Where a missing added column is copied from, in migration order. */
const EXPRESS_RATE_SOURCE: Record<string, string> = {
  express_rate_per_km: 'express_rate_per_km',
  express_deluxe_rate_per_km: 'express_deluxe_rate_per_km',
  special_express_rate_per_km: 'special_rate_per_km',
  special_deluxe_rate_per_km: 'special_rate_per_km',
  special_express_deluxe_rate_per_km: 'special_rate_per_km',
};

/**
 * Adds the express-way and discounted columns to a database created before them.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so a device that
 * installed an earlier build would never get them and every read would fail on
 * the missing column. `ALTER TABLE ADD COLUMN` in turn throws if the column is
 * already there, so the presence check is not optional.
 *
 * Each new column is seeded from the column it replaces or generalises, never
 * left at its default. Zero is the one value that must never reach a rate: a
 * fare priced at ₱0.00 is a real charge to a real passenger, and defaulting
 * would hand every existing device one the moment it next saved.
 *
 * **This never rejects.** It is single-flight, so two screens reading at once
 * cannot race a duplicate-column `ALTER`, and it is re-attempted on every read
 * so a transient failure heals on its own. A failed migration means the new
 * columns are absent for now, which the readers already tolerate — it must not
 * mean the configuration cannot be read at all.
 *
 * Returns whether the columns are in place, so a write can refuse honestly
 * rather than failing part-way through a transaction.
 */
let columnsReady: Promise<boolean> | null = null;
function ensureAddedColumns(db: SQLite.SQLiteDatabase): Promise<boolean> {
  columnsReady ??= (async () => {
    const columns = await db.getAllAsync<{ name: string }>(
      'PRAGMA table_info(fare_configuration)',
    );
    // No column list means the schema could not be read — the in-memory browser
    // preview answers every unrecognised query with an empty array. Guessing
    // would issue five no-op ALTERs per read; there is nothing to migrate there.
    if (!Array.isArray(columns) || columns.length === 0) return true;
    const present = new Set(
      columns.map((column) => column?.name).filter((name): name is string => !!name),
    );
    for (const name of ADDED_COLUMNS) {
      if (present.has(name)) continue;
      await db.runAsync(
        `ALTER TABLE fare_configuration ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`,
      );
      const source = EXPRESS_RATE_SOURCE[name];
      if (source && present.has(source)) {
        await db.runAsync(
          `UPDATE fare_configuration SET ${name} = ${source} WHERE ${name} = 0`,
        );
      }
    }
    return true;
  })()
    .then((landed) => {
      columnsReady = null;
      return landed;
    })
    .catch((error: unknown) => {
      columnsReady = null;
      console.warn('[fareStore] column migration did not land:', error);
      return false;
    });
  return columnsReady;
}

/**
 * Creates the two configuration tables once per process, additively.
 *
 * **The column migration is not awaited here.** A schema change must never be
 * able to turn a screen into an error branch: it used to run inside this
 * promise, so any failure in it rejected the whole thing, the rejection was
 * cached for the life of the process, and every later read of this table failed
 * too — the Fare Configuration screen showed "saved fares unavailable" and could
 * not recover. The migration is now best-effort and re-attempts on every read,
 * so a transient failure costs a device the new columns for a moment instead of
 * costing it the screen permanently. Readers tolerate the missing columns.
 *
 * A failed CREATE is also not cached: the promise is cleared so the next call
 * tries again rather than replaying the same rejection forever.
 *
 * **One statement per `runAsync`, never `execAsync`.** `getDefaultDatabase`
 * hands back a hand-written in-memory backend when the native module does not
 * come up — the browser preview, where the sqlite wasm backend never resolves.
 * That backend implements `runAsync` and does not implement `execAsync`, so a
 * multi-statement `execAsync` here threw `db.execAsync is not a function` and
 * put this screen on its "configuration could not be read" branch in every
 * browser. `runAsync` works on both, and the shim answers an unrecognised
 * statement with `changes: 0`, so a CREATE is a harmless no-op there.
 */
function ensureTables(db: SQLite.SQLiteDatabase): Promise<void> {
  tablesReady ??= (async () => {
    // The DDL itself lives in `storeSchema`, beside the rest of the schema: the
    // store's seed writes the first configuration row, so it has to be able to
    // create these tables before this module is ever read.
    await db.runAsync(FARE_CONFIGURATION_TABLE_SQL);
    await db.runAsync(SCTEX_CONFIGURATION_TABLE_SQL);
  })().catch((error: unknown) => {
    tablesReady = null;
    throw error;
  });
  return tablesReady;
}

export type FareConfigurationRow = {
  minimum_fare: number;
  minimum_distance_milli: number;
  rate_per_km: number;
  deluxe_rate_per_km: number;
  special_rate_per_km: number;
  /**
   * No reader anywhere in the app. Kept on the row so an existing device's data
   * survives a save; the Fare Configuration screen does not offer them, because a
   * percentage that can never change a fare is not a value to ask a conductor
   * for.
   */
  deluxe_discount_bp: number;
  sctex_discount_bp: number;
  /**
   * What the app used to call `express_rate_per_km`. Same road, same charge.
   *
   * Optional because the column migration is best-effort: a device whose
   * database predates it may not have the column yet, and a reader that claimed
   * a number for a column that is not there would be reporting something the
   * device does not hold.
   */
  express_rate_per_km: number | undefined;
  express_deluxe_rate_per_km: number | undefined;
  /**
   * The three columns the discounted 2x2 added. Only `special_express_rate_per_km`
   * is read by the calculator; the two Deluxe ones are stored and charged from
   * nowhere, which the screen's note says.
   */
  special_express_rate_per_km: number | undefined;
  special_deluxe_rate_per_km: number | undefined;
  special_express_deluxe_rate_per_km: number | undefined;
  created_at: number;
  updated_at: number;
};

export type SctexConfigurationRow = {
  km_adjustment_milli: number;
  created_at: number;
  updated_at: number;
};

export type FareReadResult = {
  fare: FareConfigurationRow | null;
  sctex: SctexConfigurationRow | null;
};

/** Reads both configuration rows. Null means the row does not exist yet. */
export async function fetchFareConfiguration(): Promise<FareReadResult> {
  const db = await getDefaultDatabase();
  await ensureTables(db);
  // Best-effort, and never awaited into the read: `SELECT *` does not care
  // whether the added columns are there yet, and a device whose migration has
  // not landed should still show its configuration rather than an error branch.
  await ensureAddedColumns(db);
  const fare = await db.getFirstAsync<FareConfigurationRow>(
    'SELECT * FROM fare_configuration WHERE id = ?',
    FARE_ID,
  );
  const sctex = await db.getFirstAsync<SctexConfigurationRow>(
    'SELECT * FROM sctex_fare_configuration WHERE id = ?',
    SCTEX_ID,
  );
  return { fare: fare ?? null, sctex: sctex ?? null };
}

/**
 * What a save writes: the ten values the Fare Configuration screen owns.
 *
 * Three columns are deliberately absent — `deluxe_discount_bp`,
 * `sctex_discount_bp` and `sctex_fare_configuration`'s `km_adjustment_milli`.
 * The form no longer offers them, so a save must not write them.
 */
export type FareWriteInput = {
  minimum_fare: number;
  minimum_distance_milli: number;
  rate_per_km: number;
  deluxe_rate_per_km: number;
  special_rate_per_km: number;
  express_rate_per_km: number;
  express_deluxe_rate_per_km: number;
  special_express_rate_per_km: number;
  special_deluxe_rate_per_km: number;
  special_express_deluxe_rate_per_km: number;
};

/** The ten columns, in the order both statements name them. */
const WRITTEN_COLUMNS = [
  'minimum_fare',
  'minimum_distance_milli',
  'rate_per_km',
  'deluxe_rate_per_km',
  'special_rate_per_km',
  'express_rate_per_km',
  'express_deluxe_rate_per_km',
  'special_express_rate_per_km',
  'special_deluxe_rate_per_km',
  'special_express_deluxe_rate_per_km',
] as const;

const writtenValues = (input: FareWriteInput) =>
  WRITTEN_COLUMNS.map((column) => input[column]);

/**
 * Writes the fare row as one logical save, inside one transaction.
 *
 * **The update is narrower than the table.** It names exactly the ten columns
 * the form owns and mentions the other three nowhere. The two percent columns
 * and the km adjustment are no longer on the form, so a screen that still wrote
 * them would write zeros for values it never showed — and since fare math adds
 * no toll-road adjustment on any road, the adjustment column applies to
 * nothing and must never be disturbed by an unrelated save. A field the form
 * dropped is left exactly as the device last set it.
 *
 * The km adjustment's own row is created once, at zero, and never written
 * again: there is no longer anywhere in the app to set it, so a device that has
 * one keeps the value it had and a fresh device has none.
 *
 * Creation timestamps are preserved: an INSERT seeds `created_at`, an UPDATE
 * touches only `updated_at` — never the row's birthday. The boolean result
 * distinguishes a committed save from a failed one so the screen can keep the
 * form dirty.
 */
export async function saveFareConfiguration(input: FareWriteInput): Promise<boolean> {
  const db = await getDefaultDatabase();
  await ensureTables(db);
  // The write names the express-way columns, so it cannot run until they exist.
  // Refuse here rather than letting the statement fail inside the transaction
  // and be reported as a storage fault the conductor did not cause.
  if (!(await ensureAddedColumns(db))) return false;
  const now = Date.now();
  try {
    let committed = false;
    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<{ id: number }>(
        'SELECT id FROM fare_configuration WHERE id = ?',
        FARE_ID,
      );
      const values = writtenValues(input);
      if (existing) {
        await db.runAsync(
          `UPDATE fare_configuration SET
            ${WRITTEN_COLUMNS.map((column) => `${column} = ?`).join(', ')},
            updated_at = ?
          WHERE id = ?`,
          ...values,
          now,
          FARE_ID,
        );
      } else {
        // A fresh device has no row at all, so the columns the form dropped are
        // created with it. Zero is right here and nowhere else: there is no
        // prior value to preserve, and nothing is being charged from a table
        // that has never held a configuration.
        await db.runAsync(
          `INSERT INTO fare_configuration (
            ${WRITTEN_COLUMNS.join(', ')}, deluxe_discount_bp, sctex_discount_bp,
            created_at, updated_at
          ) VALUES (${WRITTEN_COLUMNS.map(() => '?').join(', ')}, 0, 0, ?, ?)`,
          FARE_ID,
          ...values,
          now,
          now,
        );
      }

      const hasAdjustment = await db.getFirstAsync<{ id: number }>(
        'SELECT id FROM sctex_fare_configuration WHERE id = ?',
        SCTEX_ID,
      );
      if (!hasAdjustment) {
        await db.runAsync(
          'INSERT INTO sctex_fare_configuration (id, km_adjustment_milli, created_at, updated_at) VALUES (?, 0, ?, ?)',
          SCTEX_ID,
          now,
          now,
        );
      }
      committed = true;
    });
    return committed;
  } catch {
    return false;
  }
}

/**
 * The live subscription. Configuration writes run through the shared handle,
 * so the store's existing change notification covers them — re-exported here
 * under the config store's name so the screen reads one import.
 */
export { subscribeToTrips as subscribeToFareStore } from './tripTicketsStore';
