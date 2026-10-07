/**
 * The file module's pure half, plus the bytes its writer actually produces.
 *
 * Run with: npx tsx src/lib/transferFile.test.ts
 *
 * This file could not exist before the module loaded `react-native` and
 * `expo-file-system` dynamically. A static import made the whole module
 * unimportable under `tsx`, so even `transferFileName` — pure string work —
 * was untestable, and the bytes a real write produces were never checked
 * against the parser that has to read them. Both are now reachable.
 *
 * What is proved here:
 *
 *   1. The file NAME is findable, dated and safe on every platform's path
 *      rules — a backup the user cannot locate in a file manager is not a
 *      backup, and this is the one piece of a written file the user sees.
 *   2. The bytes are a REAL PDF: the header, the payload block, an xref table
 *      whose offsets each point at the object they claim, and the trailer — all
 *      of it 7-bit, which is what makes byte-counted offsets safe. A `.pdf`
 *      extension on something a viewer would reject is not a PDF export, and no
 *      test of the round trip alone would notice.
 *   3. Those same bytes round-trip through `parseTransferFile` for both
 *      registries. This is the seam the three other suites each sat on one
 *      side of.
 *   4. Non-ASCII survives, because the seed's own names carry it ("Sto. Niño")
 *      and a mangled byte would silently create a second record on restore.
 *   5. A registry big enough to blow the argument limit of `push(...bytes)`
 *      still encodes — the writer appends in chunks, and this is the guard.
 *   6. A truncated file and a foreign PDF are both refused, not crashed on.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import { transferFileName } from './transferFile';
import { decodeTransferPdf, encodeTransferPdf } from './transferPdf';
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
  'kondukt-barangay-config-2026-09-30.pdf',
);
assert.equal(
  transferFileName('terminal-config', when),
  'kondukt-terminal-config-2026-09-30.pdf',
);

// Month and day are zero-padded — an unpadded `9-30` sorts and globs wrong.
assert.equal(
  transferFileName('terminal-config', new Date(2026, 0, 5)),
  'kondukt-terminal-config-2026-01-05.pdf',
);
// And the name carries no separator any filesystem reserves, so it is legal
// on Android's FAT-derived volumes and on iOS's sandbox alike.
assert.match(
  transferFileName('barangay-config', when),
  /^[A-Za-z0-9-.]+\.pdf$/,
  'no spaces, slashes or colons in the name',
);

// ── 2 + 3 + 4: the bytes, written and read for real ─────────────────────────

const dir = mkdtempSync(join(tmpdir(), 'kondukt-transfer-'));

/** Exactly what `writeTransferFile` does, to a real file on a real disk. */
function writeLikeTheApp(prefix: string, file: Record<string, unknown>): Uint8Array {
  const path = join(dir, transferFileName(prefix, when));
  writeFileSync(path, encodeTransferPdf(file));
  return new Uint8Array(readFileSync(path));
}

const barangayBytes = writeLikeTheApp(
  'barangay-config',
  buildBarangayFile(municipalities, barangays, when.getTime()),
);
const terminalBytes = writeLikeTheApp(
  'terminal-config',
  buildTerminalFile(municipalities, terminals, when.getTime()),
);

const asText = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

assert.ok(asText(barangayBytes).startsWith('%PDF-1.4'), 'it is a PDF, not a renamed JSON file');
assert.ok(asText(barangayBytes).includes('%%EOF'), 'and it terminates the way a PDF must');
assert.ok(
  asText(barangayBytes).includes('%%KONDUKT-DATA-BEGIN') &&
    asText(barangayBytes).includes('%%KONDUKT-DATA-END'),
  'and it carries the block the import looks for',
);
// Almost every byte is 7-bit, and the exceptions are exactly the four the PDF
// spec asks for on line two to mark the file as binary. Everything after that —
// every content stream, and therefore every `/Length` and every xref offset —
// is ASCII, which is what lets the writer count offsets in bytes knowing they
// agree with the characters those bytes spell.
assert.deepEqual(
  [...barangayBytes].filter((byte) => byte > 127),
  [0xe2, 0xe3, 0xcf, 0xd3],
  'the only non-ASCII bytes are the four binary-header markers',
);

// The xref offsets are the thing a strict reader checks first, and they are
// counted in bytes rather than characters precisely because of the tilde below.
// Walking the table proves that counting is right.
function checkXref(bytes: Uint8Array, label: string) {
  const text = asText(bytes);
  const startXref = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
  assert.ok(startXref > 0, `${label}: a startxref offset`);
  assert.equal(text.slice(startXref, startXref + 4), 'xref', `${label}: it points at the table`);

  const header = /^xref\n0 (\d+)\n/.exec(text.slice(startXref));
  assert.ok(header, `${label}: a well-formed xref header`);
  const count = Number(header?.[1]);
  const tableStart = startXref + header?.[0].length;
  for (let id = 0; id < count; id += 1) {
    const entry = text.slice(tableStart + id * 20, tableStart + id * 20 + 20);
    assert.match(entry, /^\d{10} \d{5} [nf]\r\n$/, `${label}: entry ${id} is 20 bytes`);
    if (id === 0) continue;
    const offset = Number(entry.slice(0, 10));
    assert.equal(
      text.slice(offset, offset + `${id} 0 obj`.length),
      `${id} 0 obj`,
      `${label}: entry ${id} points at object ${id}`,
    );
  }
}
checkXref(barangayBytes, 'barangay');
checkXref(terminalBytes, 'terminal');

const readBack = parseTransferFile({
  text: decodeTransferPdf(barangayBytes) ?? '',
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
// The registered KM is the whole point of the backup, asserted on its own.
assert.deepEqual(
  readBack.stops.map((row) => row.km_marker),
  [232400, 240000],
  'every registered KM lands exactly as stored',
);
assert.deepEqual(
  readBack.municipalities.map((row) => `${row.name}, ${row.province}`),
  ['Olongapo City, Zambales', 'Subic, Zambales'],
  'and the municipal list travels with them',
);

const terminalsReadBack = parseTransferFile({
  text: decodeTransferPdf(terminalBytes) ?? '',
  kind: 'terminal-config',
  existingMunicipalities: municipalities,
  existingTerminals: [],
});
assert.equal(terminalsReadBack.fatal, null);
assert.equal(terminalsReadBack.stops.length, 1);
assert.equal(terminalsReadBack.stops[0].km_marker, 231000);

// The tilde is the seed's own name, and it is the one thing in this document
// that CANNOT be ASCII — so it is the one thing that proves the payload is
// carried losslessly rather than flattened on the way in or out. A name that
// came back as "Nino" would restore as a SECOND RECORD rather than a duplicate.
assert.ok(
  (decodeTransferPdf(barangayBytes) ?? '').includes('Niño'),
  'and the payload carries it as UTF-8, not as a replacement character',
);
assert.ok(readBack.stops.some((row) => row.name.includes('Niño')), 'and the parser returns it');

// ── 5: a registry too large to spread through a call ────────────────────────

// `push(...bytes)` throws past its argument limit, which a two-row fixture
// never reaches. Two thousand rows do, and the chunks carry it.
const manyBarangays: TerminalRowRecord[] = Array.from({ length: 2000 }, (_, index) => ({
  id: index + 1,
  name: `Sitio ${index + 1}, Olongapo City`,
  km_marker: 100000 + index,
  is_active: 1,
  municipality_id: 1,
  kind: 'BARANGAY' as const,
}));
const bigFile = buildBarangayFile(municipalities, manyBarangays, when.getTime());
const bigBytes = encodeTransferPdf(bigFile);
assert.ok(bigBytes.length > 100000, 'the big fixture is big enough to matter');
checkXref(bigBytes, 'big');
const bigReadBack = parseTransferFile({
  text: decodeTransferPdf(bigBytes) ?? '',
  kind: 'barangay-config',
  existingMunicipalities: [],
  existingTerminals: [],
});
assert.equal(bigReadBack.fatal, null);
assert.equal(bigReadBack.stops.length, 2000, 'all two thousand survive the PDF');
assert.equal(bigReadBack.stops[1999].km_marker, 101999);

// ── 6: refused, not crashed on ──────────────────────────────────────────────

const plain = asText(barangayBytes);
const beginAt = plain.indexOf('%%KONDUKT-DATA-BEGIN');
const endAt = plain.indexOf('%%KONDUKT-DATA-END');
assert.ok(beginAt > 0 && endAt > beginAt, 'the payload block is on the page');

// Cut BEFORE the block — a file that lost its whole payload. No sentinels, so
// no document is attempted and none is invented.
assert.equal(
  decodeTransferPdf(barangayBytes.slice(0, beginAt)),
  null,
  'a PDF cut short of its block carries no document',
);

// Cut IN THE MIDDLE of it, which is what a write interrupted part way through
// actually looks like. The opening sentinel survives, so a partial document is
// recovered and the PARSER refuses it — the truer outcome than "this is not a
// Kondukt export", because the file is one, and it is incomplete.
const midway = beginAt + Math.floor((endAt - beginAt) / 2);
const partialText = decodeTransferPdf(barangayBytes.slice(0, midway));
assert.ok(partialText !== null, 'the opening sentinel still yields a document');
assert.ok(partialText !== null && !partialText.endsWith('}'), 'and it is a partial one');
const partial = parseTransferFile({
  text: partialText ?? '',
  kind: 'barangay-config',
  existingMunicipalities: [],
  existingTerminals: [],
});
assert.match(partial.fatal ?? '', /not readable Kondukt data/);
assert.equal(partial.stops.length, 0, 'and nothing is half-imported');

// A real PDF that is not ours — a photo or a report — has no sentinels at all,
// which is a different failure from a Kondukt PDF that arrived damaged.
const foreign = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
assert.equal(decodeTransferPdf(foreign), null, 'another app\'s PDF is refused');
assert.equal(decodeTransferPdf(new Uint8Array(0)), null, 'an empty read is refused');

console.log('ok — transferFile: file names, real PDF bytes, and the round trip back');