import type * as SQLite from 'expo-sqlite';
import {
  BOOTSTRAP_SQL,
  REBUILT_TABLES,
  SEEDED_VERSION,
  upgradeStatements,
} from '../lib/storeSchema';
import { SEED_FARE, SEED_SCTEX, buildSeed } from '../lib/seedData';

/**
 * The local SQLite store.
 *
 * Local-first: everything this screen shows lives in `kondukt.db` on the
 * device. No network, no sync, no second source of truth — this module is the
 * data layer and the screen is a presentation layer over it.
 *
 * The database schema is created on first open. Whether any RECORDS arrive
 * with it is decided by `DEMO_DATA_ENABLED` below: development and the web
 * preview get the demo dataset, a release build gets an empty, correctly
 * stamped database — the conductor's real first-use state, with no fabricated
 * trips, tickets, terminals or fare rows to explain. Seeding is guarded by a
 * meta row, not by table contents: an empty ledger is a legitimate state and
 * must not re-seed itself.
 *
 * Writers exist so the real-time contract can be exercised end to end (a ticket
 * saved here repaints every subscriber). `recordTicket` derives `total_fare`
 * from `final_fare_per_passenger × quantity` — money is derived, never
 * authored, the invariant the previous store carried.
 */

const DATABASE_NAME = 'kondukt.db';

/**
 * Whether the demo dataset may be written to storage.
 *
 * `__DEV__` is compiled to `false` by Metro for a release bundle, so an APK
 * built by `assembleRelease` / EAS never reaches the seed path at all — the
 * tables are created and stamped and nothing is inserted. Development builds
 * and the `expo start` preview keep the seeded dataset, which is what the
 * screens, the fixtures and the QA pass are written against.
 *
 * This is deliberately a compile-time constant rather than a setting: the
 * requirement is that a production build *cannot* populate test records, and a
 * runtime flag would be a knob someone can turn on in the wrong build.
 */
const DEMO_DATA_ENABLED: boolean = typeof __DEV__ === 'boolean' ? __DEV__ : false;

/**
 * The native module, loaded on first use rather than at import time.
 *
 * Every runtime touch of `expo-sqlite` goes through this memoized loader, so
 * the module graph itself never pulls the native package — which is what lets
 * plain `tsx` import this store and run the real `seedIfEmpty` against
 * `node:sqlite` (the seed-path suite) while Metro bundles the same dynamic
 * import into the app unchanged.
 */
let sqliteModule: typeof import('expo-sqlite') | null = null;
async function sqlite(): Promise<typeof import('expo-sqlite')> {
  sqliteModule ??= await import('expo-sqlite');
  return sqliteModule;
}

let db: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;
/** Subscribers when running on the memory backend (native module unavailable). */
const memoryListeners = new Set<() => void>();

/**
 * The same shape as `SQLiteDatabase`'s slice this store uses, so the memory
 * fallback can stand in for the native handle. Built once, lazily, only when
 * the native module cannot open the file (e.g. the web dev bundle, whose
 * SQLite wasm backend never settles outside Expo Go / a device build).
 */
function memoryBackend() {
  const state = memorySeed();
  const memory = {
    listeners: memoryListeners as Set<() => void>,
    getFirstAsync: async <T,>(sql: string, params: unknown[]) => {
      if (/WHERE status = 'ACTIVE' LIMIT 1/.test(sql)) {
        const row = state.trips.find((t) => t.status === 'ACTIVE');
        return (row as T) ?? null;
      }
      if (/FROM trips WHERE status/.test(sql)) {
        const row = state.trips.find((t) => t.status === params[0]);
        return (row as T) ?? null;
      }
      if (/FROM trips WHERE id/.test(sql)) {
        const row = state.trips.find((t) => t.id === params[0]);
        return (row as T) ?? null;
      }
      if (/FROM trips ORDER BY started_at DESC/.test(sql)) {
        const row = [...state.trips].sort((a, b) => b.started_at - a.started_at)[0];
        return (row as T) ?? null;
      }
      if (/FROM meta/.test(sql)) return { value: 'v3' } as T;
      if (/COUNT\(\*\) AS n FROM municipalities WHERE lower\(name\)/.test(sql)) {
        const wantedName = String(params[0]).toLowerCase();
        const wantedProvince = String(params[1]).toLowerCase();
        // The UPDATE's own duplicate check binds a third parameter: `id != ?`.
        // Ignoring it made a rename of a record to its own stored pair look
        // like a duplicate of itself — the editor refused the one change that
        // is not one, which is the refusal this rule exists to prevent.
        const excludeId = params.length > 2 && params[2] != null ? Number(params[2]) : null;
        const n = state.municipalities.filter(
          (m) =>
            m.name.toLowerCase() === wantedName &&
            m.province.toLowerCase() === wantedProvince &&
            (excludeId === null || m.id !== excludeId),
        ).length;
        return { n } as T;
      }
      if (/COUNT\(\*\) AS n FROM municipalities WHERE lower\(province\)/.test(sql)) {
        const wantedProvince = String(params[0]).toLowerCase();
        const n = state.municipalities.filter(
          (m) => m.province.toLowerCase() === wantedProvince,
        ).length;
        return { n } as T;
      }
      if (/FROM terminals WHERE id/.test(sql)) {
        const row = state.terminals.find((t) => t.id === params[0]);
        return (row as T) ?? null;
      }
      // The Municipality Editor's edit half reads one row by id. Unhandled it
      // fell through to `null`, which the screen reports as its own not-found
      // outcome — so every Edit on this backend said the record was gone while
      // the list above it still showed the row.
      if (/FROM municipalities WHERE id/.test(sql)) {
        const row = state.municipalities.find((m) => m.id === params[0]);
        return (row as T) ?? null;
      }
      if (/COALESCE\(MAX\(id\), 0\) AS max FROM terminals/.test(sql)) {
        return { max: state.nextTerminalId - 1 } as T;
      }
      if (/COUNT\(\*\) AS n FROM terminals WHERE lower\(name\)/.test(sql)) {
        const wanted = String(params[0]).toLowerCase();
        const excludeId = params.length > 1 ? Number(params[1]) : null;
        const n = state.terminals.filter(
          (t) =>
            t.name.toLowerCase() === wanted && (excludeId === null || t.id !== excludeId),
        ).length;
        return { n } as T;
      }
      if (/COUNT\(\*\) AS n FROM terminals WHERE municipality_id = \? AND is_active = 1/.test(sql)) {
        const n = state.terminals.filter(
          (t) => t.municipality_id === params[0] && t.is_active === 1,
        ).length;
        return { n } as T;
      }
      if (/COALESCE\(MAX\(id\), 0\) AS max FROM trips/.test(sql)) {
        return { max: state.nextTripId - 1 } as T;
      }
      return null;
    },
    getAllAsync: async <T,>(sql: string, params: unknown[]) => {
      if (/FROM passenger_transactions[\s\S]*WHERE created_at >= \? AND created_at < \?/.test(sql)) {
        // Daily earnings: a time window, not a trip id. This used to fall
        // through the trip-id handler below (whose `params[0]` is a timestamp),
        // matched no trip, and left the History earnings tab blank.
        const [from, to] = params as number[];
        return [...state.tickets]
          .filter((p) => p.created_at >= Number(from) && p.created_at < Number(to))
          .sort((a, b) => a.created_at - b.created_at || a.id - b.id) as T[];
      }
      if (/FROM trips ORDER BY COALESCE\(ended_at, started_at\)/.test(sql)) {
        // The Passenger trip picker: every trip, active first by the shared
        // rule. Unhandled, this returned [] and the Passenger screen claimed
        // "No trips on this device" on a database holding six.
        return [...state.trips]
          .sort(
            (a, b) =>
              (b.ended_at ?? b.started_at) - (a.ended_at ?? a.started_at) || b.id - a.id,
          ) as T[];
      }
      if (/FROM passenger_transactions/.test(sql)) {
        // `WHERE trip_id = ?` reads params[0]; the Dashboard's full-ledger
        // read binds nothing and must return every row, not filter on
        // `undefined`.
        const rows = state.tickets
          .filter((t) => params.length === 0 || t.trip_id === params[0])
          .filter((t) => params.length < 3 || params[1] == null || t.passenger_type === params[1])
          .sort((a, b) => b.created_at - a.created_at || b.id - a.id);
        return rows as T[];
      }
      if (/FROM trips(?! ORDER BY)/.test(sql) && !/WHERE/.test(sql)) {
        // Plain `SELECT * FROM trips` — the Dashboard's full read. No window,
        // no status: every trip, ordered by recency so a first page (if the
        // caller slices) is the newest.
        return [...state.trips].sort((a, b) => b.started_at - a.started_at) as T[];
      }
      if (/WHERE status = 'COMPLETED'/.test(sql)) {
        const rows = state.trips
          .filter((t) => t.status === 'COMPLETED')
          .sort(
            (a, b) =>
              (b.ended_at ?? b.started_at) - (a.ended_at ?? a.started_at) || b.id - a.id,
          )
          .slice(0, 10);
        return rows as T[];
      }
      if (/FROM terminals WHERE is_active/.test(sql)) {
        const rows = state.terminals
          .filter((t) => t.is_active === 1)
          .sort((a, b) => a.km_marker - b.km_marker || a.id - b.id);
        return rows as T[];
      }
      // Plain `SELECT * FROM terminals` — the Barangay Configuration, the
      // Terminal Configuration and the Barangay Editor's duplicate check all
      // read through it. Unhandled it fell through to `[]`, which is how the
      // browser preview showed a registry of five seeded stops as empty.
      if (/FROM terminals/.test(sql)) {
        return [...state.terminals] as T[];
      }
      if (/FROM municipalities/.test(sql)) {
        return [...state.municipalities] as T[];
      }
      return [] as T[];
    },
    runAsync: async (sql: string, ...params: unknown[]) => {
      if (/INSERT INTO municipalities/.test(sql)) {
        // The id is this table's next free key — the screen never mints one,
        // and one id has to keep meaning one municipality across reloads.
        const id =
          state.municipalities.reduce((max, row) => Math.max(max, row.id), 0) + 1;
        const row = {
          id,
          name: params[0] as string,
          province: params[1] as string,
          is_active: 1 as const,
        };
        state.municipalities.push(row);
        memory.listeners.forEach((fn) => fn());
        return { changes: 1, lastInsertRowId: id };
      }
      if (/INSERT INTO trips/.test(sql)) {
        const row = {
          id: state.nextTripId++,
          trip_number: params[0] as string,
          origin_location_snapshot: params[1] as string,
          destination_location_snapshot: params[2] as string,
          started_at: params[3] as number,
          ended_at: null,
          distance_km_milli: params[4] as number,
          status: 'ACTIVE' as const,
          uses_sctex: (params[5] as number) ? 1 : 0,
        };
        state.trips.push(row);
        memory.listeners.forEach((fn) => fn());
        return { changes: 1, lastInsertRowId: row.id };
      }
      if (/UPDATE trips SET ended_at/.test(sql)) {
        const row = state.trips.find(
          (t) => t.id === params[1] && t.status === 'ACTIVE',
        );
        if (row) {
          row.ended_at = params[0] as number;
          row.status = 'COMPLETED';
          memory.listeners.forEach((fn) => fn());
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      if (/INSERT INTO passenger_transactions/.test(sql)) {
        state.tickets.push({
          id: state.nextTicketId++,
          trip_id: params[0] as number,
          created_at: params[1] as number,
          origin_location_snapshot: params[2] as string,
          destination_location_snapshot: params[3] as string,
          passenger_type: params[4] as import('./schema').PassengerType,
          passenger_quantity: params[5] as number,
          final_fare_per_passenger: params[6] as number,
          total_fare: params[7] as number,
        });
        memory.listeners.forEach((fn) => fn());
        return { changes: 1 };
      }
      if (/INSERT INTO terminals/.test(sql)) {
        const row = {
          id: state.nextTerminalId++,
          name: params[0] as string,
          km_marker: params[1] as number,
          is_active: (params[2] as 0 | 1) === 1 ? 1 : 0,
          municipality_id: (params[3] as number | null) ?? null,
          // The bind the SQL statement's fifth placeholder carries.
          kind: (params[4] as import('./schema').TerminalKind) ?? 'BARANGAY',
        };
        state.terminals.push(row);
        memory.listeners.forEach((fn) => fn());
        return { changes: 1, lastInsertRowId: row.id };
      }
      if (/UPDATE terminals SET name/.test(sql)) {
        // name, km_marker, is_active, and municipality_id only when the
        // statement carries it — the same conditional the SQL UPDATE uses.
        const hasLink = /municipality_id/.test(sql);
        const id = (hasLink ? params[4] : params[3]) as number;
        const row = state.terminals.find((t) => t.id === id);
        if (!row) return { changes: 0 };
        row.name = params[0] as string;
        row.km_marker = params[1] as number;
        row.is_active = (params[2] as 0 | 1) === 1 ? 1 : 0;
        if (hasLink) row.municipality_id = (params[3] as number | null) ?? null;
        memory.listeners.forEach((fn) => fn());
        return { changes: 1 };
      }
      if (/UPDATE terminals SET is_active = 0/.test(sql)) {
        const row = state.terminals.find((t) => t.id === params[0] && t.is_active === 1);
        if (!row) return { changes: 0 };
        row.is_active = 0;
        memory.listeners.forEach((fn) => fn());
        return { changes: 1 };
      }
      if (/UPDATE municipalities SET name/.test(sql)) {
        // name, province, id — the same bind order the SQL statement uses.
        // Falling through to `{ changes: 0 }` made a successful rename read as
        // `notFound`, so the screen kept the form up and told the driver the
        // record was gone instead of flashing the new name.
        const row = state.municipalities.find((m) => m.id === params[2]);
        if (!row) return { changes: 0 };
        row.name = params[0] as string;
        row.province = params[1] as string;
        memory.listeners.forEach((fn) => fn());
        return { changes: 1 };
      }
      if (/UPDATE municipalities SET is_active = 0/.test(sql)) {
        const row = state.municipalities.find(
          (m) => m.id === params[0] && m.is_active === 1,
        );
        if (!row) return { changes: 0 };
        row.is_active = 0;
        memory.listeners.forEach((fn) => fn());
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    // Pass-through transaction shell: the memory backend has no rollback to
    // promise, but callers that wrap writes in one (startTrip, the municipality
    // deactivation) must not crash on the web preview where this backend runs.
    withTransactionAsync: async (fn: () => Promise<void> | void) => {
      await fn();
    },
  };
  return memory as unknown as SQLite.SQLiteDatabase;
}

/** True when the handle is the memory fallback, not a native connection. */
function isMemoryBackend(handle: SQLite.SQLiteDatabase) {
  return 'listeners' in handle;
}

/**
 * Renumbers every trip 1..N in chronological order when — and only when — a
 * duplicate `trip_number` exists. A no-op on any healthy dataset.
 */
async function repairDuplicateTripNumbers(opened: SQLite.SQLiteDatabase) {
  const dupes = await opened.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM (SELECT trip_number FROM trips GROUP BY trip_number HAVING COUNT(*) > 1)',
  );
  if ((dupes?.n ?? 0) === 0) return;
  const rows = await opened.getAllAsync<{ id: number }>(
    'SELECT id FROM trips ORDER BY started_at, id',
  );
  await opened.withTransactionAsync(async () => {
    for (const [index, row] of rows.entries()) {
      await opened.runAsync('UPDATE trips SET trip_number = ? WHERE id = ?', String(index + 1), row.id);
    }
  });
}

/**
 * In-memory mirror of the SQL seed — the same `buildSeed` rows, same clock,
 * so the fallback and the database describe one dataset rather than two that
 * drift apart.
 */
function memorySeed() {
  const seed = buildSeed(Date.now());
  const maxId = (rows: { id: number }[]) =>
    rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  return {
    trips: seed.trips,
    tickets: seed.tickets,
    nextTicketId: maxId(seed.tickets),
    nextTripId: maxId(seed.trips),
    nextTerminalId: maxId(seed.terminals),
    nextMunicipalityId: maxId(seed.municipalities),
    municipalities: seed.municipalities,
    terminals: seed.terminals,
  };
}

/**
 * The native handle, or null when this platform has no SQLite to offer.
 *
 * Web races the open against a short timeout so the browser preview falls back
 * to the in-memory backend instead of hanging; native awaits the open and lets
 * a genuine failure reject, which the screens surface as "could not read" with
 * a retry rather than papering over it with invented records.
 */
async function openHandle(): Promise<SQLite.SQLiteDatabase | null> {
  // Change events are opt-in: without this flag the update hook is never
  // installed, `onDatabaseChange` never fires, and every subscriber (the trip
  // board, Home totals, Add ticket's fold) freezes at its last read while the
  // write itself succeeds — the record lands, the screen just never hears of it.
  const SQLite = await sqlite();
  const native = SQLite.openDatabaseAsync(DATABASE_NAME, { enableChangeListener: true });
  if (!DEMO_DATA_ENABLED) return native;
  // The race that turns a web hang into the memory fallback. The window used
  // to be 2 seconds; on a cold OPFS/wasm start (fresh browser process, empty
  // caches) the open legitimately takes longer than that, the timeout won,
  // and the abandoned connection kept going — resolving seconds later and
  // holding this file's exclusive OPFS access handles for the life of the
  // page, which locked every later open and stranded the preview on the
  // fallback. A generous window lets a slow-but-healthy open win, and when
  // the timeout does win, the loser is closed on arrival so a fallback
  // session can never hold the file.
  const opened = await Promise.race([
    native,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
  ]);
  if (opened !== null) return opened;
  void native.then(
    (late) => void late.closeAsync().catch(() => {}),
    () => {},
  );
  return null;
}

/** The live column names of the tables the migrations touch. */
async function schemaColumns(
  opened: SQLite.SQLiteDatabase,
): Promise<{ trips: string[]; terminals: string[] }> {
  const columnsOf = async (table: string) => {
    const rows = await opened.getAllAsync<{ name?: string }>(`PRAGMA table_info(${table})`);
    return (rows ?? []).map((row) => row?.name).filter((name): name is string => !!name);
  };
  return {
    trips: await columnsOf('trips'),
    terminals: await columnsOf('terminals'),
  };
}

async function openDatabase() {
  if (db) return db;
  if (!opening) {
    opening = (async () => {
      // The native module never resolves on the web dev bundle (its wasm
      // backend does not initialize outside Expo Go). A timeout converts that
      // hang into a fallback so the screen still renders in a browser preview;
      // on device the open resolves in milliseconds and this path never runs.
      // The timeout that turns a web hang into the memory fallback lives in
      // `openHandle`; on device the open resolves in milliseconds and this path
      // never leaves the native handle.
      const opened = await openHandle();
      if (!opened) return memoryBackend();
      console.log('[db] opened handle');
      // Every table first, from the one module that owns the DDL. The fresh
      // seed writes municipalities and terminals, and the fare screens read the
      // fare configuration, so a first open without them failed on its first
      // INSERT ("no such table: municipalities") and no screen could read a
      // record. `CREATE TABLE IF NOT EXISTS` throughout, so this is safe on a
      // database that already carries them.
      await opened.execAsync(`PRAGMA journal_mode = WAL;\n${BOOTSTRAP_SQL}`);
      await seedIfEmpty(opened);
      db = opened;
      return opened;
    })().catch((error) => {
      // Clear the slot so the next read attempts the open again rather than
      // replaying this rejection forever.
      opening = null;
      throw error;
    });
  }
  return opening;
}

/**
 * Writes the demo dataset into a freshly bootstrapped database — or, on a
 * release build, only the version stamp.
 *
 * `opts` is the seed-path test's handle on the two inputs it must pin: a
 * fixed `now` makes every stored timestamp exactly reproducible against
 * `buildSeed(now)`, and `demo` chooses the insert-or-stamp branch directly
 * instead of through `__DEV__`. Production calls take neither and behave as
 * before.
 */
export async function seedIfEmpty(
  opened: SQLite.SQLiteDatabase,
  opts?: { now?: number; demo?: boolean },
) {
  const demo = opts?.demo ?? DEMO_DATA_ENABLED;
  const nowMs = opts?.now ?? Date.now();
  const seeded = await opened.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    'seeded',
  );
  // v2 added `trip_number`. A v1 database is rebuilt rather than migrated:
  // this store has no real user data yet (the app has never shipped), and
  // backfilling display numbers onto old rows would invent history.
  // v3 adds `terminals` (Add-trip reads its route options from here); the same
  // rebuild rule applies — terminal rows belong to the Settings screen that
  // has not shipped, so nothing real is lost.
  if (seeded?.value === SEEDED_VERSION) {
    // Demo datasets written before the numbering fix carry duplicates the old
    // `MAX(id) + 1` rule minted (the seed rows already used 6, 5 and 4), and
    // trip_number is what History prints and searches by. One-time cleanup,
    // demo builds only — production never seeds, and the generation rule can
    // no longer collide, so shipped rows are never rewritten.
    if (demo) await repairDuplicateTripNumbers(opened);
    return;
  }
  if (seeded?.value === 'v3' || seeded?.value === 'v4' || seeded?.value === 'v5') {
    // Additive, and every statement is planned against the columns the file
    // actually has (`storeSchema.test.ts` runs this plan on a real SQLite).
    const columns = await schemaColumns(opened);
    console.log('[db] migrate from', seeded.value, JSON.stringify(columns));
    const plan = upgradeStatements({ seeded: seeded.value, columns });
    console.log('[db] plan', JSON.stringify(plan));
    for (const statement of plan) {
      await opened.execAsync(statement);
      console.log('[db] ran', statement.slice(0, 48));
    }
    console.log('[db] migrate done');
    return;
  }

  // ── RELEASE BUILD ─────────────────────────────────────────────
  //
  // Nothing below may run in a shipping app. The demo dataset belongs to
  // development and the preview; a production install must open on the app's
  // own empty/first-use state, and the rebuild branch is destructive by design
  // (it DROPs tables to re-create them) — correct only where there is no user
  // data to lose, which a released build can no longer promise.
  //
  // v3/v4 were migrated additively above, which leaves their records alone. An
  // unstamped database on this path is the fresh install just created by
  // `BOOTSTRAP_SQL`, so the current stamp is the whole of its migration and no
  // row is inserted. v1/v2 are left exactly as they are rather than stamped
  // current behind a schema that was never verified.
  if (!demo) {
    if (!seeded) {
      await opened.runAsync(
        'INSERT INTO meta (key, value) VALUES (?, ?)',
        'seeded',
        SEEDED_VERSION,
      );
    }
    return;
  }
  if (seeded) {
    await opened.execAsync(
      REBUILT_TABLES.map((table) => `DROP TABLE IF EXISTS ${table}`).join('; ') + ';',
    );
    // The dropped tables take the schema with them; recreate from the same
    // module the first launch used, so a rebuilt database cannot describe a
    // different schema than a fresh one.
    await opened.execAsync(BOOTSTRAP_SQL);
  }

  // Relative to load time, not fixed timestamps — the same rule the previous
  // in-memory seed used, so a fresh install always has a live trip in today's
  // window and records under it. `buildSeed` is the whole dataset and the only
  // one: the in-memory backend hands the same rows to its store, so the two
  // seeds cannot drift apart (they once did — a 4.4 km route stored as 12.6 km,
  // fares no configuration on the device could produce).
  const seed = buildSeed(nowMs);

  await opened.withTransactionAsync(async () => {
    // Explicit ids from the builder: trips reference municipalities and
    // terminals, tickets reference trips, and the dense ids are what the
    // relationships are keyed by.
    for (const row of seed.municipalities) {
      await opened.runAsync(
        'INSERT INTO municipalities (id, name, province, is_active) VALUES (?, ?, ?, ?)',
        row.id,
        row.name,
        row.province,
        row.is_active,
      );
    }
    for (const row of seed.terminals) {
      await opened.runAsync(
        'INSERT INTO terminals (id, name, km_marker, is_active, municipality_id, kind) VALUES (?, ?, ?, ?, ?, ?)',
        row.id,
        row.name,
        row.km_marker,
        row.is_active,
        row.municipality_id,
        // The seed's stops are route endpoints, so they are filed as
        // terminals rather than taking the column default — otherwise the
        // demo dataset would land in the Barangay Configuration list.
        row.kind,
      );
    }
    for (const row of seed.trips) {
      await opened.runAsync(
        `INSERT INTO trips
          (id, trip_number, origin_location_snapshot, destination_location_snapshot,
           started_at, ended_at, distance_km_milli, status, uses_sctex)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.trip_number,
        row.origin_location_snapshot,
        row.destination_location_snapshot,
        row.started_at,
        row.ended_at,
        row.distance_km_milli,
        row.status,
        row.uses_sctex,
      );
    }
    for (const row of seed.tickets) {
      await opened.runAsync(
        `INSERT INTO passenger_transactions
          (id, trip_id, created_at, origin_location_snapshot, destination_location_snapshot,
           passenger_type, passenger_quantity, final_fare_per_passenger, total_fare)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.trip_id,
        row.created_at,
        row.origin_location_snapshot,
        row.destination_location_snapshot,
        row.passenger_type,
        row.passenger_quantity,
        row.final_fare_per_passenger,
        row.total_fare,
      );
    }

    // The version comes from the module that owns the schema, never a literal
    // written here: stamping a database behind the tables just created is what
    // made the second launch abort on a duplicate column.
    // The fare configuration the seeded fares were priced from. Without it a
    // fresh device holds a running trip it cannot record a boarding against —
    // "This device has no fare rules yet" over a ledger of fares — and the
    // seeded amounts on those rows would be explicable by nothing at all.
    const now = nowMs;
    await opened.runAsync(
      `INSERT INTO fare_configuration (
        id, minimum_fare, minimum_distance_milli, rate_per_km, deluxe_rate_per_km,
        special_rate_per_km, deluxe_discount_bp, sctex_discount_bp, express_rate_per_km,
        express_deluxe_rate_per_km, special_express_rate_per_km,
        special_deluxe_rate_per_km, special_express_deluxe_rate_per_km,
        created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
      SEED_FARE.minimum_fare,
      SEED_FARE.minimum_distance_milli,
      SEED_FARE.rate_per_km,
      SEED_FARE.deluxe_rate_per_km,
      SEED_FARE.special_rate_per_km,
      SEED_FARE.express_rate_per_km,
      SEED_FARE.express_deluxe_rate_per_km,
      SEED_FARE.special_express_rate_per_km,
      SEED_FARE.special_deluxe_rate_per_km,
      SEED_FARE.special_express_deluxe_rate_per_km,
      now,
      now,
    );
    await opened.runAsync(
      'INSERT INTO sctex_fare_configuration (id, km_adjustment_milli, created_at, updated_at) VALUES (1, ?, ?, ?)',
      SEED_SCTEX.km_adjustment_milli,
      now,
      now,
    );

    // The version comes from the module that owns the schema, never a literal
    // written here: stamping a database behind the tables just created is what
    // made the second launch abort on a duplicate column.
    await opened.runAsync('INSERT INTO meta (key, value) VALUES (?, ?)', 'seeded', SEEDED_VERSION);
  });
}

/**
 * The two queries the screen observes, in full.
 *
 * The ticket query is scoped by its WHERE clause alone. Callers must not
 * re-filter by `trip_id` in JS — a previous implementation did, harmlessly
 * but misleadingly, and the redundancy invites a future edit that breaks the
 * scoping in one place only.
 */
const TRIP_QUERY = 'SELECT * FROM trips WHERE id = ?';
const TICKETS_QUERY = `
  SELECT * FROM passenger_transactions
  WHERE trip_id = ?
  ORDER BY created_at DESC, id DESC`;

async function readTrip(opened: SQLite.SQLiteDatabase, tripId: number) {
  return opened.getFirstAsync<import('./schema').TripRowRecord>(TRIP_QUERY, tripId);
}

async function readTickets(opened: SQLite.SQLiteDatabase, tripId: number) {
  return opened.getAllAsync<import('./schema').TicketRowRecord>(TICKETS_QUERY, tripId);
}

/**
 * Reads one trip and its ledger.
 *
 * `trip: null` with a clean read means the id does not exist — a distinct
 * outcome from a failed read, which is terminal and surfaced as an error
 * branch, not an empty screen.
 */
export async function fetchTripWithTickets(tripId: number): Promise<{
  trip: import('./schema').TripRowRecord | null;
  tickets: import('./schema').TicketRowRecord[];
}> {
  const opened = await openDatabase();
  const trip = await readTrip(opened, tripId);
  // The ledger is read even when the trip is missing: cheap, and it keeps the
  // two queries' failure modes identical for the caller.
  const tickets = await readTickets(opened, tripId);
  return { trip, tickets };
}

/**
 * The live subscription. `expo-sqlite` re-runs the handler whenever a write
 * touches either table — including writes made from another screen — so the
 * store's own notification system is the "real-time" mechanism and the screen
 * needs no polling and no refresh control.
 */
export function subscribeToTripWithTickets(
  tripId: number,
  onChange: () => void,
): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;

  openDatabase().then(async (opened) => {
    if (cancelled) return;
    // Combined into one subscription: either table changing means both reads
    // re-run, which is exactly the freshness the screen promises.
    if (isMemoryBackend(opened)) {
      memoryListeners.add(onChange);
      unsubscribe = () => memoryListeners.delete(onChange);
    } else {
      const SQLite = await sqlite();
      if (cancelled) return;
      const subscription = SQLite.addDatabaseChangeListener(() => onChange());
      unsubscribe = () => subscription.remove();
    }
  });

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

// ── Add-trip (terminal selection + the one start write) ─────────────────────

const ACTIVE_TERMINALS_QUERY = `
  SELECT * FROM terminals
  WHERE is_active = 1
  ORDER BY km_marker, id`;

/**
 * Reads the terminal options Add-trip offers: active only, ordered by KM
 * marker so the list reads as the route's geography rather than insert order.
 */
export async function fetchActiveTerminals(): Promise<import('./schema').TerminalRowRecord[]> {
  const opened = await openDatabase();
  const rows = await opened.getAllAsync<import('./schema').TerminalRowRecord>(
    ACTIVE_TERMINALS_QUERY,
  );
  return rows.filter(isTerminalRowShape);
}

/**
 * The read side of the trust boundary: a row that is not the shape this
 * schema promises is dropped, never rendered. Storage is writable, and
 * whatever comes back from it is data the app then prints — the prototype
 * filtered its localStorage mirror for exactly this reason.
 */
function isTerminalRowShape(value: unknown): value is import('./schema').TerminalRowRecord {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Partial<import('./schema').TerminalRowRecord>;
  return (
    typeof row.id === 'number' &&
    typeof row.name === 'string' &&
    row.name !== '' &&
    typeof row.km_marker === 'number' &&
    Number.isFinite(row.km_marker) &&
    (row.is_active === 0 || row.is_active === 1) &&
    (row.municipality_id === null ||
      row.municipality_id === undefined ||
      typeof row.municipality_id === 'number')
  );
}

function isMunicipalityRowShape(
  value: unknown,
): value is import('./schema').MunicipalityRowRecord {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Partial<import('./schema').MunicipalityRowRecord>;
  return (
    typeof row.id === 'number' &&
    typeof row.name === 'string' &&
    row.name !== '' &&
    (row.province === null ||
      row.province === undefined ||
      typeof row.province === 'string') &&
    (row.is_active === 0 || row.is_active === 1)
  );
}

/**
 * Reads every terminal, active and inactive together — the Terminal
 * Configuration screen's one observation. Unordered in SQL; the view module
 * owns the route-order sort.
 *
 * `kind` narrows the read to one of the two registries the table holds, which
 * is what keeps Terminal Configuration and Barangay Configuration from
 * listing the same rows. Callers serving a FLOW — the trip's route options,
 * the ticket's stops — pass nothing and get every stop, exactly as they read
 * before the column existed: a route and its boardings are priced off the
 * same km markers, and withholding stops a screen used to offer could strand
 * an install whose registry was all one kind.
 */
export async function fetchAllTerminals(
  kind?: import('./schema').TerminalKind,
): Promise<import('./schema').TerminalRowRecord[]> {
  const opened = await openDatabase();
  const rows = await opened.getAllAsync<import('./schema').TerminalRowRecord>(
    'SELECT * FROM terminals',
  );
  const shaped = rows.filter(isTerminalRowShape);
  return kind === undefined ? shaped : shaped.filter((row) => row.kind === kind);
}

/**
 * Reads one terminal by id — the Terminal Editor's single load. Null when no
 * row matches, which is the editor's distinct not-found outcome, never an
 * empty form.
 */
export async function fetchTerminalById(
  terminalId: number,
): Promise<import('./schema').TerminalRowRecord | null> {
  const opened = await openDatabase();
  const row = await opened.getFirstAsync<import('./schema').TerminalRowRecord>(
    'SELECT * FROM terminals WHERE id = ?',
    terminalId,
  );
  return isTerminalRowShape(row) ? row : null;
}

export type DeactivateResult = 'deactivated' | 'notFound' | 'failed';

/**
 * Deactivates one terminal — the Terminal Configuration screen's only write.
 *
 * The `AND is_active = 1` guard makes a repeat deactivate update zero rows and
 * read as `notFound` rather than silently "succeeding" twice. Existing trips,
 * tickets, and the location snapshots stored on them are untouched: the update
 * names the terminals table alone.
 */
export async function deactivateTerminal(terminalId: number): Promise<DeactivateResult> {
  try {
    const opened = await openDatabase();
    const result = await opened.runAsync(
      'UPDATE terminals SET is_active = 0 WHERE id = ? AND is_active = 1',
      terminalId,
    );
    return result.changes > 0 ? 'deactivated' : 'notFound';
  } catch {
    return 'failed';
  }
}

export type SaveTerminalInput = {
  /** Null inserts a new terminal; a number updates that row. */
  id: number | null;
  name: string;
  km_marker: number;
  is_active: 0 | 1;
  /**
   * The municipality link the schema has always carried. Optional so the
   * two-field Terminal Editor keeps writing neither column on update nor a
   * different value on insert: absent means "leave the link alone" (update)
   * or "write NULL" (insert, the column default), which is exactly what that
   * screen did before the column was ever passed. The Barangay Editor always
   * passes it — a new stop is linked by construction.
   */
  municipality_id?: number | null;
  /**
   * Which registry files a NEW row. Optional for the same reason as the
   * link: an update never writes it (a record stays under the module that
   * created it) and an insert that omits it takes the column's default — the
   * migration's backfill for rows a release install already holds. Both
   * editors pass theirs, which is what makes the two Configuration screens
   * list different records.
   */
  kind?: import('./schema').TerminalKind;
};

export type SaveTerminalResult =
  | { kind: 'saved'; id: number }
  | { kind: 'rejected'; reason: string }
  | { kind: 'notFound' }
  | { kind: 'failed' };

/**
 * Writes one terminal — the Terminal Editor's and the Barangay Editor's
 * mutation.
 *
 * THE DUPLICATE RULE LIVES HERE, as a SELECT on `lower(name)` — the composed
 * string the form boundary built, because that string is the identity every
 * reader downstream splits on. An update excludes its own row, so an edit
 * that keeps its name is not refused by itself. The sentence echoes the same
 * first-comma split the composition used (the place half is comma-free by
 * the form's own refusal), and the screen surfaces `reason` verbatim — same
 * discipline as `saveMunicipality`. The same place in two municipalities is
 * two different composed names and two legal rows.
 *
 * The UPDATE names exactly the columns the caller owns: name, km_marker and
 * is_active always — carrying `is_active` through from the loaded row, so an
 * edit never resets a deactivated terminal to active — and municipality_id
 * only when the caller passed one, so an edit that has never seen the link
 * cannot wipe it. The `WHERE id` guard makes a save against a vanished row
 * update zero rows and read as `notFound` — the editor reports the miss
 * rather than pretending the write landed. A create returns the
 * store-assigned id; timestamps are not a terminal concept, so none are
 * written here. Both paths run through the store's change notification, so
 * the list repaints without a manual refresh.
 */
export async function saveTerminal(input: SaveTerminalInput): Promise<SaveTerminalResult> {
  try {
    const opened = await openDatabase();
    const dupe =
      input.id === null
        ? await opened.getFirstAsync<{ n: number }>(
            'SELECT COUNT(*) AS n FROM terminals WHERE lower(name) = lower(?)',
            input.name,
          )
        : await opened.getFirstAsync<{ n: number }>(
            'SELECT COUNT(*) AS n FROM terminals WHERE lower(name) = lower(?) AND id != ?',
            input.name,
            input.id,
          );
    if ((dupe?.n ?? 0) > 0) {
      const comma = input.name.indexOf(',');
      const reason =
        comma === -1
          ? `${input.name} is already registered.`
          : `${input.name.slice(0, comma).trim()} is already registered in ${input
              .name.slice(comma + 1)
              .trim()}.`;
      return { kind: 'rejected', reason };
    }
    if (input.id === null) {
      const result = await opened.runAsync(
        'INSERT INTO terminals (name, km_marker, is_active, municipality_id, kind) VALUES (?, ?, ?, ?, ?)',
        input.name,
        input.km_marker,
        input.is_active,
        input.municipality_id ?? null,
        // Bound rather than left to the column default so the statement keeps
        // one shape (the memory fallback reads its binds positionally).
        input.kind ?? 'BARANGAY',
      );
      return { kind: 'saved', id: Number(result.lastInsertRowId) };
    }
    const hasLink = input.municipality_id !== undefined;
    const result = hasLink
      ? await opened.runAsync(
          'UPDATE terminals SET name = ?, km_marker = ?, is_active = ?, municipality_id = ? WHERE id = ?',
          input.name,
          input.km_marker,
          input.is_active,
          input.municipality_id ?? null,
          input.id,
        )
      : await opened.runAsync(
          'UPDATE terminals SET name = ?, km_marker = ?, is_active = ? WHERE id = ?',
          input.name,
          input.km_marker,
          input.is_active,
          input.id,
        );
    return result.changes > 0 ? { kind: 'saved', id: input.id } : { kind: 'notFound' };
  } catch {
    return { kind: 'failed' };
  }
}

// ── Barangay Configuration (municipalities + the stop registry) ────────────

/**
 * Reads every municipality, active and inactive together — the Barangay
 * Configuration screen's second observation. Unordered in SQL; the view
 * module owns the name sort.
 */
export async function fetchAllMunicipalities(): Promise<
  import('./schema').MunicipalityRowRecord[]
> {
  const opened = await openDatabase();
  const rows = await opened.getAllAsync<import('./schema').MunicipalityRowRecord>(
    'SELECT * FROM municipalities',
  );
  return rows.filter(isMunicipalityRowShape);
}

export type SaveMunicipalityResult =
  | { kind: 'saved'; id: number }
  | { kind: 'rejected'; reason: string }
  | { kind: 'failed' };

/**
 * Writes one municipality — the Municipality Editor's only mutation, the
 * store's third municipality write beside the read and the deactivation.
 *
 * The duplicate rule lives HERE, as a SELECT on the pair, lower-cased: the
 * same town name in two provinces is two real rows, so a name-only check
 * would refuse a legal record. A rejection returns the sentence the screen
 * surfaces verbatim. `is_active` is 1 and 1 is the only value a create can
 * write; the id is this table's autoincrement — the screen never mints one.
 */
export async function saveMunicipality(
  name: string,
  province: string,
): Promise<SaveMunicipalityResult> {
  try {
    const opened = await openDatabase();
    const existing = await opened.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM municipalities WHERE lower(name) = lower(?) AND lower(province) = lower(?)',
      name,
      province,
    );
    if ((existing?.n ?? 0) > 0) {
      return { kind: 'rejected', reason: `${name} is already listed in ${province}.` };
    }
    const result = await opened.runAsync(
      'INSERT INTO municipalities (name, province, is_active) VALUES (?, ?, 1)',
      name,
      province,
    );
    return { kind: 'saved', id: Number(result.lastInsertRowId) };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * The caption's count: how many municipalities the table already lists in
 * this province — every row, active or not. The caption is about a province,
 * not about linkable rows, so this deliberately does NOT filter `is_active`.
 */
export async function countMunicipalitiesInProvince(province: string): Promise<number> {
  const opened = await openDatabase();
  const row = await opened.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM municipalities WHERE lower(province) = lower(?)',
    province,
  );
  return row?.n ?? 0;
}

/**
 * Reads one municipality by id — the Municipality Editor's edit half. Null when
 * no row matches, which the screen reports as its own not-found outcome rather
 * than as an empty form.
 */
export async function fetchMunicipalityById(
  municipalityId: number,
): Promise<import('./schema').MunicipalityRowRecord | null> {
  const opened = await openDatabase();
  const row = await opened.getFirstAsync<import('./schema').MunicipalityRowRecord>(
    'SELECT * FROM municipalities WHERE id = ?',
    municipalityId,
  );
  return isMunicipalityRowShape(row) ? row : null;
}

/**
 * Writes one EXISTING municipality — the editor's other half, and the store's
 * fourth municipality statement.
 *
 * The duplicate rule is the create rule with one exclusion: the SELECT ignores
 * this row's own id, so saving a form whose name did not change is not refused
 * by the row it is editing. Everything else is deliberately identical — the
 * pair is still compared lower-cased (the same town in two provinces is two
 * real rows), the rejection sentence is the create sentence, and the screen
 * surfaces it verbatim through the same notice slot.
 *
 * `is_active` is not named in the UPDATE: a rename must not reactivate a
 * deactivated record. Barangays linked to this municipality keep their stored
 * name snapshots — a rename is not a rewrite of history — and their
 * `municipality_id` links are untouched, so the registry keeps the link and
 * shows the new name.
 *
 * The `WHERE id` guard makes a save against a vanished row update zero rows and
 * read as `notFound`, which the screen reports rather than pretending the write
 * landed.
 */
export async function updateMunicipality(input: {
  id: number;
  name: string;
  province: string;
}): Promise<SaveMunicipalityResult | { kind: 'notFound' }> {
  try {
    const opened = await openDatabase();
    const dupe = await opened.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM municipalities WHERE lower(name) = lower(?) AND lower(province) = lower(?) AND id != ?',
      input.name,
      input.province,
      input.id,
    );
    if ((dupe?.n ?? 0) > 0) {
      return { kind: 'rejected', reason: `${input.name} is already listed in ${input.province}.` };
    }
    const result = await opened.runAsync(
      'UPDATE municipalities SET name = ?, province = ? WHERE id = ?',
      input.name,
      input.province,
      input.id,
    );
    return result.changes > 0 ? { kind: 'saved', id: input.id } : { kind: 'notFound' };
  } catch {
    return { kind: 'failed' };
  }
}

export type DeactivateMunicipalityResult =
  | { kind: 'deactivated' }
  | { kind: 'notFound' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'failed' }
  | { kind: 'skipped'; reason: string };

/**
 * Deactivates one municipality — the Barangay Configuration screen's second
 * write.
 *
 * The business rule lives here, in the data layer, because it is a fact about
 * the data: a municipality with one or more ACTIVE terminals cannot be
 * deactivated, and the rejection says so in the repository's own words — the
 * nouns name what the guard counted, so an operator holding a terminal row
 * and a municipality is told to deactivate terminals, not some other word for
 * the same rows. The screen must not re-implement or rephrase the rule — it
 * surfaces `reason` verbatim. The `AND is_active = 1` guard makes a repeat
 * deactivate read as `notFound`, the same discipline `deactivateTerminal`
 * follows. Terminals are never cascaded: a rule rejection leaves every
 * terminal untouched, and a success touches only this one row.
 */
export async function deactivateMunicipality(
  municipalityId: number,
): Promise<DeactivateMunicipalityResult> {
  try {
    const opened = await openDatabase();
    let result: DeactivateMunicipalityResult | null = null;
    await opened.withTransactionAsync(async () => {
      const row = await opened.getFirstAsync<import('./schema').MunicipalityRowRecord>(
        'SELECT * FROM municipalities WHERE id = ?',
        municipalityId,
      );
      if (!row) {
        result = { kind: 'notFound' };
        return;
      }
      if (row.is_active !== 1) {
        result = { kind: 'notFound' };
        return;
        // Note: a repeat deactivate on an already-inactive row reads as
        // notFound, matching the barangay write's guard discipline.
      }
      const activeCount = await opened.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM terminals WHERE municipality_id = ? AND is_active = 1',
        municipalityId,
      );
      if ((activeCount?.n ?? 0) > 0) {
        result = {
          kind: 'rejected',
          reason: 'This municipality still has active terminals. Deactivate them first.',
        };
        return;
        // Rejection: no row is written, no terminal is cascaded. The noun says
        // TERMINALS because the guard counts them — the same rows the Barangay
        // Configuration screen lists under its own name — and an operator
        // holding a terminal row and a municipality must be told to go
        // deactivate what this query actually counted.
      }
      const update = await opened.runAsync(
        'UPDATE municipalities SET is_active = 0 WHERE id = ? AND is_active = 1',
        municipalityId,
      );
      result = update.changes > 0 ? { kind: 'deactivated' } : { kind: 'notFound' };
    });
    if (result) return result;
    return { kind: 'skipped', reason: 'Unable to deactivate municipality.' };
  } catch {
    return { kind: 'failed' };
  }
}

export type StartTripInput = {
  originTerminalId: number;
  destinationTerminalId: number;
  usesSctex: boolean;
  /** Device clock at the moment the user pressed start. */
  startedAt: number;
};

export type StartTripResult =
  | { kind: 'started'; tripId: number; tripNumber: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'failed'; message: string };

/**
 * Starts one trip. The only mutation this flow performs, and one transaction:
 * the active-trip re-check, the terminal re-validation, the number generation
 * and the insert all run inside `withTransactionAsync`, so a start from
 * another screen between the user's tap and this write cannot slip a second
 * active trip past the check, and two concurrent starts cannot collide on the
 * same trip number. `usesSctex` is carried on the trip row — it prices every
 * ticket the trip will record.
 */
export async function startTrip(input: StartTripInput): Promise<StartTripResult> {
  const opened = await openDatabase();
  try {
    let result: StartTripResult | null = null;
    await opened.withTransactionAsync(async () => {
      // Re-validated inside the transaction, not just before it.
      const active = await opened.getFirstAsync<{ id: number }>(
        "SELECT id FROM trips WHERE status = 'ACTIVE' LIMIT 1",
      );
      if (active) {
        result = { kind: 'invalid', reason: 'A trip is already running. End it before starting another.' };
        return;
      }

      const origin = await opened.getFirstAsync<import('./schema').TerminalRowRecord>(
        'SELECT * FROM terminals WHERE id = ?',
        input.originTerminalId,
      );
      const destination = await opened.getFirstAsync<import('./schema').TerminalRowRecord>(
        'SELECT * FROM terminals WHERE id = ?',
        input.destinationTerminalId,
      );
      if (!origin || !destination) {
        result = { kind: 'invalid', reason: 'A selected terminal no longer exists. Re-choose the route.' };
        return;
      }
      if (origin.is_active !== 1 || destination.is_active !== 1) {
        result = { kind: 'invalid', reason: 'A selected terminal was deactivated. Re-choose the route.' };
        return;
      }
      if (origin.id === destination.id) {
        result = { kind: 'invalid', reason: 'Origin and destination are the same terminal.' };
        return;
      }
      if (origin.km_marker < 0 || destination.km_marker < 0) {
        result = { kind: 'invalid', reason: 'A terminal KM marker is not configured.' };
        return;
      }
      const distance = Math.abs(destination.km_marker - origin.km_marker);
      if (distance <= 0) {
        result = { kind: 'invalid', reason: 'The route distance is zero. Choose different terminals.' };
        return;
      }

      const maxRow = await opened.getFirstAsync<{ max: number | null }>(
        // Numbers, not ids: the seeded rows carry numbers (6, 5, 4) that do not
        // match their ids, so `MAX(id) + 1` handed the next trip a number that
        // already existed on a seed row. The next number is one past the highest
        // number on file, which can never collide with a stored one.
        'SELECT COALESCE(MAX(CAST(trip_number AS INTEGER)), 0) AS max FROM trips',
      );
      // Trip numbers derive from the highest number already issued, computed
      // inside the same transaction as the insert: reading it outside would let
      // two starts collide on the same number.
      const nextNumber = String((maxRow?.max ?? 0) + 1);

      const insertResult = await opened.runAsync(
        `INSERT INTO trips
          (trip_number, origin_location_snapshot, destination_location_snapshot,
           started_at, ended_at, distance_km_milli, status, uses_sctex)
         VALUES (?, ?, ?, ?, NULL, ?, 'ACTIVE', ?)`,
        nextNumber,
        origin.name,
        destination.name,
        input.startedAt,
        distance,
        input.usesSctex ? 1 : 0,
      );
      result = { kind: 'started', tripId: insertResult.lastInsertRowId, tripNumber: nextNumber };
    });
    if (result) return result;
    return { kind: 'failed', message: 'The trip could not be started.' };
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'The trip could not be started.',
    };
  }
}

// ── Trip board (Trip screen) ────────────────────────────────────────────────────

const ACTIVE_TRIP_QUERY = "SELECT * FROM trips WHERE status = 'ACTIVE' LIMIT 1";
const RECENT_COMPLETED_QUERY = `
  SELECT * FROM trips
  WHERE status = 'COMPLETED'
  ORDER BY COALESCE(ended_at, started_at) DESC, id DESC
  LIMIT 10`;

/**
 * Reads the Trip screen's board: the active trip, if one is running, and the
 * ten most recent completed trips. Pagination past ten belongs to History, so
 * this query is capped by design — the full completed table is never read here.
 */
export async function fetchTripBoard(): Promise<{
  active: import('./schema').TripRowRecord | null;
  recentCompleted: import('./schema').TripRowRecord[];
}> {
  const opened = await openDatabase();
  const active = await opened.getFirstAsync<import('./schema').TripRowRecord>(
    ACTIVE_TRIP_QUERY,
  );
  const recentCompleted = await opened.getAllAsync<import('./schema').TripRowRecord>(
    RECENT_COMPLETED_QUERY,
  );
  return { active, recentCompleted };
}

export type EndTripResult = 'ended' | 'noActiveTrip' | 'failed';

/**
 * Ends the active trip. The only mutation this flow performs.
 *
 * The guard is the point: `AND status = 'ACTIVE'` means a trip already ended
 * elsewhere — or deleted — updates zero rows, and zero rows is a distinct
 * outcome, not a success. `endedAt` comes from the caller's clock at the
 * moment of confirmation, never captured when a dialog opened.
 */
export async function endActiveTrip(tripId: number, endedAt: number): Promise<EndTripResult> {
  try {
    const opened = await openDatabase();
    const result = await opened.runAsync(
      "UPDATE trips SET ended_at = ?, status = 'COMPLETED' WHERE id = ? AND status = 'ACTIVE'",
      endedAt,
      tripId,
    );
    return result.changes > 0 ? 'ended' : 'noActiveTrip';
  } catch {
    return 'failed';
  }
}

/**
 * Live subscription for the Trip board: fires when either table changes,
 * which covers ending a trip (trips write) and recording a ticket (ledger
 * write) — the summary numbers ride the same notification.
 */
export function subscribeToTrips(onChange: () => void): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  openDatabase().then(async (opened) => {
    if (cancelled) return;
    if (isMemoryBackend(opened)) {
      memoryListeners.add(onChange);
      unsubscribe = () => memoryListeners.delete(onChange);
    } else {
      const SQLite = await sqlite();
      if (cancelled) return;
      const subscription = SQLite.addDatabaseChangeListener(() => onChange());
      unsubscribe = () => subscription.remove();
    }
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

/**
 * The opened database handle, for sibling data modules that share the store
 * rather than opening it twice. Resolves only after schema setup completes.
 */
export async function getDefaultDatabase(): Promise<SQLite.SQLiteDatabase> {
  return openDatabase();
}

/**
 * Resolves the trip a "Tickets" entry point should open: the active trip when
 * one is running, otherwise the most recently started trip on file. Null when
 * the device has no trips at all — the caller decides what an empty store
 * looks like.
 */
/**
 * The running trip's id, or null when nothing is running.
 *
 * Deliberately not `fetchDefaultTripId`: recording a fare needs a trip that is
 * still open, and falling back to the most recent finished run would post a
 * boarding against a closed ledger.
 */
export async function fetchActiveTripId(): Promise<number | null> {
  const opened = await openDatabase();
  const row = await opened.getFirstAsync<{ id: number }>(
    "SELECT id FROM trips WHERE status = 'ACTIVE' LIMIT 1",
  );
  return row?.id ?? null;
}

/** The next public trip number: one past the highest number on file. */
export async function fetchNextTripNumber(): Promise<string> {
  const opened = await openDatabase();
  const row = await opened.getFirstAsync<{ max: number }>(
    // Same rule as `startTrip`: numbers derive from numbers. `MAX(id) + 1`
    // collided with the seeded rows' hand-picked numbers.
    'SELECT COALESCE(MAX(CAST(trip_number AS INTEGER)), 0) AS max FROM trips',
  );
  return String((row?.max ?? 0) + 1);
}

export async function fetchDefaultTripId(): Promise<number | null> {
  const opened = await openDatabase();
  const active = await opened.getFirstAsync<{ id: number }>(
    'SELECT id FROM trips WHERE status = ? ORDER BY started_at DESC',
    'ACTIVE',
  );
  if (active) return active.id;
  const latest = await opened.getFirstAsync<{ id: number }>(
    'SELECT id FROM trips ORDER BY started_at DESC',
  );
  return latest?.id ?? null;
}

/** Adds a ticket. Derives the total; never stores an authored one. */
export async function recordTicketRow(input: {
  tripId: number;
  origin: string;
  destination: string;
  passengerType: import('./schema').PassengerType;
  passengerQuantity: number;
  farePerPassenger: number;
}) {
  const opened = await openDatabase();
  await opened.runAsync(
    `INSERT INTO passenger_transactions
      (trip_id, created_at, origin_location_snapshot, destination_location_snapshot,
       passenger_type, passenger_quantity, final_fare_per_passenger, total_fare)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.tripId,
    Date.now(),
    input.origin,
    input.destination,
    input.passengerType,
    input.passengerQuantity,
    input.farePerPassenger,
    input.farePerPassenger * input.passengerQuantity,
  );
}
