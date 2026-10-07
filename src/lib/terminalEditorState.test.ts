import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import {
  BARANGAY_COMMA_ERROR,
  BARANGAY_KM_ERROR,
  BARANGAY_MUNICIPALITY_GONE_ERROR,
  BARANGAY_MUNICIPALITY_REQUIRED_ERROR,
  BARANGAY_NAME_ERROR,
  BARANGAY_NOT_FOUND_ERROR,
  TERMINAL_COMMA_ERROR,
  TERMINAL_KM_ERROR,
  TERMINAL_NAME_ERROR,
  barangayEditorComposeName,
  barangayEditorFieldsFromRecord,
  barangayEditorHint,
  barangayEditorMunicipalityOptions,
  buildTerminalWrite,
  commitTerminalEditorField,
  composeTerminalName,
  duplicateBarangayError,
  initialTerminalEditorUiState,
  municipalityDisplayLabel,
  parseTerminalKm,
  terminalEditorAccessibilityTitle,
  terminalEditorFieldsFromRecord,
  terminalEditorHint,
  terminalEditorTitle,
  validateBarangayEditorFields,
  validateTerminalEditorFields,
  type TerminalEditorUiState,
} from './terminalEditorState';

/**
 * Self-check for the Terminal Editor's pure logic.
 *
 * Run with: npx tsx src/lib/terminalEditorState.test.ts
 *
 * The fragile parts: record preservation (is_active carried through, id
 * kept, the stored tail carried through an edit), the file's KM cap (231000
 * refused, 0 refused, thousandths out), all-errors-at-once across the two
 * fields, the one-way formatting rule, create mode's empty defaults, and the
 * Barangay Editor's municipality field and looser KM rule staying untouched
 * beside it.
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

const rec = (
  id: number,
  name: string,
  km: number,
  active: 0 | 1,
): TerminalRowRecord => ({
  id,
  name,
  km_marker: km,
  is_active: active,
  municipality_id: null,
  kind: 'TERMINAL',
});

const mun = (
  id: number,
  name: string,
  province: string,
  active: 0 | 1,
): MunicipalityRowRecord => ({ id, name, province, is_active: active });

// The terminal route has no municipality input; its validator takes the two
// fields alone.
const tv = (fields: { name: string; km: string }) =>
  validateTerminalEditorFields(fields);

// ── mode copy ───────────────────────────────────────────────────────────────
check('create title', terminalEditorTitle('create'), 'ADD TERMINAL');
check('edit title', terminalEditorTitle('edit'), 'EDIT TERMINAL');
check(
  'a11y titles are sentence case',
  [
    terminalEditorAccessibilityTitle('create'),
    terminalEditorAccessibilityTitle('edit'),
  ],
  ['Add terminal', 'Edit terminal'],
);

// ── create defaults ─────────────────────────────────────────────────────────
const create = initialTerminalEditorUiState('create');
check('create mode flag', create.mode, 'create');
check('create name empty', create.name, '');
check('create km empty, never "0"', create.km, '');
check('create has no field error yet', create.saveError, null);
check('create not loading', create.isLoading, false);
check('create not saving', create.isSaving, false);

const edit = initialTerminalEditorUiState('edit');
check('edit starts loading', edit.isLoading, true);

// ── load-time derivation ────────────────────────────────────────────────────
check(
  '4500 loads as 4.5',
  terminalEditorFieldsFromRecord(rec(1, 'Santa Cruz', 4_500, 1)),
  { name: 'Santa Cruz', km: '4.5' },
);
check('0 loads as 0', terminalEditorFieldsFromRecord(rec(2, 'Iba', 0, 1))?.km, '0');
check(
  '12345 loads as 12.345',
  terminalEditorFieldsFromRecord(rec(3, 'Subic', 12_345, 1))?.km,
  '12.345',
);
check(
  'trailing zeros stripped: 228000 loads as 228',
  terminalEditorFieldsFromRecord(rec(4, 'A', 228_000, 1))?.km,
  '228',
);
check('missing record reads null', terminalEditorFieldsFromRecord(null), null);
check(
  'edit prefills the PLACE half — the stored tail is carried on write, never loaded',
  terminalEditorFieldsFromRecord({
    ...rec(1, 'Santa Cruz, Olongapo', 228_000, 1),
    municipality_id: 4,
  }),
  { name: 'Santa Cruz', km: '228' },
);

// ── clear-on-keystroke ──────────────────────────────────────────────────────
const errored: TerminalEditorUiState = {
  ...create,
  name: '',
  km: '',
  nameError: TERMINAL_NAME_ERROR,
  kmError: TERMINAL_KM_ERROR,
  saveError: 'Unable to save terminal.',
};
const afterName = commitTerminalEditorField(errored, 'name', 'S');
check('name keystroke clears name error', afterName.nameError, null);
check('name keystroke clears save failure', afterName.saveError, null);
check('name keystroke keeps km error', afterName.kmError, TERMINAL_KM_ERROR);
check('name keystroke writes value', afterName.name, 'S');
const afterKm = commitTerminalEditorField(errored, 'km', '4');
check('km keystroke clears km error', afterKm.kmError, null);
check('km keystroke keeps name error', afterKm.nameError, TERMINAL_NAME_ERROR);
check('km keystroke clears save failure', afterKm.saveError, null);

// ── validation: the file's order within each field, all at once across ──
const clean = tv({ name: 'Santa Cruz', km: '4.5' });
check('valid name', clean.nameError, null);
check('valid km converts to stored', clean.kmStored, 4_500);

check(
  'whitespace-only name fails',
  tv({ name: '   ', km: '4.5' }).nameError,
  TERMINAL_NAME_ERROR,
);
check(
  'the comma is refused at the boundary',
  tv({ name: 'Foo, Bar', km: '4.5' }).nameError,
  TERMINAL_COMMA_ERROR,
);
check(
  'both fields fail together',
  tv({ name: '  ', km: '' }),
  {
    nameError: TERMINAL_NAME_ERROR,
    kmError: TERMINAL_KM_ERROR,
    kmStored: null,
  },
);

// ── the file's KM rule: the three-digit cap is the point ────────────────────
check('the sentence names the cap', TERMINAL_KM_ERROR, 'Enter the registered KM as a number, up to 999.9.');
check('4.5 to 4500', tv({ name: 'A', km: '4.5' }).kmStored, 4_500);
check('86.2 to 86200', tv({ name: 'A', km: '86.2' }).kmStored, 86_200);
check('150.25 stays within the cap', tv({ name: 'A', km: '150.25' }).kmStored, 150_250);
check('232.4 stores 232400', tv({ name: 'A', km: '232.4' }).kmStored, 232_400);
check('232.44 stores 232440 — display rounds, the store keeps', parseTerminalKm('232.44'), 232_440);
check('a thousands separator is stripped: 1,2 → 12000', parseTerminalKm('1,2'), 12_000);
check('the cap itself: 999.9 → 999900', parseTerminalKm('999.9'), 999_900);
check('raw thousandths are refused', tv({ name: 'A', km: '231000' }).kmError, TERMINAL_KM_ERROR);
check('raw thousandths store nothing', tv({ name: 'A', km: '231000' }).kmStored, null);
check('four digits are refused', parseTerminalKm('1234'), null);
check('zero is refused', parseTerminalKm('0'), null);
check('a negative is refused', parseTerminalKm('-5'), null);
check('three decimals are refused — two is the file\'s limit', parseTerminalKm('12.345'), null);
check('malformed 1.2.3 is refused', parseTerminalKm('1.2.3'), null);
check('empty is refused', parseTerminalKm(''), null);
check(
  'a twenty-digit overflow is a field error, not a crash',
  tv({ name: 'A', km: '99999999999999999999' }).kmError,
  TERMINAL_KM_ERROR,
);

// ── record construction ─────────────────────────────────────────────────────
check(
  'create defaults: active, no id',
  buildTerminalWrite(null, 'New Terminal', 5_000),
  { id: null, name: 'New Terminal', km_marker: 5_000, is_active: 1 },
);
check(
  'edit keeps the id',
  buildTerminalWrite(rec(7, 'Old', 1_000, 1), 'New', 2_000)?.id,
  7,
);
check(
  'edit carries an inactive flag through',
  buildTerminalWrite(rec(7, 'Old', 1_000, 0), 'New', 2_000)?.is_active,
  0,
);
check(
  'the link is written when the caller knows it — the barangay route',
  buildTerminalWrite(rec(7, 'Old', 1_000, 1), 'New, Olongapo City', 2_000, 4).municipality_id,
  4,
);
check(
  'a caller that never saw the link leaves the key off the write',
  'municipality_id' in buildTerminalWrite(rec(7, 'Old', 1_000, 1), 'New', 2_000),
  false,
);

// ── the terminal name: bare on create, tail carried on edit ─────────────────
check('create stores the bare place', composeTerminalName('Dau', null), 'Dau');
check('the name is trimmed at the boundary', composeTerminalName('  Dau  ', null), 'Dau');
check(
  'edit carries the stored tail byte-for-byte',
  composeTerminalName('Santa Cruz', rec(1, 'Santa Cruz, Olongapo', 228_000, 1)),
  'Santa Cruz, Olongapo',
);
check(
  'a stored name with no comma stays whole',
  composeTerminalName('Subic', rec(9, 'Subic', 249_600, 1)),
  'Subic',
);

// ── the terminal hint: what will be stored, against the whole registry ──────
const tTerminals: TerminalRowRecord[] = [
  { ...rec(1, 'Olongapo, Olongapo', 232_400, 1), municipality_id: 4 },
  { ...rec(2, 'Dau, Olongapo City', 100_000, 1), municipality_id: 4 },
  { ...rec(3, 'Old Town, Olongapo City', 150_000, 0), municipality_id: 4 },
];
const thintCtx = { terminals: tTerminals };
check(
  'the caption quotes the bare place it will store',
  terminalEditorHint({ name: 'Dau', km: '232.4' }, thintCtx),
  'Stores "Dau" · nearest 232.4 KM · Olongapo, Olongapo',
);
check(
  'no name: the caption is the marker context alone',
  terminalEditorHint({ name: '', km: '' }, thintCtx),
  'Highest marker here 232.4 KM',
);
check(
  'the nearest line prints the FULL stored name, the file\'s own reading',
  terminalEditorHint({ name: 'Dau', km: '149' }, thintCtx).includes(
    'nearest 150 KM · Old Town, Olongapo City',
  ),
  true,
);
check(
  'a refused raw value reads as nothing typed: highest marker shows',
  terminalEditorHint({ name: 'Dau', km: '231000' }, thintCtx).includes('highest marker here 232.4 KM'),
  true,
);
check(
  'the context is the whole registry, however each row was filed',
  terminalEditorHint({ name: 'X', km: '99' }, thintCtx).includes('nearest 100 KM · Dau, Olongapo City'),
  true,
);
check(
  'an empty registry qualifies the stored row honestly',
  terminalEditorHint({ name: 'Dau', km: '' }, { terminals: [] }),
  'Stores "Dau" · no marker registered here yet',
);
check(
  'no name and an empty registry is one honest sentence',
  terminalEditorHint({ name: '', km: '' }, { terminals: [] }),
  'No marker registered here yet',
);

// ── the Barangay Editor: its own looser KM rule is untouched ────────────────
const bMunis: MunicipalityRowRecord[] = [
  mun(4, 'Olongapo City', 'Zambales', 1),
  mun(1, 'Masinloc', 'Zambales', 1),
  mun(19, 'Subic', 'Zambales', 0),
  mun(18, 'Balanga', 'Bataan', 1),
];
const bTerminals: TerminalRowRecord[] = [
  { ...rec(1, 'Poblacion, Masinloc', 41_200, 1), municipality_id: 1 },
  { ...rec(4, 'Barangay 1, Olongapo', 231_000, 1), municipality_id: 4 },
  { ...rec(5, 'Poblacion, Olongapo City', 232_400, 1), municipality_id: 4 },
  { ...rec(20, 'Poblacion, Balanga', 331_000, 0), municipality_id: 18 }, // inactive — still owns the name
  rec(6, 'Poblacion, Subic', 249_600, 1), // unlinked, like the seed's Subic
];
const bctx = {
  municipalities: bMunis,
  terminals: bTerminals,
  requireActiveMunicipality: true,
};
const fields = (
  name: string,
  municipalityId: number | null,
  km: string,
) => ({ name, municipalityId, km });

check(
  'empty name is the barangay sentence',
  validateBarangayEditorFields(fields('', 1, '1'), bctx).nameError,
  BARANGAY_NAME_ERROR,
);
check(
  'the comma is refused at the boundary',
  validateBarangayEditorFields(fields('Foo, Bar', 1, '1'), bctx).nameError,
  BARANGAY_COMMA_ERROR,
);
check(
  'no municipality is its own field error',
  validateBarangayEditorFields(fields('A', null, '1'), bctx).muniError,
  BARANGAY_MUNICIPALITY_REQUIRED_ERROR,
);
check(
  'a vanished municipality is the race guard',
  validateBarangayEditorFields(fields('A', 99, '1'), bctx).muniError,
  BARANGAY_MUNICIPALITY_GONE_ERROR,
);
check(
  'create refuses a deactivated municipality',
  validateBarangayEditorFields(fields('A', 19, '1'), bctx).muniError,
  BARANGAY_MUNICIPALITY_GONE_ERROR,
);
check(
  'edit keeps the deactivated municipality it loaded',
  validateBarangayEditorFields(fields('A', 19, '1'), {
    ...bctx,
    requireActiveMunicipality: false,
  }).muniError,
  null,
);
check(
  'barangay edit keeps the no-municipality row it loaded',
  validateBarangayEditorFields(fields('Subic', null, '4.5'), {
    ...bctx,
    requireActiveMunicipality: false,
    allowMissingMunicipality: true,
  }).muniError,
  null,
);
check(
  'the KM contract is the barangay prototype\'s own: 150.25 and 0 stay valid',
  [
    validateBarangayEditorFields(fields('A', 1, '150.25'), bctx).kmStored,
    validateBarangayEditorFields(fields('A', 1, '0'), bctx).kmStored,
  ],
  [150_250, 0],
);
check(
  'the barangay path keeps its own sentence, not the terminal cap',
  validateBarangayEditorFields(fields('A', 1, ''), bctx).kmError,
  BARANGAY_KM_ERROR,
);
check(
  'all three fields fail together',
  validateBarangayEditorFields(fields('', null, ''), bctx),
  {
    nameError: BARANGAY_NAME_ERROR,
    muniError: BARANGAY_MUNICIPALITY_REQUIRED_ERROR,
    kmError: BARANGAY_KM_ERROR,
    kmStored: null,
  },
);

check(
  'a duplicate names both halves',
  validateBarangayEditorFields(fields('Poblacion', 1, '1'), bctx).nameError,
  duplicateBarangayError('Poblacion', 'Masinloc'),
);
check(
  'the duplicate is case-insensitive',
  validateBarangayEditorFields(fields('poblacion', 1, '1'), bctx).nameError,
  duplicateBarangayError('poblacion', 'Masinloc'),
);
check(
  'a deactivated row still refuses its name',
  validateBarangayEditorFields(fields('Poblacion', 18, '1'), bctx).nameError,
  duplicateBarangayError('Poblacion', 'Balanga'),
);
check(
  'edit does not duplicate against itself',
  validateBarangayEditorFields(fields('Poblacion', 1, '1'), {
    ...bctx,
    editingId: 1,
  }).nameError,
  null,
);
check(
  'the same name in another municipality is not a duplicate',
  validateBarangayEditorFields(fields('Barangay 1', 1, '1'), bctx).nameError,
  null,
);

check(
  'create composes barangay + municipality row',
  barangayEditorComposeName(fields('Bagong', 4, '233.8'), mun(4, 'Olongapo City', 'Zambales', 1), null),
  'Bagong, Olongapo City',
);
check(
  'edit keeps the stored tail byte-for-byte',
  barangayEditorComposeName(
    fields('Santa Cruz', 1, '228'),
    mun(1, 'Masinloc', 'Zambales', 1),
    { ...rec(1, 'Santa Cruz, Olongapo', 228_000, 1), municipality_id: 1 },
  ),
  'Santa Cruz, Olongapo',
);
check(
  'moving the municipality recomposes from the row',
  barangayEditorComposeName(
    fields('Santa Cruz', 4, '228'),
    mun(4, 'Olongapo City', 'Zambales', 1),
    { ...rec(1, 'Santa Cruz, Olongapo', 228_000, 1), municipality_id: 1 },
  ),
  'Santa Cruz, Olongapo City',
);
check(
  'a stored name with no comma stays whole',
  barangayEditorComposeName(fields('Solo', null, '1'), null, rec(9, 'Solo', 1_000, 1)),
  'Solo',
);

check(
  'edit prefills the barangay part and the link',
  barangayEditorFieldsFromRecord({
    ...rec(1, 'Santa Cruz, Olongapo', 228_000, 1),
    municipality_id: 1,
  }),
  { name: 'Santa Cruz', municipalityId: 1, km: '228' },
);
check('no record means no prefill', barangayEditorFieldsFromRecord(null), null);

const hintCtx = { municipalities: bMunis, terminals: bTerminals };
check(
  'before a municipality it asks for one',
  barangayEditorHint(fields('Bagong', null, '233.8'), hintCtx),
  'Choose a municipality to see the KM markers registered in it.',
);
check(
  'with no name it shows the destination, and an empty municipality says so',
  barangayEditorHint(fields('', 19, ''), hintCtx),
  'Subic, Zambales · no marker registered here yet',
);
check(
  'the smoke test: Bagong / Olongapo City / 233.8, no number yet',
  barangayEditorHint(fields('Bagong', 4, ''), hintCtx),
  'Stores "Bagong, Olongapo City" · Zambales · highest marker here 232.4 KM',
);
check(
  'the smoke test after typing: nearest 232.4 KM · Poblacion — the part, not the stored string',
  barangayEditorHint(fields('Bagong', 4, '233.8'), hintCtx),
  'Stores "Bagong, Olongapo City" · Zambales · nearest 232.4 KM · Poblacion',
);
check(
  'a typed comma is not quoted back as a composed name — the form refuses it',
  barangayEditorHint(fields('Bagong, Olongapo City', 4, '233.8'), hintCtx),
  'Olongapo City, Zambales · nearest 232.4 KM · Poblacion',
);
check(
  'nearest picks by absolute distance, inactive rows included',
  barangayEditorHint(fields('X', 4, '231.5'), hintCtx).includes('nearest 231 KM · Barangay 1'),
  true,
);
check(
  'the trimmed rendering: 5000 is 5 KM, never 5.0 KM',
  barangayEditorHint(fields('X', 18, ''), {
    municipalities: bMunis,
    terminals: [{ ...rec(30, 'Poblacion, Balanga', 5_000, 1), municipality_id: 18 }],
  }).includes('highest marker here 5 KM'),
  true,
);

// The picker: active only, geographic order, two-tier counts.
const opts = barangayEditorMunicipalityOptions(bMunis, bTerminals);
check(
  'the sheet opens Balanga, then the Zambales name-order — Subic is not offered',
  opts.map((o) => o.id),
  [18, 1, 4],
);
check(
  'the sub-line counts a deactivated row: Balanga owns one',
  opts.find((o) => o.id === 18)?.barangayCount,
  1,
);
check(
  'Olongapo City owns two',
  opts.find((o) => o.id === 4)?.barangayCount,
  2,
);

check(
  'a clean row pairs name and province',
  municipalityDisplayLabel(mun(4, 'Olongapo City', 'Zambales', 1)),
  'Olongapo City, Zambales',
);
check('not-found sentence for this route', BARANGAY_NOT_FOUND_ERROR, 'Barangay not found.');

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
