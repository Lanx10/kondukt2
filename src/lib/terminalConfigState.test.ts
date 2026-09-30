import {
  deriveTerminalView,
  filterTerminalsByName,
  filterTerminalsByState,
  formatMarkerKm,
  sortTerminalsByRoute,
  terminalCaption,
  terminalCardAnnouncement,
  terminalChromeSubtitle,
  terminalDetailPairs,
  terminalEmptyState,
  terminalMunicipalityNameOf,
  terminalNameOf,
  terminalRowValue,
  terminalSheetSubtitle,
} from './terminalConfigState';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';

/**
 * Self-check for the Terminal Configuration derivation, the join, and the
 * empty states.
 *
 * Run with: npx tsx src/lib/terminalConfigState.test.ts
 *
 * The fragile parts: the total and active counts never follow the filter, the
 * sort is route order with the NAME as tiebreak, search matches the marker as
 * printed (`228.0`, never `228000`) and the JOINED municipality, an unlinked
 * row falls back to its own composed tail before it says `Not linked`, and
 * the three empty states stay distinct with search winning over filter.
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

const munis: MunicipalityRowRecord[] = [
  { id: 1, name: 'Olongapo', province: 'Zambales', is_active: 1 },
  { id: 2, name: 'Iba', province: 'Zambales', is_active: 1 },
];

const t = (
  id: number,
  name: string,
  km: number,
  active: 0 | 1,
  municipalityId: number | null = null,
): TerminalRowRecord =>
  ({
    id,
    name,
    km_marker: km,
    is_active: active,
    municipality_id: municipalityId,
  }) as TerminalRowRecord;

const terminals = [
  t(3, 'Caloocan, Kalakhang Maynila', 314_200, 1, null),
  t(1, 'Santa Cruz, Olongapo', 228_000, 1, 1),
  t(4, 'Iba, Zambales', 96_800, 0, 2),
  t(2, 'Subic, Zambales', 150_000, 1, null),
  // The join proves itself: tail "Poblacion", linked name "Olongapo".
  t(5, 'Dau, Poblacion', 50_000, 1, 1),
];

// ── the splitters, decided once on the first comma ─────────────────────────
check('title is before the first comma', terminalNameOf('Santa Cruz, Olongapo'), 'Santa Cruz');
check('tail is after the first comma', terminalMunicipalityNameOf('Santa Cruz, Olongapo'), 'Olongapo');
check('a comma-less name passes both', [terminalNameOf('Subic'), terminalMunicipalityNameOf('Subic')], ['Subic', '']);

// ── the marker, as printed ─────────────────────────────────────────────────
check('marker renders one decimal + KM', formatMarkerKm(232_400), '232.4 KM');

// ── the join ───────────────────────────────────────────────────────────────
check(
  'linked caption is name, province from the id',
  terminalCaption(t(1, 'Santa Cruz, Olongapo', 228_000, 1, 1), munis),
  'Olongapo, Zambales',
);
check('null link captions nothing', terminalCaption(t(2, 'Subic, Zambales', 150_000, 1, null), munis), '');
check('an unresolved link captions nothing, never a parse', terminalCaption(t(9, 'Dau, Poblacion', 1, 1, 99), munis), '');
check(
  'row value uses the linked name, then the marker',
  terminalRowValue(t(1, 'Santa Cruz, Olongapo', 228_000, 1, 1), munis),
  'Olongapo · 228.0 KM',
);
check(
  'an unlinked row still names the municipality its own tail carries',
  terminalRowValue(t(2, 'Subic, Zambales', 150_000, 1, null), munis),
  'Zambales · 150.0 KM',
);
check(
  'a row with neither link nor tail says Not linked',
  terminalRowValue(t(6, 'Dau', 50_000, 1, null), munis),
  'Not linked · 50.0 KM',
);

// ── derivation ─────────────────────────────────────────────────────────────
const view = deriveTerminalView(terminals, '', 'ALL', munis);
check('total counts the whole collection', view.total, 5);
check('active counts the whole collection', view.active, 4);
check(
  'route order: km asc',
  view.rows.map((r) => r.id),
  [5, 4, 2, 1, 3],
);
check('chrome sub-line is total and active', terminalChromeSubtitle(view.total, view.active), '5 terminals · 4 active');
check('chrome sub-line singularises', terminalChromeSubtitle(1, 0), '1 terminal · 0 active');

const filteredView = deriveTerminalView(terminals, '', 'ACTIVE', munis);
check('filter hides inactive rows', filteredView.rows.map((r) => r.id), [5, 2, 1, 3]);
check('total does not follow the filter', filteredView.total, 5);
check('active does not follow the filter', filteredView.active, 4);

const searched = deriveTerminalView(terminals, 'zam', 'ALL', munis);
check('search matches the composed tail and the joined caption', searched.rows.map((r) => r.id), [5, 4, 2, 1]);
check('total does not follow the search', searched.total, 5);

check(
  'filter and search compose',
  deriveTerminalView(terminals, 'zam', 'ACTIVE', munis).rows.map((r) => r.id),
  [5, 2, 1],
);
check(
  'the marker matches as printed, in KM',
  deriveTerminalView(terminals, '228.0', 'ALL', munis).rows.map((r) => r.id),
  [1],
);
check(
  'the stored thousandths are never matched',
  deriveTerminalView(terminals, '228000', 'ALL', munis).rows.length,
  0,
);
check(
  'the joined municipality name matches even when the tail disagrees',
  deriveTerminalView(terminals, 'olongapo', 'ALL', munis).rows.map((r) => r.id).includes(5),
  true,
);
check(
  'blank matches everything',
  deriveTerminalView(terminals, '   ', 'ALL', munis).rows.length,
  5,
);

// ── empty states ───────────────────────────────────────────────────────────
const searchEmpty = terminalEmptyState(true, 'ACTIVE');
check('search empty wins over filter', searchEmpty.kind, 'search');
check('search empty body', searchEmpty.body, 'No terminal matches that search.');

const filterEmpty = terminalEmptyState(false, 'ACTIVE');
check('filter empty names the status verbatim', filterEmpty.body, 'No terminals are ACTIVE. They are still saved.');
check(
  'inactive filter word',
  terminalEmptyState(false, 'INACTIVE').body,
  'No terminals are INACTIVE. They are still saved.',
);

const nothingEmpty = terminalEmptyState(false, 'ALL');
check(
  'nothing-configured body',
  nothingEmpty.body,
  'Add a terminal to mark where trips start and end.',
);
check('three distinct titles', [searchEmpty.title, filterEmpty.title, nothingEmpty.title], [
  'NO MATCH',
  'FILTERED OUT',
  'NOTHING HERE YET',
]);

// ── announcement ───────────────────────────────────────────────────────────
check(
  'announcement is title, value, state, what pressing does',
  terminalCardAnnouncement(
    t(1, 'Santa Cruz, Olongapo', 228_000, 1, 1),
    'Olongapo, Zambales · 228.0 KM',
  ),
  'Santa Cruz, Olongapo, Zambales · 228.0 KM. Active. Opens the record.',
);
check(
  'inactive announcement states Inactive once',
  terminalCardAnnouncement(t(4, 'Iba, Zambales', 96_800, 0, 2), 'Iba, Zambales · 96.8 KM'),
  'Iba, Iba, Zambales · 96.8 KM. Inactive. Opens the record.',
);

// ── sheet copy ─────────────────────────────────────────────────────────────
check('sheet subtitle is the joined name', terminalSheetSubtitle(t(1, 'Santa Cruz, Olongapo', 228_000, 1, 1), munis), 'Olongapo');
check('sheet subtitle falls back to the tail', terminalSheetSubtitle(t(2, 'Subic, Zambales', 150_000, 1, null), munis), 'Zambales');
check('sheet subtitle with neither says Terminal', terminalSheetSubtitle(t(6, 'Dau', 1, 1, null), munis), 'Terminal');

check(
  'detail pairs name the join',
  terminalDetailPairs(t(1, 'Santa Cruz, Olongapo', 228_000, 1, 1), munis),
  [
    { label: 'Municipality', value: 'Olongapo, Zambales' },
    { label: 'Registered KM', value: '228.0 KM' },
    { label: 'Status', value: 'ACTIVE' },
    { label: 'Terminal ID', value: '1' },
  ],
);
check(
  'an unlinked row keeps its own tail, flagged as sourced from the name',
  terminalDetailPairs(t(2, 'Subic, Zambales', 150_000, 1, null), munis)[0],
  { label: 'Municipality', value: 'Zambales (from the terminal name)' },
);
check(
  'a row with neither link nor tail says Not linked',
  terminalDetailPairs(t(6, 'Dau', 1, 1, null), munis)[0],
  { label: 'Municipality', value: 'Not linked' },
);

// ── helpers directly ───────────────────────────────────────────────────────
check('name filter trims', filterTerminalsByName(terminals, '  santa ', munis).length, 1);
check('state filter reads the flag', filterTerminalsByState(terminals, 'INACTIVE').map((r) => r.id), [4]);
check(
  'sort is stable on equal km by NAME, not id',
  sortTerminalsByRoute([t(9, 'Bravo, X', 100_000, 1), t(8, 'Alpha, X', 100_000, 1)]).map((r) => r.id),
  [8, 9],
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
