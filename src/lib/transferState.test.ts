/**
 * The pure Import / Export rules.
 *
 * Run with: npx tsx src/lib/transferState.test.ts
 *
 * What is worth proving here, and nothing else:
 *
 *   1. A BARANGAY file carries the municipality list AND every barangay with
 *      its stored km_marker — the scope the mission set, and the one a file
 *      that exported only the visible rows would miss.
 *   2. A file round-trips: export then import into an empty device yields the
 *      same stops, the same municipality links and the same registered KM.
 *   3. Import runs the EDITORS' validators, not a copy: a blank name, a comma
 *      in a barangay name, a bad KM and a duplicate are each refused, and the
 *      refusal is the editor's own sentence.
 *   4. Refusal is per ROW, never fatal: one bad row in a good file still
 *      imports the rest, and the summary says what was skipped.
 *   5. The envelope is checked — wrong format, newer version, and the other
 *      screen's file kind are all refused whole.
 */
import assert from 'node:assert/strict';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import {
  BARANGAY_KM_ERROR,
  BARANGAY_MUNICIPALITY_REQUIRED_ERROR,
  TERMINAL_COMMA_ERROR,
  duplicateBarangayError,
} from './terminalEditorState';
import {
  buildBarangayFile,
  buildTerminalFile,
  parseTransferFile,
  transferCountLine,
  transferIssueLines,
  TRANSFER_FORMAT_VERSION,
  type TransferFile,
} from './transferState';

// ── Fixtures ───────────────────────────────────────────────────────────────

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
    id: 11,
    name: 'Mabini, Olongapo City',
    km_marker: 235000,
    is_active: 0,
    municipality_id: 1,
    kind: 'BARANGAY',
  },
  {
    id: 12,
    name: 'Sto. Niño, Subic',
    km_marker: 240000,
    is_active: 1,
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

const text = (file: TransferFile | Record<string, unknown>) => JSON.stringify(file);

const EMPTY = {
  existingMunicipalities: [] as MunicipalityRowRecord[],
  existingTerminals: [] as TerminalRowRecord[],
};

// ── 1: what the barangay file carries ─────────────────────────────────────

const barangayFile = buildBarangayFile(municipalities, barangays, 1_700_000_000_000) as TransferFile;

// The municipality list travels whole — both tabs' data, including the
// inactive municipality, which still owns a barangay.
assert.equal(barangayFile.kind, 'barangay-config');
assert.equal(barangayFile.version, TRANSFER_FORMAT_VERSION);
assert.deepEqual(
  barangayFile.municipalities.map((m) => m.name),
  ['Olongapo City', 'Subic'],
);
assert.equal(barangayFile.municipalities[1].is_active, 0, 'an inactive municipality is exported as inactive');

// Every stop, and its REGISTERED KM in the stored unit — not the one-decimal
// display text, which would round 235000 to 235.0 and lose nothing but
// 234400's precision entirely.
const exportedBarangays = barangayFile.barangays as { name: string; km_marker: number; municipality: string | null }[];
assert.equal(exportedBarangays.length, 3);
assert.deepEqual(
  exportedBarangays.map((row) => row.name),
  ['Santa Cruz', 'Mabini', 'Sto. Niño'],
);
assert.deepEqual(
  exportedBarangays.map((row) => row.km_marker),
  [232400, 235000, 240000],
);
// The link travels as a NAME, and the deactivated municipality's stop keeps
// its link rather than being exported as unlinked.
assert.equal(exportedBarangays[2].municipality, 'Subic');
// The composed tail is NOT the exported name — composition is rebuilt on import.
assert.ok(
  !String(exportedBarangays[0].name).includes(','),
  'the exported stop is its place half, not the composed name column',
);

const terminalFile = buildTerminalFile(municipalities, terminals, 1_700_000_000_000) as TransferFile;
assert.equal(terminalFile.kind, 'terminal-config');
assert.deepEqual(terminalFile.terminals, [
  { name: 'Bus Terminal', municipality: 'Olongapo City', km_marker: 231000, is_active: 1 },
]);

// ── 2: the round trip into an empty device ─────────────────────────────────

const restored = parseTransferFile({ text: text(barangayFile), kind: 'barangay-config', ...EMPTY });
assert.equal(restored.fatal, null);
assert.equal(restored.issues.length, 0, `no refusals: ${JSON.stringify(restored.issues)}`);
assert.equal(restored.municipalities.length, 2);
assert.equal(restored.stops.length, 3);
assert.deepEqual(
  restored.stops.map((s) => [s.name, s.km_marker, s.is_active, s.municipalityName]),
  [
    ['Santa Cruz', 232400, 1, 'Olongapo City'],
    ['Mabini', 235000, 0, 'Olongapo City'],
    ['Sto. Niño', 240000, 1, 'Subic'],
  ],
  'every stop keeps its place, its exact stored KM, its flag and its link',
);

// The terminal file round-trips the same way.
const restoredTerminals = parseTransferFile({
  text: text(terminalFile),
  kind: 'terminal-config',
  ...EMPTY,
});
assert.equal(restoredTerminals.fatal, null);
assert.deepEqual(restoredTerminals.stops, [
  { name: 'Bus Terminal', km_marker: 231000, is_active: 1, municipalityName: 'Olongapo City' },
]);

// ── 3: the editors' validators, verbatim ──────────────────────────────────

/**
 * A barangay file whose stop list is `stops`, carrying this device's two
 * municipalities — so a stop naming one resolves, and the only field left to
 * refuse is the one the test is actually about.
 */
const withStops = (stops: unknown[], rows: unknown[] = municipalities.map((m) => ({ name: m.name, province: m.province, is_active: m.is_active }))) =>
  parseTransferFile({
    text: text({
      format: 'kondukt-transfer',
      version: TRANSFER_FORMAT_VERSION,
      kind: 'barangay-config',
      exportedAt: 0,
      municipalities: rows,
      barangays: stops,
    }),
    kind: 'barangay-config',
    ...EMPTY,
  });

const blankName = withStops([{ name: '   ', municipality: 'Olongapo City', km_marker: 232400, is_active: 1 }]);
assert.equal(blankName.stops.length, 0);
assert.equal(blankName.issues[0].message, 'Enter the barangay name.');

const commaName = withStops([{ name: 'Santa, Cruz', municipality: 'Olongapo City', km_marker: 232400, is_active: 1 }]);
assert.equal(commaName.stops.length, 0);
assert.equal(
  commaName.issues[0].message,
  'Remove the comma from the barangay name.',
  "the comma refusal is the Barangay Editor's own, because two readers split on different commas",
);

const noMunicipality = withStops([{ name: 'Santa Cruz', km_marker: 232400, is_active: 1 }]);
assert.equal(noMunicipality.stops.length, 0);
assert.equal(noMunicipality.issues[0].message, BARANGAY_MUNICIPALITY_REQUIRED_ERROR);

const badKm = withStops([
  { name: 'Santa Cruz', municipality: 'Olongapo City', km_marker: 'not a number', is_active: 1 },
]);
assert.equal(badKm.stops.length, 0);
assert.equal(badKm.issues[0].message, BARANGAY_KM_ERROR);

// The stored integer is read through the editor's OWN text conversion, so a
// file carrying `232400` is judged as the `232.4` a driver would have typed,
// and comes back with no loss.
const exactKm = withStops([
  { name: 'Santa Cruz', municipality: 'Olongapo City', km_marker: 232449, is_active: 1 },
]);
assert.equal(exactKm.stops.length, 1);
assert.equal(
  exactKm.stops[0].km_marker,
  232449,
  'a marker finer than the one-decimal display survives the round trip intact',
);

// A duplicate against the DEVICE, scoped to one municipality: the same place
// in a second municipality is a different record and must import.
const againstDevice = parseTransferFile({
  text: text(barangayFile),
  kind: 'barangay-config',
  existingMunicipalities: municipalities,
  existingTerminals: barangays,
});
assert.equal(againstDevice.fatal, null);
assert.equal(
  againstDevice.stops.length,
  0,
  'every stop on this device is already registered, so all three are refused',
);
assert.equal(againstDevice.municipalities.length, 0, 'and so are both municipalities');
// Both registries refuse, each with its own editor's sentence: the pair for a
// municipality, what-and-where for a barangay.
const againstDeviceMessages = againstDevice.issues.map((issue) => issue.message);
assert.ok(
  againstDeviceMessages.includes('Olongapo City is already listed in Zambales.'),
  `municipality duplicate refused: ${JSON.stringify(againstDeviceMessages)}`,
);
assert.ok(
  againstDeviceMessages.includes(duplicateBarangayError('Santa Cruz', 'Olongapo City')),
  `barangay duplicate refused: ${JSON.stringify(againstDeviceMessages)}`,
);
assert.ok(
  againstDeviceMessages.includes(duplicateBarangayError('Sto. Niño', 'Subic')),
  'a deactivated municipality is still a duplicate owner',
);

// The same place under a DIFFERENT municipality is not a duplicate.
const crossMunicipality = parseTransferFile({
  text: text({
    format: 'kondukt-transfer',
    version: TRANSFER_FORMAT_VERSION,
    kind: 'barangay-config',
    exportedAt: 0,
    municipalities: municipalities.map((m) => ({ name: m.name, province: m.province, is_active: m.is_active })),
    barangays: [{ name: 'Santa Cruz', municipality: 'Subic', km_marker: 232400, is_active: 1 }],
  }),
  kind: 'barangay-config',
  existingMunicipalities: [],
  existingTerminals: barangays,
});
assert.equal(crossMunicipality.stops.length, 1);

// A terminal's exported PLACE half carries no comma — export splits on the
// first one — and a file that tries to smuggle one in is refused by the
// Terminal Editor's own comma rule, the same sentence the form shows.
const terminalComma = parseTransferFile({
  text: text({
    format: 'kondukt-transfer',
    version: TRANSFER_FORMAT_VERSION,
    kind: 'terminal-config',
    exportedAt: 0,
    municipalities: [],
    terminals: [{ name: 'Bacon, Philippines', km_marker: 231000, is_active: 1 }],
  }),
  kind: 'terminal-config',
  ...EMPTY,
});
assert.equal(terminalComma.stops.length, 0);
assert.equal(terminalComma.issues[0].message, TERMINAL_COMMA_ERROR);

// ── 4: refusal is per row, never fatal ─────────────────────────────────────

const mixed = withStops([
  { name: 'Good One', municipality: 'Olongapo City', km_marker: 232400, is_active: 1 },
  { name: '', municipality: 'Olongapo City', km_marker: 232400, is_active: 1 },
  { name: 'Good Two', municipality: 'Olongapo City', km_marker: 233000, is_active: 1 },
]);
assert.equal(mixed.fatal, null, 'one bad row does not fail the file');
assert.deepEqual(
  mixed.stops.map((s) => s.name),
  ['Good One', 'Good Two'],
  'the two good rows are still imported',
);
assert.equal(mixed.issues.length, 1);
assert.equal(mixed.issues[0].index, 2, 'the refusal points at row 2');
// The sheet builds its own notice from these counts, so what it needs is that
// they are exact: two rows accepted, one refusal.
assert.equal(mixed.stops.length, 2);
assert.equal(mixed.municipalities.length, 2, 'the file\'s two municipalities were accepted too');
assert.match(transferIssueLines(mixed.issues)[0], /Row 2/);

// A row that is not an object at all is refused, not crashed on.
const junk = withStops([null, 42, 'nope']);
assert.equal(junk.fatal, null);
assert.equal(junk.stops.length, 0);
assert.equal(junk.issues.length, 3);

// A list that is not a list is refused whole for that collection.
const notAList = parseTransferFile({
  text: text({
    format: 'kondukt-transfer',
    version: TRANSFER_FORMAT_VERSION,
    kind: 'barangay-config',
    exportedAt: 0,
    municipalities: { name: 'Olongapo City' },
    barangays: [],
  }),
  kind: 'barangay-config',
  ...EMPTY,
});
assert.equal(notAList.fatal, null);
assert.match(notAList.issues[0].message, /not a list/);

// ── 5: the envelope ────────────────────────────────────────────────────────

const envelope = (over: Record<string, unknown>) =>
  parseTransferFile({ text: text(over), kind: 'barangay-config', ...EMPTY });

assert.match(
  envelope({ format: 'something-else', version: 1, kind: 'barangay-config' }).fatal ?? '',
  /not exported from Kondukt/,
);
assert.match(envelope({ format: 'kondukt-transfer' }).fatal ?? '', /which version/);
assert.match(
  envelope({
    format: 'kondukt-transfer',
    version: TRANSFER_FORMAT_VERSION + 1,
    kind: 'barangay-config',
  }).fatal ?? '',
  /newer version/,
);
// The other screen's file is refused whole — this is what keeps the two
// registries from listing each other's rows again.
const wrongKind = envelope({
  format: 'kondukt-transfer',
  version: TRANSFER_FORMAT_VERSION,
  kind: 'terminal-config',
  terminals: [{ name: 'Bus Terminal', km_marker: 231000, is_active: 1 }],
});
assert.match(wrongKind.fatal ?? '', /terminal configuration data/);
assert.equal(wrongKind.stops.length, 0, 'a mismatched file imports nothing at all');

assert.match(
  parseTransferFile({ text: 'not json', kind: 'barangay-config', ...EMPTY }).fatal ?? '',
  /not readable Kondukt data/,
);
assert.match(
  parseTransferFile({ text: '[]', kind: 'barangay-config', ...EMPTY }).fatal ?? '',
  /not readable Kondukt data/,
);

// ── Copy ───────────────────────────────────────────────────────────────────

assert.equal(transferCountLine(1, 1, 'barangay-config'), '1 municipality and 1 barangay');
assert.equal(transferCountLine(3, 20, 'barangay-config'), '3 municipalities and 20 barangays');
assert.equal(transferCountLine(0, 1, 'terminal-config'), '1 terminal', 'never "1 terminals"');

console.log('ok — transferState: file shape, round trip, editor validation, per-row refusals');
