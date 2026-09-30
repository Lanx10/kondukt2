import type { MunicipalityRowRecord } from '../data/schema';
import { toBarangayRow, type BarangayRow } from './barangayPickerState';

/**
 * The Barangay Configuration screen's pure logic.
 *
 * One screen, two tabs, and the three behaviors a careless port gets wrong.
 * First, the SHARED status filter: one selection narrows both tabs' lists,
 * because it lives above them, not inside either. Second, the totals: both
 * section counts read the unfiltered collections, so no search, scope, or
 * status filter can shrink them. Third, the municipality card's barangay
 * count: it counts the municipality's barangays from the UNFILTERED
 * collection — the existing implementation read it from the filtered list,
 * which made the number move with a search query while nothing about the
 * municipality had changed. That bug is fixed here, and the count includes
 * inactive barangays: a deactivated stop still exists and still shows in
 * history, so it still belongs to its municipality.
 *
 * The stop registry is this port's `terminals` table — the same rows the
 * Barangay Picker, Add Trip, and the ticket flow read — so this module maps
 * them with the picker's own helpers (`toBarangayRow`, `locationLabel`)
 * rather than keeping a second parser. Province comes from the linked
 * municipality row, which the flat terminal name cannot carry.
 */

export type LocationTab = 'BARANGAYS' | 'MUNICIPALITIES';
export type LocationStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

/** A stop plus the province and municipality link its registry row lacks. */
export type ConfigBarangayRow = BarangayRow & {
  province: string;
  municipalityId: number | null;
};

export type MunicipalityRow = MunicipalityRowRecord;

/**
 * The screen's whole visible state. The two search fields, the scope, and
 * the status filter all live here — never in a global store — so re-entering
 * the screen shows the barangays tab, empty queries, no scope, and ALL.
 */
export type LocationConfigurationUiState = {
  selectedTab: LocationTab;
  barangays: ConfigBarangayRow[];
  municipalities: MunicipalityRow[];
  allBarangays: ConfigBarangayRow[];
  allMunicipalities: MunicipalityRow[];
  barangaySearchQuery: string;
  municipalitySearchQuery: string;
  selectedMunicipalityId: number | null;
  statusFilter: LocationStatusFilter;
  isLoading: boolean;
  loadError: string | null;
  message: string | null;
};

/** The screen opens on the barangays tab with every control at its default. */
export function initialLocationUiState(): LocationConfigurationUiState {
  return {
    selectedTab: 'BARANGAYS',
    barangays: [],
    municipalities: [],
    allBarangays: [],
    allMunicipalities: [],
    barangaySearchQuery: '',
    municipalitySearchQuery: '',
    selectedMunicipalityId: null,
    statusFilter: 'ALL',
    isLoading: true,
    loadError: null,
    message: null,
  };
}

/** Terminal row + linked municipality (or null) → the config screen's row. */
export function toConfigBarangayRow(
  terminal: import('../data/schema').TerminalRowRecord,
  province: string,
): ConfigBarangayRow {
  const base = toBarangayRow(terminal);
  return {
    ...base,
    province,
    municipalityId: terminal.municipality_id ?? null,
  };
}

// ── Filters ─────────────────────────────────────────────────────────────────

/**
 * Barangay search: barangay name, municipality name, and province — three
 * case-insensitive substring checks, query trimmed first. The KM marker is
 * deliberately NOT matched here: the Barangay Picker searches KM because a
 * conductor types a marker while selecting a stop; this is a management list.
 */
export function filterBarangaysBySearch(
  rows: ConfigBarangayRow[],
  query: string,
): ConfigBarangayRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter(
    (row) =>
      row.barangayName.toLowerCase().includes(needle) ||
      row.municipalityName.toLowerCase().includes(needle) ||
      row.province.toLowerCase().includes(needle),
  );
}

/** Municipality search: name and province only. Blank matches everything. */
export function filterMunicipalitiesBySearch(
  rows: MunicipalityRow[],
  query: string,
): MunicipalityRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      row.province.toLowerCase().includes(needle),
  );
}

/** The scope: barangays whose municipality link matches, or everything. */
export function scopeBarangays(
  rows: ConfigBarangayRow[],
  municipalityId: number | null,
): ConfigBarangayRow[] {
  if (municipalityId === null) return rows;
  return rows.filter((row) => row.municipalityId === municipalityId);
}

/** The shared status filter: ALL passes through, otherwise the flag decides. */
export function filterByStatus<T extends { isActive: boolean } | { is_active: number }>(
  rows: T[],
  status: LocationStatusFilter,
): T[] {
  if (status === 'ALL') return rows;
  const active = status === 'ACTIVE';
  return rows.filter((row) =>
    'isActive' in row ? row.isActive === active : (row.is_active === 1) === active,
  );
}

// ── Ordering (after filtering, never before) ────────────────────────────────

/** KM marker ascending, then barangay NAME ascending — the name, not the id. */
export function sortBarangaysByRoute(rows: ConfigBarangayRow[]): ConfigBarangayRow[] {
  return [...rows].sort(
    (a, b) =>
      a.kmMarker - b.kmMarker ||
      a.barangayName.localeCompare(b.barangayName),
  );
}

/** Municipalities order by name ascending, and by nothing else. */
export function sortMunicipalitiesByName(rows: MunicipalityRow[]): MunicipalityRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Derivation ──────────────────────────────────────────────────────────────

export type DerivedLocationView = {
  /** Search → scope → status → sort. The barangays tab's list. */
  barangays: ConfigBarangayRow[];
  /** Search → status → sort. No scope here — a scope on the barangays tab
   * never hides a municipality from its own tab. */
  municipalities: MunicipalityRow[];
  /** Both totals read the unfiltered collections. */
  totalBarangays: number;
  totalMunicipalities: number;
  /** Per-municipality barangay counts from the UNFILTERED collection,
   * inactive barangays included — the fixed count, not the filtered one. */
  barangayCountByMunicipality: Record<number, number>;
  /** The same fold's second number: how many of those are still ACTIVE. The
   * detail sheet states both, and both have to come from one registry. */
  activeBarangayCountByMunicipality: Record<number, number>;
  /** The LINKED municipality's own name, by id. The stop string's parsed tail
   * and the municipality row can disagree ("Olongapo" vs "Olongapo City");
   * every caption reads THIS one so it can never disagree with the filter. */
  municipalityNameById: Record<number, string>;
};

export function deriveLocationView(input: {
  allBarangays: ConfigBarangayRow[];
  allMunicipalities: MunicipalityRow[];
  barangaySearchQuery: string;
  municipalitySearchQuery: string;
  selectedMunicipalityId: number | null;
  statusFilter: LocationStatusFilter;
}): DerivedLocationView {
  const barangays = sortBarangaysByRoute(
    filterByStatus(
      scopeBarangays(
        filterBarangaysBySearch(input.allBarangays, input.barangaySearchQuery),
        input.selectedMunicipalityId,
      ),
      input.statusFilter,
    ),
  );
  const municipalities = sortMunicipalitiesByName(
    filterByStatus(
      filterMunicipalitiesBySearch(input.allMunicipalities, input.municipalitySearchQuery),
      input.statusFilter,
    ),
  );
  const barangayCountByMunicipality: Record<number, number> = {};
  const activeBarangayCountByMunicipality: Record<number, number> = {};
  for (const row of input.allBarangays) {
    if (row.municipalityId === null) continue;
    barangayCountByMunicipality[row.municipalityId] =
      (barangayCountByMunicipality[row.municipalityId] ?? 0) + 1;
    if (row.isActive) {
      activeBarangayCountByMunicipality[row.municipalityId] =
        (activeBarangayCountByMunicipality[row.municipalityId] ?? 0) + 1;
    }
  }
  const municipalityNameById: Record<number, string> = {};
  for (const municipality of input.allMunicipalities) {
    municipalityNameById[municipality.id] = municipality.name;
  }
  return {
    barangays,
    municipalities,
    totalBarangays: input.allBarangays.length,
    totalMunicipalities: input.allMunicipalities.length,
    barangayCountByMunicipality,
    activeBarangayCountByMunicipality,
    municipalityNameById,
  };
}

// ── Copy ────────────────────────────────────────────────────────────────────

/** "<n> Barangay" / "<n> Barangays" — never "1 Barangays". Title case, for
 *  the detail sheet's own labels, where it sits beside "Province" and "Status". */
export function barangayCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'Barangay' : 'Barangays'}`;
}

/**
 * The count in the section head: the bare total while nothing is hidden, and
 * "<shown> of <total>" the moment a filter narrows the list. The total never
 * renames itself with the filter — it is the size of the collection, and the
 * number beside it says how much of that collection is on screen right now.
 */
export function locationCountLabel(shown: number, total: number): string {
  return shown === total ? String(total) : `${shown} of ${total}`;
}

/**
 * What that count SAYS. The noun pluralises from the TOTAL — never from the
 * shown count, and never by appending a bare "s": "1 of 19 municipalities",
 * not "1 of 19 municipalitys". The second word is the one a filter changes
 * least and the one a screen reader reads out loud.
 */
export function locationCountAnnouncement(
  shown: number,
  total: number,
  noun: 'barangay' | 'municipality' | 'terminal',
): string {
  const many = noun === 'barangay' ? 'barangays' : noun === 'terminal' ? 'terminals' : 'municipalities';
  return `${shown} of ${total} ${total === 1 ? noun : many} shown`;
}

export type LocationEmptyAction = 'clearQuery' | 'clearFilter';

/**
 * Three causes, three shapes — and the ORDER is the decision:
 *
 *   1. a present query is a search miss. Nothing is wrong with the registry,
 *      so the way out is "Clear the search", and there is no add invitation.
 *   2. no query, but a scope or the shared status filter hid every row. The
 *      filter is NAMED, the sentence says the records are still saved, and one
 *      tap clears all four controls. This is the branch the source screen did
 *      not have, and the one that invites a duplicate add for rows that exist.
 *   3. an empty registry. Nothing exists — the ADD pill in the section head is
 *      the way in, and it is already on screen, so this shape adds no action.
 *
 * The old screen stopped at two shapes and called both "No Barangays found",
 * which is how a filtered-out list reads as a missing one.
 */
export type LocationEmptyState = {
  kind: 'query' | 'filtered' | 'empty';
  title: string;
  body: string;
  /** Which control puts the rows back; null when there is nothing to clear. */
  action: LocationEmptyAction | null;
  actionLabel: string | null;
};

export function locationEmptyState(input: {
  noun: 'barangays' | 'municipalities';
  hasQuery: boolean;
  statusFilter: LocationStatusFilter;
  /** The applied scope label — null on the municipalities tab and with no scope. */
  scope: string | null;
}): LocationEmptyState {
  const { noun, hasQuery, statusFilter, scope } = input;
  if (hasQuery) {
    return {
      kind: 'query',
      title: 'NO MATCH',
      body: `No ${noun} match that search.`,
      action: 'clearQuery',
      actionLabel: 'Clear the search',
    };
  }
  if (statusFilter !== 'ALL' || scope !== null) {
    const bits: string[] = [];
    if (scope !== null) bits.push(scope);
    if (statusFilter !== 'ALL') bits.push(`${statusFilter} only`);
    return {
      kind: 'filtered',
      title: 'FILTERED OUT',
      body: `No ${noun} are ${bits.join(' and ')}. They are still saved.`,
      action: 'clearFilter',
      actionLabel: 'Clear the filter',
    };
  }
  return {
    kind: 'empty',
    title: 'NOTHING HERE YET',
    body:
      noun === 'barangays'
        ? 'Add a barangay to create passenger ticket locations.'
        : 'Add a municipality before assigning barangays.',
    action: null,
    actionLabel: null,
  };
}

// ── Scope menu and trigger ──────────────────────────────────────────────────

export type ScopeOption = { id: number | null; label: string };

/**
 * "All Municipalities", then one item per ACTIVE municipality, name-ordered —
 * the same order the tab's list uses, so the menu does not jump when a row
 * deactivates. An inactive municipality is never offered; a stale scope on
 * one still displays via `scopeTriggerLabel` but cannot be re-selected.
 */
export function scopeMenuItems(allMunicipalities: MunicipalityRow[]): ScopeOption[] {
  return [
    { id: null, label: 'All Municipalities' },
    ...sortMunicipalitiesByName(allMunicipalities)
      .filter((m) => m.is_active === 1)
      .map((m) => ({ id: m.id, label: `${m.name}, ${m.province}` })),
  ];
}

/** The trigger's value: "All Municipalities", or "<name>, <province>" — an
 * inactive-but-selected municipality still names itself here. */
export function scopeTriggerLabel(
  selectedMunicipalityId: number | null,
  allMunicipalities: MunicipalityRow[],
): string {
  if (selectedMunicipalityId === null) return 'All Municipalities';
  const selected = allMunicipalities.find((m) => m.id === selectedMunicipalityId);
  return selected ? `${selected.name}, ${selected.province}` : 'All Municipalities';
}

/** Menu options announce their selected state; the "All" entry uses null. */
export function scopeOptionSelected(
  option: ScopeOption,
  selectedMunicipalityId: number | null,
): boolean {
  return option.id === selectedMunicipalityId;
}

// ── One row shape, one sheet ────────────────────────────────────────────────

/** "1 barangay" / "3 barangays", sentence case, for the row's value line. */
function barangayCountLine(count: number): string {
  return `${count} ${count === 1 ? 'barangay' : 'barangays'}`;
}

/**
 * The row's second line: the answer to the question the row raises.
 *
 * The name comes from the LINKED municipality row, never from the tail parsed
 * out of the stop string — the stop says "Barangay 1, Olongapo" where the
 * municipality row says "Olongapo City", and the caption and the scope filter
 * above the list have to be able to never disagree about which one it belongs
 * to. An unlinked row says so in words instead of printing a dangling comma.
 */
export function barangayRowValue(
  row: ConfigBarangayRow,
  linkedMunicipalityName: string | null,
  formatKm: (milliKm: number) => string,
): string {
  if (row.municipalityId === null) return `Not linked · ${formatKm(row.kmMarker)}`;
  const name = linkedMunicipalityName ?? row.municipalityName;
  return name === '' ? formatKm(row.kmMarker) : `${name} · ${formatKm(row.kmMarker)}`;
}

/** A municipality's line is its province and the count it owns. */
export function municipalityRowValue(
  municipality: MunicipalityRow,
  barangayCount: number,
): string {
  return `${municipality.province} · ${barangayCountLine(barangayCount)}`;
}

/**
 * ONE announcement for ONE shape of record: name, value, state, what pressing
 * does. The row carries no actions — they live in the sheet it opens — so an
 * announcement that offers Edit and Deactivate promises two things the row
 * itself will not do.
 */
export function recordAnnouncement(title: string, value: string, isActive: boolean): string {
  return `${title}, ${value}. ${isActive ? 'Active' : 'Inactive'}. Opens the record.`;
}

/** The sheet's subtitle: "Barangay 1, Olongapo City" — linked name when there
 *  is one, the parsed tail when there is not, and never a trailing comma. */
export function barangayDetailSubtitle(
  row: ConfigBarangayRow,
  linkedMunicipalityName: string | null,
): string {
  const muni =
    row.municipalityId === null
      ? row.municipalityName
      : (linkedMunicipalityName ?? row.municipalityName);
  return muni === '' ? row.barangayName : `${row.barangayName}, ${muni}`;
}

export type DetailPair = { label: string; value: string };

/** The stored values the row reads, as label/value pairs. Nothing here writes. */
export function barangayDetailPairs(
  row: ConfigBarangayRow,
  linkedMunicipalityName: string | null,
  formatKm: (milliKm: number) => string,
): DetailPair[] {
  const municipality =
    row.municipalityId === null || linkedMunicipalityName === null
      ? 'Not linked'
      : row.province === ''
        ? linkedMunicipalityName
        : `${linkedMunicipalityName}, ${row.province}`;
  return [
    { label: 'Municipality', value: municipality },
    { label: 'Registered KM', value: formatKm(row.kmMarker) },
    { label: 'Status', value: row.isActive ? 'ACTIVE' : 'INACTIVE' },
    { label: 'Barangay ID', value: String(row.id) },
  ];
}

/** The same five slots for a municipality, with its real, unfiltered counts. */
export function municipalityDetailPairs(
  municipality: MunicipalityRow,
  barangayCount: number,
  activeBarangayCount: number,
): DetailPair[] {
  return [
    { label: 'Province', value: municipality.province },
    { label: 'Barangays', value: barangayCountLabel(barangayCount) },
    { label: 'Active barangays', value: String(activeBarangayCount) },
    { label: 'Status', value: municipality.is_active === 1 ? 'ACTIVE' : 'INACTIVE' },
    { label: 'Municipality ID', value: String(municipality.id) },
  ];
}

/** The scope trigger's merged reading: the control, then the applied value. */
export function scopeTriggerAnnouncement(appliedLabel: string): string {
  return `Filter by municipality, ${appliedLabel}`;
}
