import type { PassengerType, TripRowRecord } from '../data/schema';
import { plural } from './currentTripState';

/**
 * Pure Passenger screen logic.
 *
 * No React, no SQLite — the aggregation, the snapshot parsing, the selection
 * fallback and the search are the parts a second implementation gets wrong, so
 * they live here where plain `tsx` can test them. The screen renders these
 * facts; it does not re-derive them.
 *
 * Privacy rule, enforced structurally: nothing in this module accepts or
 * returns a passenger name, because the store has none. A "passenger" here is
 * a quantity on a ticket; the finest identity this screen can express is a
 * municipality pair.
 */

// ── Shape ───────────────────────────────────────────────────────────────────

export type PassengerFilter = 'ALL' | 'REGULAR' | 'STUDENT' | 'SENIOR' | 'PWD';

/** The SQL side of the filter: ALL clears the passenger_type clause entirely. */
export type SqlPassengerFilter = PassengerType | null;

/** ALL → NULL: no passenger_type predicate at all, not `= ALL`. */
export function toSqlFilter(filter: PassengerFilter): SqlPassengerFilter {
  switch (filter) {
    case 'ALL':
      return null;
    case 'REGULAR':
      return 'REGULAR';
    case 'STUDENT':
      return 'STUDENT';
    case 'SENIOR':
      return 'SENIOR_CITIZEN';
    case 'PWD':
      return 'PWD';
  }
}

/** The store's discriminator. UI vocabulary stays "Senior". */
export type SqlTripStatus = 'ACTIVE' | 'COMPLETED';

export type MunicipalityPassengerRow = {
  originMunicipality: string;
  destinationMunicipality: string;
  passengerCount: number;
  /** Share of the trip's total for the active filter category, 0–100. */
  percentage: number;
  /** First-seen raw snapshots — the group sheet prints both parses. */
  originSnapshot?: string;
  destinationSnapshot?: string;
  /** Per fare-type quantities within the group, for the mix line. */
  byType?: Partial<Record<PassengerType, number>>;
  /** Ticket rows folded into the group. */
  fares?: number;
  firstBoardedAt?: number | null;
  lastBoardedAt?: number | null;
};

export type PassengerUiState = {
  selectedTrip: TripRowRecord | null;
  availableTrips: TripRowRecord[];
  ticketCount: number;
  passengerCount: number;
  municipalityRows: MunicipalityPassengerRow[];
};

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; message: string; actionLabel?: string }
  | { kind: 'ready' };

// ── Municipality parsing ────────────────────────────────────────────────────

/**
 * "Barangay, Municipality" → "Municipality".
 *
 * The location snapshots are display text ("Santa Cruz, Olongapo"), not
 * structured columns, so the municipality is the tail after the last comma.
 * A name-less snapshot falls back to the whole string — a bare terminal name
 * is still a truthful grouping key, while losing the row would not be.
 */
export function municipalityOf(snapshot: string | null | undefined): string {
  if (!snapshot) return 'Not recorded';
  const trimmed = snapshot.trim();
  if (trimmed === '') return 'Not recorded';
  const comma = trimmed.lastIndexOf(',');
  const tail = comma === -1 ? trimmed : trimmed.slice(comma + 1).trim();
  return tail === '' ? trimmed : tail;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export type TicketAggregateRow = {
  origin_location_snapshot: string;
  destination_location_snapshot: string;
  passenger_type: PassengerType;
  passenger_quantity: number;
  /** Epoch millis; absent in older call shapes — the sheet hides the rows. */
  created_at?: number | null;
};

/**
 * Folds one trip's tickets into municipality pairs.
 *
 * Passengers count by quantity, never by ticket rows — a qty-3 ticket moves
 * three people, and the Dashboard's passenger total must equal the sum of
 * these rows for the same trip. Percentages share the *filtered* total, so the
 * rows of a category view resolve to 100% among themselves.
 */
export function aggregateByMunicipality(
  tickets: TicketAggregateRow[],
): { rows: MunicipalityPassengerRow[]; totalPassengers: number } {
  const pairs = new Map<string, MunicipalityPassengerRow>();
  let totalPassengers = 0;

  for (const ticket of tickets) {
    const origin = municipalityOf(ticket.origin_location_snapshot);
    const destination = municipalityOf(ticket.destination_location_snapshot);
    const key = `${origin}→${destination}`;
    const row = pairs.get(key) ?? {
      originMunicipality: origin,
      destinationMunicipality: destination,
      passengerCount: 0,
      percentage: 0,
      originSnapshot: ticket.origin_location_snapshot,
      destinationSnapshot: ticket.destination_location_snapshot,
      byType: {},
      fares: 0,
      firstBoardedAt: ticket.created_at ?? null,
      lastBoardedAt: ticket.created_at ?? null,
    };
    row.passengerCount += ticket.passenger_quantity;
    row.fares = (row.fares ?? 0) + 1;
    if (row.byType) {
      row.byType[ticket.passenger_type] =
        (row.byType[ticket.passenger_type] ?? 0) + ticket.passenger_quantity;
    }
    if (typeof ticket.created_at === 'number') {
      if (row.firstBoardedAt == null || ticket.created_at < row.firstBoardedAt)
        row.firstBoardedAt = ticket.created_at;
      if (row.lastBoardedAt == null || ticket.created_at > row.lastBoardedAt)
        row.lastBoardedAt = ticket.created_at;
    }
    pairs.set(key, row);
    totalPassengers += ticket.passenger_quantity;
  }

  const rows = [...pairs.values()].map((row) => ({
    ...row,
    percentage: totalPassengers > 0 ? (row.passengerCount / totalPassengers) * 100 : 0,
  }));

  rows.sort(
    (a, b) =>
      b.passengerCount - a.passengerCount ||
      a.originMunicipality.localeCompare(b.originMunicipality) ||
      a.destinationMunicipality.localeCompare(b.destinationMunicipality),
  );

  return { rows, totalPassengers };
}

// ── Filter vocabulary ──────────────────────────────────────────────────────

/**
 * The five chips, in store vocabulary. The chip prints `label` (short enough
 * for one row of five equal tracks); `scope` carries the full name into every
 * aria-label and the summary sentence; `noun` is what the denominator reads
 * as ("share of the 12 senior citizens on this trip").
 */
export type PassengerFilterEntry = {
  value: PassengerFilter;
  label: string;
  scope: string;
  noun: string;
};

export const PASSENGER_FILTERS: PassengerFilterEntry[] = [
  { value: 'ALL', label: 'All', scope: 'all 5 fare types', noun: 'passengers' },
  { value: 'REGULAR', label: 'Regular', scope: 'regular', noun: 'regular passengers' },
  { value: 'STUDENT', label: 'Student', scope: 'student', noun: 'student passengers' },
  { value: 'SENIOR', label: 'Senior', scope: 'senior citizen', noun: 'senior citizens' },
  { value: 'PWD', label: 'PWD', scope: 'person with a disability', noun: 'passengers with a disability' },
];

export function passengerFilterEntry(filter: PassengerFilter): PassengerFilterEntry {
  return PASSENGER_FILTERS.find((entry) => entry.value === filter) ?? PASSENGER_FILTERS[0];
}

// ── Group facts the ledger and the sheet share ─────────────────────────────

/** Store order for the mix line — the same order the chips read left to right. */
const MIX_ORDER: PassengerType[] = ['REGULAR', 'STUDENT', 'SENIOR_CITIZEN', 'PWD'];

/** Chip wording inside the mix: `3 regular · 2 senior`. PWD stays uppercase. */
const MIX_SHORT: Record<PassengerType, string> = {
  REGULAR: 'regular',
  STUDENT: 'student',
  SENIOR_CITIZEN: 'senior',
  PWD: 'PWD',
};

/** Full fare-type names for the group sheet's detail rows. */
const MIX_LABEL: Record<PassengerType, string> = {
  REGULAR: 'Regular',
  STUDENT: 'Student',
  SENIOR_CITIZEN: 'Senior citizen',
  PWD: 'PWD',
};

export function passengerTypeLongLabel(passengerType: PassengerType): string {
  return MIX_LABEL[passengerType];
}

/**
 * The group sheet's mix card: one entry per type present, with each type's
 * share of the group. Order is the store's, so the card reads like the chips.
 */
export function mixEntries(byType: Partial<Record<PassengerType, number>> | undefined): {
  label: string;
  qty: number;
  pct: number;
}[] {
  if (!byType) return [];
  const total = MIX_ORDER.reduce((sum, key) => sum + (byType[key] ?? 0), 0);
  if (total === 0) return [];
  return MIX_ORDER.filter((key) => (byType[key] ?? 0) > 0).map((key) => {
    const qty = byType[key] ?? 0;
    return { label: MIX_LABEL[key], qty, pct: Math.round((qty / total) * 100) };
  });
}

/**
 * One group's fare-type mix, in the chips' own words. Empty byType reads as
 * an empty string — the row hides its sub-line rather than printing "0".
 */
export function mixLabel(byType: Partial<Record<PassengerType, number>> | undefined): string {
  if (!byType) return '';
  return MIX_ORDER.filter((key) => (byType[key] ?? 0) > 0)
    .map((key) => `${byType[key]} ${MIX_SHORT[key]}`)
    .join(' · ');
}

/**
 * Distinct boarding municipalities across the rows — the card's third
 * figure. Boarding only: a drop-off is where somebody left, not where they
 * got on.
 */
export function distinctMunicipalities(rows: MunicipalityPassengerRow[]): number {
  return new Set(rows.map((row) => row.originMunicipality)).size;
}

// ── Summary sentence ───────────────────────────────────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The one sentence under the search field: scope, denominator, and that a
 * search hides rows without redefining what a bar is a share of. `denom` is
 * the chip-filtered total — never the search result.
 */
export function passengerSummary(input: {
  filter: PassengerFilter;
  /** Chip-filtered passenger total — the bars' denominator. */
  denom: number;
  /** Rows still visible after the search. */
  filtered: number;
  /** Distinct groups on the trip, unfiltered. */
  tripGroups: number;
  hasQuery: boolean;
}): string {
  const entry = passengerFilterEntry(input.filter);
  if (input.denom === 0) {
    return entry.value === 'ALL'
      ? 'No boarding groups on this trip yet.'
      : `${cap(entry.scope)} only · no boarding groups on this trip yet.`;
  }
  const shown =
    input.filtered === input.tripGroups
      ? plural(input.filtered, 'group', 'groups')
      : `${input.filtered} of ${input.tripGroups} groups`;
  let sentence =
    (entry.value === 'ALL' ? 'All 5 fare types' : `${cap(entry.scope)} only`) +
    ` · ${shown} shown · each bar is that group's share of the ${input.denom} ${entry.noun} on this trip.`;
  if (input.hasQuery) sentence += ' The search hides rows; it does not change the shares.';
  return sentence;
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Case-insensitive substring match over the pair — both the derived
 * municipalities and the raw stored snapshots (the reference haystack), so a
 * barangay head matches too. Search narrows what is displayed; the stored
 * counts and the percentage denominator stay the trip's totals for the
 * active filter.
 */
export function filterRowsBySearch(
  rows: MunicipalityPassengerRow[],
  searchQuery: string,
): MunicipalityPassengerRow[] {
  const needle = searchQuery.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter(
    (row) =>
      row.originMunicipality.toLowerCase().includes(needle) ||
      row.destinationMunicipality.toLowerCase().includes(needle) ||
      (row.originSnapshot ?? '').toLowerCase().includes(needle) ||
      (row.destinationSnapshot ?? '').toLowerCase().includes(needle),
  );
}

// ── Trip selection ──────────────────────────────────────────────────────────

/**
 * Active first, then completed newest first.
 *
 * `COALESCE(endedAt, startedAt)` — a completed trip is scoped by when it
 * finished, which is the day its money is in. The active trip rides above the
 * sort because it is the one still collecting.
 */
export function orderAvailableTrips(
  active: TripRowRecord | null,
  completed: TripRowRecord[],
): TripRowRecord[] {
  const byRecency = [...completed].sort(
    (a, b) =>
      (b.ended_at ?? b.started_at) - (a.ended_at ?? a.started_at) || b.id - a.id,
  );
  return active ? [active, ...byRecency] : byRecency;
}

/**
 * Default selection: the active trip, else the most recent completed one.
 * Shared by the initial mount and the fallback when a selected id vanishes —
 * a dead selection never leaves the screen without a trip to report on.
 */
export function defaultTrip(availableTrips: TripRowRecord[]): TripRowRecord | null {
  return availableTrips[0] ?? null;
}

/**
 * The trip to report on. An explicit selection wins only while it still
 * exists in `availableTrips`; otherwise the default rule applies. This is the
 * guard that keeps a stale id (a trip ended is not deleted, but a future
 * schema prune could remove one) from rendering an empty screen.
 */
export function resolveSelectedTrip(
  availableTrips: TripRowRecord[],
  selectedTripId: number | null,
): TripRowRecord | null {
  if (selectedTripId !== null) {
    const selected = availableTrips.find((trip) => trip.id === selectedTripId);
    if (selected) return selected;
  }
  return defaultTrip(availableTrips);
}

// ── Formatting helpers (screen-agnostic) ────────────────────────────────────

/** Search matches either end of the pair; the pair itself is the identity. */
export function municipalityPairLabel(row: MunicipalityPassengerRow) {
  return `${row.originMunicipality} to ${row.destinationMunicipality}`;
}

/**
 * The composite key the ledger virtualizes on. Municipality pairs can repeat
 * across rows only through a parsing change, and a repeated key would merge
 * two rows into one FlatList slot — so the pair is the key, never the index.
 */
export function municipalityRowKey(row: MunicipalityPassengerRow) {
  return `${row.originMunicipality}_${row.destinationMunicipality}`;
}
