import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';

/**
 * Pure Terminal Configuration logic: the view derivation, the row's copy, and
 * the empty-state choice.
 *
 * No React, no SQLite. The derivation order is the contract: the total counts
 * the whole collection, then the active-state filter applies, then the search,
 * then the route-order sort. Sorting before filtering would reorder a view the
 * conductor reads top-to-bottom as the route; filtering the total would break
 * the deliberate "count of the collection" rule.
 *
 * THE SPLIT IS DECIDED HERE, ON THE FIRST COMMA. `terminals.name` stores the
 * composed string `name + ', ' + municipalityName` (add-terminal.html writes
 * it, the seed writes it), so every reader has to split it — and this suite
 * already carries two splitters that disagree: `barangayPickerState`
 * `municipalityNameOf` cuts the FIRST comma, `passengerState.municipalityOf`
 * cuts the LAST. Neither is copied in. First comma is the boundary, written
 * down beside its siblings, because a name can itself contain no comma.
 * Displaying a terminal's municipality does NOT parse at all: the row carries
 * `municipality_id`, the screen joins it, and the splitters exist only for the
 * title and for the search haystack.
 */

export type TerminalFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

/** The menu's three options, in the fixed order, with copy verbatim. */
export const TERMINAL_FILTERS: { value: TerminalFilter; label: string }[] = [
  { value: 'ALL', label: 'ALL' },
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'INACTIVE', label: 'INACTIVE' },
];

/** The composed name's first half — the row's title. First comma, trimmed. */
export function terminalNameOf(name: string): string {
  const i = name.indexOf(',');
  return i === -1 ? name.trim() : name.slice(0, i).trim();
}

/**
 * The composed name's tail. Search and the sheet's provenance line only —
 * never a substitute for the joined row when the id resolves.
 */
export function terminalMunicipalityNameOf(name: string): string {
  const i = name.indexOf(',');
  return i === -1 ? '' : name.slice(i + 1).trim();
}

/**
 * Thousandths of a km → the one decimal the registry prints: `232400` reads
 * `232.4 KM`. This is also what search matches — the marker as the driver
 * reads it, never the stored thousandths.
 */
export function formatMarkerKm(milliKm: number): string {
  return `${(milliKm / 1000).toFixed(1)} KM`;
}

/** The chrome sub-line: total and active, two numbers, one string. */
export function terminalChromeSubtitle(total: number, active: number): string {
  const word = total === 1 ? 'terminal' : 'terminals';
  return `${total} ${word} · ${active} active`;
}

/**
 * The row's municipality, from the JOIN — `name, province` — or '' when the
 * link is null or resolves to nothing. The composed name's tail is never a
 * fallback here: an unlinked row says so.
 */
export function terminalCaption(
  terminal: TerminalRowRecord,
  allMunicipalities: MunicipalityRowRecord[],
): string {
  if (terminal.municipality_id === null) return '';
  const linked = allMunicipalities.find((m) => m.id === terminal.municipality_id);
  return linked ? `${linked.name}, ${linked.province}` : '';
}

/**
 * The row's second line: the municipality the reference prints, then the
 * marker. The LINKED row's NAME wins; a row with no link still names the
 * municipality its own composed string carries (the seed is not
 * information-free), and only a row with neither says `Not linked`.
 */
export function terminalRowValue(
  terminal: TerminalRowRecord,
  allMunicipalities: MunicipalityRowRecord[],
): string {
  const linked = allMunicipalities.find((m) => m.id === terminal.municipality_id);
  const muni = linked ? linked.name : terminalMunicipalityNameOf(terminal.name);
  return `${muni === '' ? 'Not linked' : muni} · ${formatMarkerKm(terminal.km_marker)}`;
}

/**
 * Search: title, the composed tail, the JOINED caption, and the marker as
 * printed. Four needles because a driver who remembers `232.4` must find the
 * row printed `232.4 KM` — the stored `232400` is not a value they ever see.
 * Blank matches everything.
 */
export function filterTerminalsByName(
  terminals: TerminalRowRecord[],
  query: string,
  allMunicipalities: MunicipalityRowRecord[],
): TerminalRowRecord[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return terminals;
  return terminals.filter((terminal) =>
    [
      terminalNameOf(terminal.name),
      terminalMunicipalityNameOf(terminal.name),
      terminalCaption(terminal, allMunicipalities),
      formatMarkerKm(terminal.km_marker),
    ].some((part) => part.toLowerCase().includes(needle)),
  );
}

/** ALL passes everything; ACTIVE and INACTIVE read the stored flag. */
export function filterTerminalsByState(
  terminals: TerminalRowRecord[],
  filter: TerminalFilter,
): TerminalRowRecord[] {
  if (filter === 'ALL') return terminals;
  const wantActive = filter === 'ACTIVE' ? 1 : 0;
  return terminals.filter((terminal) => terminal.is_active === wantActive);
}

/**
 * KM marker ascending, then the terminal NAME — never by id. Two terminals at
 * one marker are two stops at the same place; id order is "which row the
 * insert happened to produce", and an added row must sort among the seed by
 * where it sits on the route, not by when it was typed. This is the order the
 * trip reader uses.
 */
export function sortTerminalsByRoute(
  terminals: TerminalRowRecord[],
): TerminalRowRecord[] {
  return [...terminals].sort(
    (a, b) =>
      a.km_marker - b.km_marker ||
      terminalNameOf(a.name).localeCompare(terminalNameOf(b.name)),
  );
}

/**
 * The full derivation. `total` and `active` are always unfiltered collection
 * facts — search and filter hide rows, they do not shrink the counts.
 */
export function deriveTerminalView(
  terminals: TerminalRowRecord[],
  query: string,
  filter: TerminalFilter,
  allMunicipalities: MunicipalityRowRecord[],
): { total: number; active: number; rows: TerminalRowRecord[] } {
  return {
    total: terminals.length,
    active: terminals.filter((terminal) => terminal.is_active === 1).length,
    rows: sortTerminalsByRoute(
      filterTerminalsByName(filterTerminalsByState(terminals, filter), query, allMunicipalities),
    ),
  };
}

// ── Empty state ─────────────────────────────────────────────────────────────

export type TerminalEmptyState =
  | { kind: 'search'; title: string; body: string }
  | { kind: 'filter'; title: string; body: string }
  | { kind: 'nothing'; title: string; body: string };

/**
 * Chooses the empty state — the reference's three shapes, in fixed order:
 * a present query is a search miss, a filter that emptied the list NAMES the
 * filter and says the records are still saved, and only an empty registry
 * invites a duplicate add (via the section head's pill, not this block).
 * The search case wins over the filter case when both are active.
 */
export function terminalEmptyState(
  hasQuery: boolean,
  filter: TerminalFilter,
): TerminalEmptyState {
  if (hasQuery) {
    return {
      kind: 'search',
      title: 'NO MATCH',
      body: 'No terminal matches that search.',
    };
  }
  if (filter !== 'ALL') {
    return {
      kind: 'filter',
      title: 'FILTERED OUT',
      body: `No terminals are ${filter}. They are still saved.`,
    };
  }
  return {
    kind: 'nothing',
    title: 'NOTHING HERE YET',
    body: 'Add a terminal to mark where trips start and end.',
  };
}

// ── Row and sheet copy ──────────────────────────────────────────────────────

/**
 * The row announcement: the title once, the value (municipality + marker)
 * once, the state once — the pill is the source, the rest never repeats it —
 * and what pressing does. The row carries no actions; they live in the sheet
 * it opens, so nothing here may promise an Edit or a Deactivate.
 */
export function terminalCardAnnouncement(
  terminal: TerminalRowRecord,
  value: string,
): string {
  const state = terminal.is_active === 1 ? 'Active' : 'Inactive';
  return `${terminalNameOf(terminal.name)}, ${value}. ${state}. Opens the record.`;
}

/** The sheet's subtitle: the joined name, else the name's own tail, else the honest fallback. */
export function terminalSheetSubtitle(
  terminal: TerminalRowRecord,
  allMunicipalities: MunicipalityRowRecord[],
): string {
  const caption = terminalCaption(terminal, allMunicipalities);
  if (caption !== '') return caption.split(',')[0].trim();
  const tail = terminalMunicipalityNameOf(terminal.name);
  return tail === '' ? 'Terminal' : tail;
}

export type TerminalDetailPair = { label: string; value: string };

/**
 * The stored values the record sheet reads. The municipality line has to agree
 * with the row it was opened from AND say where the value came from: the JOIN
 * prints `name, province`; a row with no link still names the municipality its
 * own composed string carries, flagged as such — and a row with neither says
 * `Not linked` rather than inventing one.
 */
export function terminalDetailPairs(
  terminal: TerminalRowRecord,
  allMunicipalities: MunicipalityRowRecord[],
): TerminalDetailPair[] {
  const linked = terminalCaption(terminal, allMunicipalities);
  const tail = terminalMunicipalityNameOf(terminal.name);
  const municipality =
    linked !== ''
      ? linked
      : tail === ''
        ? 'Not linked'
        : `${tail} (from the terminal name)`;
  return [
    { label: 'Municipality', value: municipality },
    { label: 'Registered KM', value: formatMarkerKm(terminal.km_marker) },
    { label: 'Status', value: terminal.is_active === 1 ? 'ACTIVE' : 'INACTIVE' },
    { label: 'Terminal ID', value: String(terminal.id) },
  ];
}
