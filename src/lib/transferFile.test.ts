/**
 * The file module's pure half, plus the bytes its writer actually produces.
 *
 * Run with: npx tsx src/lib/transferFile.test.ts
 *
 * This file could not exist before the module loaded `react-native` and
 * `expo-file-system` dynamically. A static import made the whole module
 * unimportable under `tsx`, so even `transferFileName` — pure string work —
 * was untestable, and the JSON a real `File.write` produces was never checked
 * against the parser that has to read it. Both are now reachable.
 *
 * What is proved here:
 *
 *   1. The file NAME is findable, dated and safe on every platform's path
 *      rules — a backup the user cannot locate in a file manager is not a
 *      backup, and this is the one piece of a written file the user sees.
 *   2. The bytes `writeTransferFile` produces — `JSON.stringify(file, null,
 *      2)`, the exact call in that function — round-trip through
 *      `parseTransferFile` for both registries. This is the seam the three
 *      other suites each sat on one side of.
 *   3. Non-ASCII survives, because the seed's own names carry it ("Sto. Niño")
 *      and a mangled byte would silently create a second record on restore.
 *   4. A truncated file is refused, not crashed on.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import { transferFileName } from './transferFile';
import { buildBarangayFile, buildTerminalFile, parseTransferFile } from './transferState';

const municipalities: MunicipalityRowRecord[] = [
  { id: 1, name: 'Olongapo City', province: 'Zambales', is_active: 1 },
  { id: 2, name: 'Subic', province: 'Zambales', is_active: 0 },
];
const barangays: TerminalRowRecord[] = [
  {
    id: 10,
    name: 'Santa Cruz, Olongapo City',
    km_marker: 232400,
    is_active: 1,
    municipality_id: 1,
    kind: 'BARANGAY',
  },
  {
    id: 12,
    name: 'Sto. Niño, Subic',
    km_marker: 240000,
    is_active: 0,
    municipality_id: 2,
    kind: 'BARANGAY',
  },
];
const terminals: TerminalRowRecord[] = [
  {
    id: 20,
    name: 'Bus Terminal, Olongapo City',
    km_marker: 231000,
    is_active: 1,
    municipality_id: 1,
    kind: 'TERMINAL',
  },
];

// ── 1: the name ─────────────────────────────────────────────────────────────

const when = new Date(2026, 8, 30, 15, 4, 5);
assert.equal(
  transferFileName('barangay-config', when),
  'kondukt-barangay-config-2026-09-30.json',
);
assert.equal(
  transferFileName('terminal-config', when),
  'kondukt-terminal-config-2026-09-30.json',
);

// Month and day are zero-padded — an unpadded `9-30` sorts and globs wrong.
assert.equal(
  transferFileName('terminal-config', new Date(2026, 0, 5)),
  'kondukt-terminal-config-2026-01-05.json',
);
// And the name carries no separator any filesystem reserves, so it is legal
// on Android's FAT-derived volumes and on iOS's sandbox alike.
assert.match(
  transferFileName('barangay-config', when),
  /^[A-Za-z0-9-.]+\.json$/,
  'no spaces, slashes or colons in the name',
);

// ── 2 + 3 + 4: the bytes, written and read for real ─────────────────────────

const dir = mkdtempSync(join(tmpdir(), 'kondukt-transfer-'));

/** Exactly what `writeTransferFile` does, to a real file on a real disk. */
function writeLikeTheApp(prefix: string, file: Record<string, unknown>): string {
  const path = join(dir, transferFileName(prefix, when));
  writeFileSync(path, JSON.stringify(file, null, 2), 'utf8');
  return readFileSync(path, 'utf8');
}

const barangayBytes = writeLikeTheApp(
  'barangay-config',
  buildBarangayFile(municipalities, barangays, when.getTime()),
);
const terminalBytes = writeLikeTheApp(
  'terminal-config',
  buildTerminalFile(municipalities, terminals, when.getTime()),
);

const readBack = parseTransferFile({
  text: barangayBytes,
  kind: 'barangay-config',
  existingMunicipalities: [],
  existingTerminals: [],
});
assert.equal(readBack.fatal, null, `the app's own written bytes must parse: ${readBack.fatal}`);
assert.equal(readBack.issues.length, 0);
assert.equal(readBack.stops.length, 2);
assert.deepEqual(
  readBack.stops.map((row) => [row.name, row.km_marker, row.is_active, row.municipalityName]),
  [
    ['Santa Cruz', 232400, 1, 'Olongapo City'],
    ['Sto. Niño', 240000, 0, 'Subic'],
  ],
  'the place, the exact stored KM, the flag and the link all survive a real file',
);

const terminalsReadBack = parseTransferFile({
  text: terminalBytes,
  kind: 'terminal-config',
  existingMunicipalities: municipalities,
  existingTerminals: [],
});
assert.equal(terminalsReadBack.fatal, null);
assert.equal(terminalsReadBack.stops.length, 1);

// The tilde is in the bytes as written, and in the name the parser returns.
assert.ok(barangayBytes.includes('Niño'), 'the file is UTF-8 and keeps the tilde');
assert.ok(readBack.stops.some((row) => row.name.includes('Niño')), 'and the parser returns it');

// A file cut short mid-write — the realistic corruption — is refused whole,
// not partially imported.
const truncated = parseTransferFile({
  text: barangayBytes.slice(0, 40),
  kind: 'barangay-config',
  existingMunicipalities: [],
  existingTerminals: [],
});
assert.match(truncated.fatal ?? '', /not readable Kondukt data/);
assert.equal(truncated.stops.length, 0);

console.log('ok — transferFile: file names and the bytes the real writer produces');
