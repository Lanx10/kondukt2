/// <reference types="node" />
/**
 * The Configuration screens' Import / Export state machine, driven end to end.
 *
 * Run with: npx tsx src/lib/useConfigTransfer.test.ts
 *
 * `transferFile.test.ts` proves the bytes, `transferState.test.ts` proves the
 * file is judged, and `transferImport.test.ts` proves the writers against a real
 * SQLite engine. NONE of them can reach the thing that actually goes wrong in
 * the field: the ORDER of the awaits.
 *
 * An import is the only flow in this app that leaves the process and comes
 * back — the system file picker is a separate activity, and the user is away
 * from the app for as long as it takes them to find a file. Every other await in
 * this hook resolves in milliseconds, so a busy flag that covers them is a
 * formality; one that does not cover the picker is a hole the user walks
 * through with a second tap.
 *
 * Nothing is mocked except the PLATFORM, and the shims are the repo's own:
 * `node:sqlite` for `expo-sqlite`, so the real store writers execute, and a
 * `react` carrying a two-hook shim, so the real hook body runs rather than a
 * copy of it. `File` and `Platform` are stood in for because the picker has no
 * meaningful equivalent off a device — at the MODULE boundary, which is
 * exactly where the app itself cannot see past.
 *
 * What is proved here:
 *
 *   1. `busy` covers the WHOLE operation, the picker included. This is the
 *      defect the suite exists for: `busy` was set AFTER the picker resolved,
 *      so for the whole of the user's trip to the file browser the sheet's
 *      buttons were live and its label still read IMPORT.
 *   2. A second tap in the picker window cannot open a second picker, and so
 *      cannot write one file twice against a single stale snapshot.
 *   3. Every exit clears `busy` — cancel, a file that is not ours, a document
 *      the parser refuses, a picker that throws, and success. A sheet stuck on
 *      "Importing…" is unrecoverable without a restart.
 *   4. Cancelling says NOTHING. Dismissing a picker has decided no thing, and a
 *      notice there would report a choice as a fault.
 *   5. A successful import really writes to the database the app ships, and an
 *      export really produces a PDF carrying the registry.
 */
import assert from 'node:assert/strict';
import module, { type LoadHookSync, type ResolveHookSync } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import type * as SQLite from 'expo-sqlite';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import { BOOTSTRAP_SQL } from './storeSchema';

type PickerOutcome =
  | { canceled: true }
  | { canceled: false; name: string; bytes: Uint8Array }
  | { throw: Error };

type Control = {
  useState: (initial: unknown) => [unknown, (next: unknown) => void];
  useCallback: (fn: unknown, deps: unknown[]) => unknown;
  pickerCalls: number;
  /** Settles the picker the flow is currently awaiting. */
  release: (outcome: PickerOutcome) => void;
  /** Holds the next pick open so the picker window can be inspected. */
  holdNext: boolean;
  writes: { name: string; bytes: Uint8Array }[];
  sqliteHandle: unknown;
};

const control: Control = {
  useState: () => [undefined, () => {}],
  useCallback: (fn) => fn,
  pickerCalls: 0,
  release: () => {},
  holdNext: false,
  writes: [],
  sqliteHandle: null,
};
(globalThis as unknown as { __kondukt: Control }).__kondukt = control;

function sqliteShim(db: DatabaseSync) {
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

const REACT_FAKE = `
export const useState = (initial) => globalThis.__kondukt.useState(initial);
export const useCallback = (fn, deps) => globalThis.__kondukt.useCallback(fn, deps);
`;

const REACT_NATIVE_FAKE = `export const Platform = { OS: 'android' };`;

const SQLITE_FAKE = `
const control = globalThis.__kondukt;
export function openDatabaseAsync() { return Promise.resolve(control.sqliteHandle); }
`;

const FILE_SYSTEM_FAKE = `
const control = globalThis.__kondukt;
function picked(name, bytes) {
  const file = new FakeFile('file:///picked', name);
  file.payload = bytes;
  return { canceled: false, result: file };
}
class FakeFile {
  constructor(dir, name) {
    this.uri = String(dir) + '/' + String(name);
    this.name = name;
    this.size = 0;
    this.payload = new Uint8Array(0);
  }
  create() { this.size = 0; }
  write(bytes) {
    this.size = bytes.length;
    this.payload = bytes;
    control.writes.push({ name: this.name, bytes: bytes });
  }
  async bytes() { return this.payload; }
  static async pickFileAsync() {
    control.pickerCalls += 1;
    if (control.holdNext) {
      control.holdNext = false;
      return new Promise((resolve, reject) => {
        control.release = (outcome) => {
          if ('throw' in outcome) {
            reject(outcome.throw);
            return;
          }
          if (outcome.canceled) resolve({ canceled: true });
          else resolve(picked(outcome.name, outcome.bytes));
        };
      });
    }
    throw new Error('pickFileAsync was called without a hold');
  }
}
export const Paths = { document: 'file:///documents' };
export const File = FakeFile;
`;

const loaderHooks: { resolve: ResolveHookSync; load: LoadHookSync } = {
  resolve(specifier, context, nextResolve) {
    const fakes: Record<string, string> = {
      react: 'fake:react',
      'expo-file-system': 'fake:expo-file-system',
      'expo-sqlite': 'fake:expo-sqlite',
      'react-native': 'fake:react-native',
    };
    if (specifier in fakes) return { url: fakes[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const sources: Record<string, string> = {
      'fake:react': REACT_FAKE,
      'fake:expo-file-system': FILE_SYSTEM_FAKE,
      'fake:expo-sqlite': SQLITE_FAKE,
      'fake:react-native': REACT_NATIVE_FAKE,
    };
    if (url in sources) return { format: 'module', shortCircuit: true, source: sources[url] };
    return nextLoad(url, context);
  },
};
module.registerHooks(loaderHooks);

// ── the two-hook renderer ───────────────────────────────────────────────────

let states: unknown[] = [];
let hookDeps: unknown[][] = [];
let hookCache: unknown[] = [];
let cursor = 0;
let latest: { sheetProps: unknown } = { sheetProps: null };
let rerender: () => void = () => {};

control.useState = (initial) => {
  const at = cursor++;
  if (!(at in states)) {
    states[at] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
  }
  const set = (next: unknown) => {
    const value =
      typeof next === 'function' ? (next as (current: unknown) => unknown)(states[at]) : next;
    if (Object.is(value, states[at])) return;
    states[at] = value;
    rerender();
  };
  return [states[at], set];
};

control.useCallback = (fn, deps) => {
  const at = cursor++;
  const previous = hookDeps[at];
  const same =
    previous !== undefined &&
    previous.length === deps.length &&
    previous.every((value, index) => Object.is(value, deps[index]));
  if (!same) {
    hookDeps[at] = deps;
    hookCache[at] = fn;
  }
  return hookCache[at];
};

// ── fixtures ────────────────────────────────────────────────────────────────

const MUNICIPALITIES: MunicipalityRowRecord[] = [
  { id: 1, name: 'Olongapo City', province: 'Zambales', is_active: 1 },
  { id: 2, name: 'Subic', province: 'Zambales', is_active: 1 },
];
const STOPS: TerminalRowRecord[] = [
  {
    id: 10,
    name: 'Santa Cruz, Olongapo City',
    km_marker: 232400,
    is_active: 1,
    municipality_id: 1,
    kind: 'BARANGAY',
  },
];

/** The sheet's own view of the world, read through its props. */
type Sheet = {
  busy: 'export' | 'import' | null;
  notice: string | null;
  exportedName: string | null;
  issues: { label: string; message: string }[];
  onExport: () => void;
  onImport: () => void;
};

function countRows(db: DatabaseSync, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...(params as never[])) as { n: number } | undefined;
  return row?.n ?? 0;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * Waits for the flow to actually REACH the picker.
 *
 * `readTransferFile` dynamically imports the platform module before it picks,
 * so the picker is a dynamic import away rather than one await away. Polling is
 * the honest way to observe a window that opens on another module's schedule.
 */
const waitForPicker = async (after: number) => {
  for (let attempt = 0; attempt < 200 && control.pickerCalls <= after; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

async function main() {
  const db = new DatabaseSync(':memory:');
  // The schema is in place before the first count, so the assertions below read
  // rows the hook's own writes produced rather than a missing table.
  db.exec(BOOTSTRAP_SQL);
  control.sqliteHandle = sqliteShim(db);
  control.release = () => {};

  const { useConfigTransfer } = await import('./useConfigTransfer');
  const { BARANGAY_REGISTRY, TERMINAL_REGISTRY } = await import('./transferRegistry');
  const { buildBarangayFile, buildTerminalFile } = await import('./transferState');
  const { encodeTransferPdf } = await import('./transferPdf');

  // This file is the render pass: there is no component tree, and this call
  // is not one a component would make. It is bound under a name that does not
  // claim otherwise rather than silenced.
  const mountTransfer = useConfigTransfer;

  const mount = (registry: unknown, municipalities: unknown[], stops: unknown[]) => {
    states = [];
    hookDeps = [];
    hookCache = [];
    rerender = () => {
      cursor = 0;
      latest = mountTransfer({
        registry: registry as never,
        municipalities: municipalities as never,
        stops: stops as never,
      });
    };
    rerender();
  };
  mount(BARANGAY_REGISTRY, MUNICIPALITIES, STOPS);
  const sheet = () => latest.sheetProps as unknown as Sheet;
  // Presses IMPORT and waits until the flow has reached its picker, so the
  // window between the tap and the file being chosen can be inspected.
  const startImport = async () => {
    const before = control.pickerCalls;
    control.holdNext = true;
    sheet().onImport();
    await waitForPicker(before);
  };


  // ── 1 + 2: the picker window ─────────────────────────────────────────────
  // The user taps IMPORT and the system picker takes the screen. For the whole
  // of that time the hook is mid-operation, so the sheet must read as busy:
  // both buttons disabled, the label reading "Importing…".

  await startImport();
  assert.equal(sheet().busy, 'import', 'the sheet is busy while the picker is open');
  assert.equal(control.pickerCalls, 1, 'one tap opens exactly one picker');

  // The button cannot fire a second time while that window is open, and the
  // thing that stops it is exactly this value: `ConfigTransferSheet` renders
  // both actions `disabled={busy !== null}` and swaps the label to
  // "Importing…". Calling `onImport` directly here would bypass the very
  // control under test and prove nothing about the app, so what is asserted is
  // the prop the button reads — which is why it is non-null from the tap, not
  // from the moment the file was chosen.
  assert.equal(sheet().busy, 'import', 'still busy with the picker open, on every tick');
  assert.equal(control.pickerCalls, 1, 'and still exactly one picker');

  // ── 4: cancelling says nothing ────────────────────────────────────────────
  control.release({ canceled: true });
  await settle();
  assert.equal(sheet().busy, null, 'a cancelled picker leaves the sheet usable');
  assert.equal(sheet().notice, null, 'and reports no error — the user chose nothing');

  // ── 3: a file that is not ours ───────────────────────────────────────────
  await startImport();
  assert.equal(sheet().busy, 'import', 'and the sheet is busy again for the next pick');
  control.release({
    canceled: false,
    name: 'holiday-itinerary.pdf',
    bytes: new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF\n'),
  });
  await settle();
  assert.match(sheet().notice ?? '', /not a Kondukt export/);
  assert.equal(sheet().busy, null, 'and the sheet is usable again');

  // ── 3: a picker that throws ──────────────────────────────────────────────
  await startImport();
  control.release({ throw: new Error('no picker on this device') });
  await settle();
  assert.equal(sheet().busy, null, 'a picker that throws does not strand the sheet');
  assert.ok((sheet().notice ?? '').length > 0, 'and it says what happened');

  // ── 3: a Kondukt PDF whose document the parser refuses ───────────────────
  await startImport();
  control.release({
    canceled: false,
    name: 'kondukt-barangay-config-2026-09-30.pdf',
    bytes: encodeTransferPdf({
      format: 'kondukt-transfer',
      version: 99,
      kind: 'barangay-config',
    } as unknown as Record<string, unknown>),
  });
  await settle();
  assert.equal(sheet().busy, null, 'a refused document releases the sheet');
  assert.ok((sheet().notice ?? '').length > 0, 'and says why');

  // ── 3 + 5: a real import ─────────────────────────────────────────────────
  const before = countRows(db, 'SELECT COUNT(*) AS n FROM terminals WHERE kind = ?', 'BARANGAY');
  // Towns this device does not have, so the rows that land are unmistakably new.
  const fresh = buildBarangayFile(
    [
      { id: 90, name: 'Mabalacat', province: 'Pampanga', is_active: 1 },
      { id: 91, name: 'Porac', province: 'Pampanga', is_active: 1 },
    ],
    [
      {
        id: 99,
        name: 'Poblacion, Mabalacat',
        km_marker: 150000,
        is_active: 1,
        municipality_id: 90,
        kind: 'BARANGAY',
      },
      {
        id: 98,
        name: 'Rizal, Porac',
        km_marker: 160500,
        is_active: 0,
        municipality_id: 91,
        kind: 'BARANGAY',
      },
    ],
    Date.UTC(2026, 8, 30),
  );

  await startImport();
  control.release({
    canceled: false,
    name: 'kondukt-barangay-config-2026-09-30.pdf',
    bytes: encodeTransferPdf(fresh as unknown as Record<string, unknown>),
  });
  await settle();

  assert.equal(sheet().busy, null, 'a successful import releases the sheet');
  assert.match(sheet().notice ?? '', /Imported 2 barangays\./, 'and reports what it wrote');
  const after = countRows(db, 'SELECT COUNT(*) AS n FROM terminals WHERE kind = ?', 'BARANGAY');
  assert.equal(after - before, 2, 'and the two stops really landed in the database');
  assert.equal(
    countRows(db, "SELECT COUNT(*) AS n FROM terminals WHERE name LIKE 'Poblacion%'"),
    1,
    'including the linked one',
  );
  assert.equal(
    countRows(db, "SELECT COUNT(*) AS n FROM terminals WHERE name LIKE 'Rizal%' AND is_active = 0"),
    1,
    'and the deactivated one comes back deactivated',
  );

  // ── 3: the same file twice is refused, not doubled ────────────────────────
  await startImport();
  control.release({
    canceled: false,
    name: 'kondukt-barangay-config-2026-09-30.pdf',
    bytes: encodeTransferPdf(fresh as unknown as Record<string, unknown>),
  });
  await settle();
  assert.equal(
    countRows(db, 'SELECT COUNT(*) AS n FROM terminals WHERE kind = ?', 'BARANGAY'),
    after,
    'the same file twice does not double the registry',
  );
  assert.ok(sheet().issues.length >= 2, 'and the refusals are listed');

  // ── 5: an export writes a PDF ────────────────────────────────────────────
  const writtenBefore = control.writes.length;
  sheet().onExport();
  assert.equal(sheet().busy, 'export', 'the sheet is busy the moment EXPORT is pressed');
  await settle();
  assert.equal(sheet().busy, null, 'and released when it is done');
  assert.equal(control.writes.length, writtenBefore + 1, 'one press wrote one file');
  const written = control.writes[control.writes.length - 1];
  assert.match(written.name, /^kondukt-barangay-config-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(
    Buffer.from(written.bytes.subarray(0, 5)).toString('latin1'),
    '%PDF-',
    'the export is a PDF',
  );
  assert.equal(sheet().exportedName, written.name, 'and the sheet says where it went');
  assert.match(sheet().notice ?? '', /Exported /, 'and what it holds');

  // ── the terminal registry drives the same machine ────────────────────────
  mount(TERMINAL_REGISTRY, MUNICIPALITIES, [
    {
      id: 20,
      name: 'Bus Terminal, Olongapo City',
      km_marker: 231000,
      is_active: 1,
      municipality_id: 1,
      kind: 'TERMINAL',
    },
  ]);

  await startImport();
  assert.equal(sheet().busy, 'import', 'the terminal screen is busy in the picker window too');
  control.release({
    canceled: false,
    name: 'kondukt-terminal-config-2026-09-30.pdf',
    bytes: encodeTransferPdf(
      buildTerminalFile(MUNICIPALITIES, [], Date.UTC(2026, 8, 30)) as unknown as Record<
        string,
        unknown
      >,
    ),
  });
  await settle();
  assert.equal(sheet().busy, null, 'and released on the terminal screen too');
  assert.match(sheet().notice ?? '', /Imported 0 terminals\./);
  assert.equal(
    countRows(db, 'SELECT COUNT(*) AS n FROM terminals WHERE kind = ?', 'TERMINAL'),
    0,
    'and a terminal file with no terminals writes no terminals',
  );

  console.log('ok — useConfigTransfer: the picker window, every exit, and the rows that land');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
