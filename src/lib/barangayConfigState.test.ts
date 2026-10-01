import type { TerminalRowRecord } from '../data/schema';
import {
  barangayCountLabel,
  barangayDetailPairs,
  barangayDetailSubtitle,
  barangayRowValue,
  deriveLocationView,
  filterByStatus,
  filterBarangaysBySearch,
  filterMunicipalitiesBySearch,
  initialLocationUiState,
  locationCountAnnouncement,
  locationCountLabel,
  locationEmptyState,
  municipalityDetailPairs,
  municipalityRowValue,
  recordAnnouncement,
  scopeBarangays,
  scopeMenuItems,
  scopeOptionSelected,
  scopeTriggerAnnouncement,
  scopeTriggerLabel,
  sortBarangaysByRoute,
  sortMunicipalitiesByName,
  toConfigBarangayRow,
  type ConfigBarangayRow,
  type MunicipalityRow,
} from './barangayConfigState';

/**
 * Self-check for the Barangay Configuration derivation.
 *
 * Run with: npx tsx src/lib/barangayConfigState.test.ts
 *
 * The fragile parts: the SHARED status filter narrowing both tabs, the
 * unfiltered totals, the fixed per-municipality count (search must not move
 * it), barangay name tie-break at equal KM, the scope never applying to the
 * municipalities tab, and the scope menu excluding inactive municipalities.
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

const term = (
  id: number,
  name: string,
  km: number,
  active: 0 | 1,
  munId: number | null,
): TerminalRowRecord => ({
  id,
  name,
  km_marker: km,
  is_active: active,
  municipality_id: munId,
  kind: 'BARANGAY',
});

const mun = (id: number, name: string, province: string, active: 0 | 1): MunicipalityRow => ({
  id,
  name,
  province,
  is_active: active,
});

const b = (t: TerminalRowRecord, province: string) => toConfigBarangayRow(t, province);

const barangays: ConfigBarangayRow[] = [
  b(term(5, 'Iba, Iba', 96_800, 1, 3), 'Zambales'),
  b(term(1, 'Santa Cruz, Olongapo', 228_000, 1, 1), 'Zambales'),
  b(term(4, 'Subic, Subic', 249_600, 0, null), 'Zambales'),
  b(term(2, 'Caloocan, Kalakhang Maynila', 314_200, 1, 2), 'Metro Manila'),
  b(term(3, 'Olongapo, Olongapo', 232_400, 1, 1), 'Zambales'),
];
const municipalities: MunicipalityRow[] = [
  mun(2, 'Caloocan', 'Metro Manila', 1),
  mun(1, 'Olongapo', 'Zambales', 1),
  mun(3, 'Iba', 'Zambales', 1),
  mun(4, 'Subic', 'Zambales', 0),
];

const base = {
  allBarangays: barangays,
  allMunicipalities: municipalities,
  barangaySearchQuery: '',
  municipalitySearchQuery: '',
  selectedMunicipalityId: null,
  statusFilter: 'ALL' as const,
};

// ── defaults ────────────────────────────────────────────────────────────────
const init = initialLocationUiState();
check('opens on barangays tab', init.selectedTab, 'BARANGAYS');
check('opens with status ALL', init.statusFilter, 'ALL');
check('opens without scope', init.selectedMunicipalityId, null);
check('opens loading', init.isLoading, true);

// ── barangay search: three fields, never KM ─────────────────────────────────
check('search matches barangay name', filterBarangaysBySearch(barangays, 'santa').length, 1);
check('search matches municipality', filterBarangaysBySearch(barangays, 'kalakhang').length, 1);
check('search matches province', filterBarangaysBySearch(barangays, 'zambales').length, 4);
check('search does not match KM', filterBarangaysBySearch(barangays, '228').length, 0);
check('search is case-insensitive', filterBarangaysBySearch(barangays, 'SANTA CRUZ').length, 1);
check(
  'whitespace query matches everything',
  filterBarangaysBySearch(barangays, '   ').length,
  barangays.length,
);

// ── municipality search: two fields ─────────────────────────────────────────
check('mun search matches name', filterMunicipalitiesBySearch(municipalities, 'caloocan').length, 1);
check('mun search matches province', filterMunicipalitiesBySearch(municipalities, 'metro').length, 1);
check('mun search blank matches all', filterMunicipalitiesBySearch(municipalities, '').length, 4);

// ── scope and status ────────────────────────────────────────────────────────
check(
  'scope keeps only the linked barangays',
  scopeBarangays(barangays, 1).map((r) => r.id),
  [1, 3],
);
check('scope null passes through', scopeBarangays(barangays, null).length, 5);
check(
  'status ACTIVE reads the flag',
  filterByStatus(barangays, 'ACTIVE').map((r) => r.id),
  [5, 1, 2, 3],
);
check(
  'status INACTIVE reads the flag',
  filterByStatus(barangays, 'INACTIVE').map((r) => r.id),
  [4],
);
check('status ALL passes through', filterByStatus(municipalities, 'ALL').length, 4);

// ── ordering: km then NAME, after filtering ────────────────────────────────
check(
  'route order is km ascending',
  sortBarangaysByRoute(barangays).map((r) => r.id),
  [5, 1, 3, 4, 2],
);
check(
  'equal km ties by name, never id',
  sortBarangaysByRoute([
    b(term(9, 'Zeta, Olongapo', 100_000, 1, 1), 'Z'),
    b(term(8, 'Alpha, Olongapo', 100_000, 1, 1), 'Z'),
  ]).map((r) => r.barangayName),
  ['Alpha', 'Zeta'],
);
check(
  'municipality order is name ascending',
  sortMunicipalitiesByName(municipalities).map((m) => m.id),
  [2, 3, 1, 4],
);

// ── the shared derivation ───────────────────────────────────────────────────
const all = deriveLocationView(base);
check('total barangays is unfiltered', all.totalBarangays, 5);
check('total municipalities is unfiltered', all.totalMunicipalities, 4);

const searched = deriveLocationView({ ...base, barangaySearchQuery: 'santa' });
check('search narrows barangays', searched.barangays.map((r) => r.id), [1]);
check('search does not touch the total', searched.totalBarangays, 5);
check(
  'municipality search does not touch barangay list',
  deriveLocationView({ ...base, municipalitySearchQuery: 'caloocan' }).barangays.length,
  5,
);
check(
  'barangay search does not touch municipality list',
  deriveLocationView({ ...base, barangaySearchQuery: 'santa' }).municipalities.length,
  4,
);

const scoped = deriveLocationView({ ...base, selectedMunicipalityId: 1 });
check('scope narrows barangays', scoped.barangays.map((r) => r.id), [1, 3]);
check(
  'scope does NOT narrow the municipality list',
  scoped.municipalities.length,
  4,
);

const status = deriveLocationView({ ...base, statusFilter: 'INACTIVE' });
check('shared status narrows barangays', status.barangays.map((r) => r.id), [4]);
check('shared status narrows municipalities too', status.municipalities.map((m) => m.id), [4]);

const composed = deriveLocationView({
  ...base,
  barangaySearchQuery: 'zambales',
  selectedMunicipalityId: 1,
  statusFilter: 'ACTIVE',
});
check('search, scope, status compose in order', composed.barangays.map((r) => r.id), [1, 3]);

// ── the fixed barangay count ────────────────────────────────────────────────
check(
  'count covers every barangay of the municipality',
  all.barangayCountByMunicipality,
  { 1: 2, 2: 1, 3: 1 },
);
check(
  'count counts inactive barangays too',
  deriveLocationView({
    ...base,
    allBarangays: [
      b(term(7, 'A, Caloocan', 10_000, 1, 2), 'MM'),
      b(term(8, 'B, Caloocan', 20_000, 0, 2), 'MM'),
    ],
    allMunicipalities: [mun(2, 'Caloocan', 'MM', 1)],
  }).barangayCountByMunicipality[2],
  2,
);
check(
  'count ignores null municipality links',
  all.barangayCountByMunicipality[4],
  undefined,
);
check(
  'the active count folds from the same registry',
  deriveLocationView({
    ...base,
    allBarangays: [
      b(term(7, 'A, Caloocan', 10_000, 1, 2), 'MM'),
      b(term(8, 'B, Caloocan', 20_000, 0, 2), 'MM'),
    ],
    allMunicipalities: [mun(2, 'Caloocan', 'MM', 1)],
  }).activeBarangayCountByMunicipality[2],
  1,
);

// ── labels ──────────────────────────────────────────────────────────────────
check('singular count label', barangayCountLabel(1), '1 Barangay');
check('plural count label', barangayCountLabel(4), '4 Barangays');
check('zero count label', barangayCountLabel(0), '0 Barangays');

// The count in the section head: the bare total while nothing is hidden.
check('count label, nothing hidden', locationCountLabel(20, 20), '20');
check('count label, filter applied', locationCountLabel(2, 20), '2 of 20');
check('count label, nothing left', locationCountLabel(0, 19), '0 of 19');

// …and what it says: the noun pluralises from the TOTAL, and "-y + s" would
// print "municipalitys" — the word a screen reader reads out loud.
check(
  'count announcement pluralises from the total',
  locationCountAnnouncement(20, 20, 'barangay'),
  '20 of 20 barangays shown',
);
check(
  'count announcement keeps the full noun',
  locationCountAnnouncement(1, 19, 'municipality'),
  '1 of 19 municipalities shown',
);
check('count announcement of one', locationCountAnnouncement(1, 1, 'municipality'), '1 of 1 municipality shown');
check('count announcement of none', locationCountAnnouncement(0, 5, 'barangay'), '0 of 5 barangays shown');

// ── empty states ────────────────────────────────────────────────────────────
const searchEmpty = locationEmptyState({
  noun: 'barangays',
  hasQuery: true,
  statusFilter: 'INACTIVE',
  scope: 'Baliwag, Bulacan',
});
check('a query miss is branch 1 even with filters applied', searchEmpty.kind, 'query');
check('search-empty title', searchEmpty.title, 'NO MATCH');
check('search-empty body', searchEmpty.body, 'No barangays match that search.');
check('search-empty clears the search', searchEmpty.action, 'clearQuery');
check('search-empty labels the way out', searchEmpty.actionLabel, 'Clear the search');

const statusEmpty = locationEmptyState({
  noun: 'barangays',
  hasQuery: false,
  statusFilter: 'INACTIVE',
  scope: null,
});
check('a filter that hides every row is branch 2', statusEmpty.kind, 'filtered');
check('filtered-empty title', statusEmpty.title, 'FILTERED OUT');
check(
  'filtered-empty body',
  statusEmpty.body,
  'No barangays are INACTIVE only. They are still saved.',
);
check('filtered-empty clears everything in one tap', statusEmpty.action, 'clearFilter');

const scopedEmpty = locationEmptyState({
  noun: 'barangays',
  hasQuery: false,
  statusFilter: 'INACTIVE',
  scope: 'Baliwag, Bulacan',
});
check(
  'the filter is NAMED, scope then status',
  scopedEmpty.body,
  'No barangays are Baliwag, Bulacan and INACTIVE only. They are still saved.',
);
check('scoped-empty says the records survive', scopedEmpty.body.includes('still saved'), true);
check('a filtered list never invites a duplicate add', scopedEmpty.actionLabel, 'Clear the filter');

const nothingEmpty = locationEmptyState({
  noun: 'barangays',
  hasQuery: false,
  statusFilter: 'ALL',
  scope: null,
});
check('an empty registry is branch 3', nothingEmpty.kind, 'empty');
check('empty registry title', nothingEmpty.title, 'NOTHING HERE YET');
check(
  'empty registry body',
  nothingEmpty.body,
  'Add a barangay to create passenger ticket locations.',
);
check('an empty registry clears nothing', nothingEmpty.action, null);

const munEmpty = locationEmptyState({
  noun: 'municipalities',
  hasQuery: false,
  statusFilter: 'ALL',
  scope: null,
});
check('municipalities empty body', munEmpty.body, 'Add a municipality before assigning barangays.');
const munSearchEmpty = locationEmptyState({
  noun: 'municipalities',
  hasQuery: true,
  statusFilter: 'ALL',
  scope: null,
});
check(
  'a municipality search miss reads as one',
  munSearchEmpty.body,
  'No municipalities match that search.',
);

// ── scope menu and trigger ──────────────────────────────────────────────────
const menu = scopeMenuItems(municipalities);
check('menu leads with All Municipalities', menu[0], { id: null, label: 'All Municipalities' });
check(
  'menu lists only active municipalities, name-ordered',
  menu.map((o) => o.label),
  [
    'All Municipalities',
    'Caloocan, Metro Manila',
    'Iba, Zambales',
    'Olongapo, Zambales',
  ],
);
check(
  'inactive municipality is never offered',
  menu.some((o) => o.label.includes('Subic')),
  false,
);
check(
  'stale scope on an inactive municipality still displays',
  scopeTriggerLabel(4, municipalities),
  'Subic, Zambales',
);
check('no scope displays All Municipalities', scopeTriggerLabel(null, municipalities), 'All Municipalities');
check(
  'selected option announces its state',
  scopeOptionSelected(menu[2], 3),
  true,
);
check(
  'unselected option is not selected',
  scopeOptionSelected(menu[0], 3),
  false,
);

// ── card announcements ──────────────────────────────────────────────────────
const km = (m: number) => `${(m / 1000).toFixed(3)} km`;
const santa = barangays[1];
const subic = barangays[2];

check(
  'row value names the LINKED row',
  barangayRowValue(santa, 'Olongapo', km),
  'Olongapo · 228.000 km',
);
check(
  'row value falls back to the parsed tail when no name is linked',
  barangayRowValue(santa, null, km),
  'Olongapo · 228.000 km',
);
check(
  'an unlinked row says so instead of printing a dangling comma',
  barangayRowValue(subic, null, km),
  'Not linked · 249.600 km',
);
check(
  'an unlinked row never claims a municipality',
  barangayRowValue(subic, null, km).includes(','),
  false,
);
check(
  'municipality row value is province and count',
  municipalityRowValue(mun(1, 'Olongapo', 'Zambales', 1), 2),
  'Zambales · 2 barangays',
);
check(
  'municipality row value singular',
  municipalityRowValue(mun(2, 'Baliwag', 'Bulacan', 1), 1),
  'Bulacan · 1 barangay',
);

check(
  'the sheet subtitle names the linked municipality',
  barangayDetailSubtitle(santa, 'Olongapo City'),
  'Santa Cruz, Olongapo City',
);
check(
  'an unlinked row keeps its parsed tail, never a trailing comma',
  barangayDetailSubtitle(subic, null),
  'Subic, Subic',
);

check(
  'the detail sheet prints the stored values, unlinked first',
  barangayDetailPairs(subic, null, km),
  [
    { label: 'Municipality', value: 'Not linked' },
    { label: 'Registered KM', value: '249.600 km' },
    { label: 'Status', value: 'INACTIVE' },
    { label: 'Barangay ID', value: '4' },
  ],
);
check(
  'the detail sheet names the linked municipality with its province',
  barangayDetailPairs(santa, 'Olongapo', km)[0],
  { label: 'Municipality', value: 'Olongapo, Zambales' },
);
check(
  'the municipality detail sheet carries both counts',
  municipalityDetailPairs(mun(1, 'Olongapo', 'Zambales', 1), 2, 1),
  [
    { label: 'Province', value: 'Zambales' },
    { label: 'Barangays', value: '2 Barangays' },
    { label: 'Active barangays', value: '1' },
    { label: 'Status', value: 'ACTIVE' },
    { label: 'Municipality ID', value: '1' },
  ],
);

check(
  'the row announces what pressing does, not two actions it does not own',
  recordAnnouncement('Santa Cruz', 'Olongapo · 228.000 km', true),
  'Santa Cruz, Olongapo · 228.000 km. Active. Opens the record.',
);
check(
  'an inactive row still announces one action',
  recordAnnouncement('Subic', 'Not linked · 249.600 km', false),
  'Subic, Not linked · 249.600 km. Inactive. Opens the record.',
);
check(
  'the derivation folds the linked names every caption reads',
  [
    all.municipalityNameById[1],
    all.municipalityNameById[2],
    all.municipalityNameById[4],
  ],
  ['Olongapo', 'Caloocan', 'Subic'],
);
check(
  'scope trigger announcement carries the applied value',
  scopeTriggerAnnouncement('All Municipalities'),
  'Filter by municipality, All Municipalities',
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
