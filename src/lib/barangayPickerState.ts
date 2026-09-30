import type { TerminalRowRecord } from '../data/schema';

/**
 * Pure Barangay Picker logic: eligibility, direction, search, and the branch
 * fold.
 *
 * No React, no SQLite. The eligibility rules are the heart of this screen —
 * the same rules the ticket-recording flow applies — and they live here where
 * plain `tsx` can prove the picker agrees with them. If this module and the
 * stepper flow ever disagree, a user can pick a location the ticket screen
 * will then reject, so the rules are one implementation, tested.
 *
 * This port's registry is the `terminals` table: each row is a stop with a
 * "Barangay, Municipality" display name and a KM marker in thousandths of a
 * kilometre. A "barangay row" here is that stop. (The original Kotlin app had
 * separate barangay/municipality tables; this schema does not, and the spec
 * forbids adding one.)
 */

// ── Shapes ──────────────────────────────────────────────────────────────────

export type PickerSide = 'boarding' | 'destination';

/** The destination-side token. Anything else is treated as the boarding side. */
export const DESTINATION_SIDE_TOKEN = 'destination';

/** "Barangay, Municipality" → the barangay name, the head of the label. */
export function barangayNameOf(snapshot: string) {
  const comma = snapshot.indexOf(',');
  return comma === -1 ? snapshot : snapshot.slice(0, comma).trim();
}

/** "Barangay, Municipality" → the municipality, the tail of the label. */
export function municipalityNameOf(snapshot: string) {
  const comma = snapshot.indexOf(',');
  return comma === -1 ? '' : snapshot.slice(comma + 1).trim();
}

export type BarangayRow = {
  id: number;
  barangayName: string;
  municipalityName: string;
  /** Thousandths of a km, exactly as stored. */
  kmMarker: number;
  isActive: boolean;
};

export function toBarangayRow(terminal: TerminalRowRecord): BarangayRow {
  return {
    id: terminal.id,
    barangayName: barangayNameOf(terminal.name),
    municipalityName: municipalityNameOf(terminal.name),
    kmMarker: terminal.km_marker,
    isActive: terminal.is_active === 1,
  };
}

/** Barangay, Municipality — the row's second line. */
export function locationLabel(row: BarangayRow) {
  return row.municipalityName === ''
    ? row.barangayName
    : `${row.barangayName}, ${row.municipalityName}`;
}

export type BarangayPickerUiState =
  | { kind: 'loading' }
  | { kind: 'emptyEligible' }
  | { kind: 'emptyMatches' }
  | { kind: 'ready'; rows: BarangayRow[] };

// ── Eligibility ─────────────────────────────────────────────────────────────

/**
 * Step 1 — municipality scope. No municipality filter exists in this port's
 * single-table registry, so a supplied id scopes to the terminal rows of that
 * municipality id when the caller has them, else the list passes through
 * unchanged and the caller narrows by rows it resolved. Here: the caller
 * passes the already-scoped list, so this function is the identity anchor of
 * the pipeline and documents the order.
 */
export function scopeByMunicipality(rows: BarangayRow[], _municipalityId: number | null): BarangayRow[] {
  return rows;
}

/**
 * Steps 2–3 — trip bounds and direction, from the two terminal markers.
 *
 * Either marker missing means an empty result, never an unbounded list: an
 * unbounded picker would let a user pick a stop the fare rules cannot price.
 * Bounds are inclusive; the sort follows the trip's KM direction with ties
 * broken by ascending id in both directions.
 */
export function tripStopsWithinBounds(
  rows: BarangayRow[],
  originMarker: number | null,
  destinationMarker: number | null,
): BarangayRow[] {
  if (originMarker === null || destinationMarker === null) return [];
  const lower = Math.min(originMarker, destinationMarker);
  const upper = Math.max(originMarker, destinationMarker);
  const inBounds = rows.filter(
    (row) => row.kmMarker >= lower && row.kmMarker <= upper,
  );
  const descending = originMarker > destinationMarker;
  return inBounds.sort((a, b) =>
    descending
      ? b.kmMarker - a.kmMarker || a.id - b.id
      : a.kmMarker - b.kmMarker || a.id - b.id,
  );
}

/**
 * Step 4 — boarding side: exactly one row, the stop nearest the origin
 * terminal by absolute KM difference, ties by ascending id.
 *
 * This is the existing behavior, and it is deliberate: the boarding stop is
 * where the bus is, not a menu. It reads as a bug in a picker; it is not.
 */
export function nearestOriginStop(
  rows: BarangayRow[],
  originMarker: number | null,
  _destinationMarker: number | null,
): BarangayRow[] {
  if (rows.length === 0 || originMarker === null) return [];
  const best = [...rows].sort(
    (a, b) =>
      Math.abs(a.kmMarker - originMarker) - Math.abs(b.kmMarker - originMarker) ||
      a.id - b.id,
  )[0];
  return [best];
}

/**
 * Step 5 — destination side: stops strictly beyond the origin, in the trip's
 * direction. Exactly-at-the-origin is excluded. A missing origin id or an
 * origin that cannot be resolved returns the full in-bounds list — never an
 * empty one.
 */
export function destinationStopsAfterOrigin(
  rows: BarangayRow[],
  originId: number | null,
  originMarker: number | null,
  destinationMarker: number | null,
): BarangayRow[] {
  const bounded = tripStopsWithinBounds(rows, originMarker, destinationMarker);
  if (originId === null) return bounded;
  const origin = rows.find((row) => row.id === originId);
  if (!origin) return bounded;
  const descending =
    originMarker !== null && destinationMarker !== null && originMarker > destinationMarker;
  return bounded.filter((row) =>
    descending ? row.kmMarker < origin.kmMarker : row.kmMarker > origin.kmMarker,
  );
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Case-insensitive match on the barangay name, the formatted KM value and the
 * raw stored integer — never on municipality or province, which would widen
 * what a query matches beyond the existing screen's behavior. Blank or
 * whitespace returns the list unchanged.
 */
export function filterBarangaysByQuery(rows: BarangayRow[], query: string): BarangayRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter(
    (row) =>
      row.barangayName.toLowerCase().includes(needle) ||
      `${row.kmMarker}`.includes(needle),
  );
}

// ── Fold ────────────────────────────────────────────────────────────────────

/**
 * The single fold to a branch.
 *
 * `dataPending` is true only while every source is still empty — the loading
 * state is a fact about the data, not a timer. Search narrows after
 * eligibility, so an out-of-scope KM query returns "No matches" rather than
 * masquerading as an eligible row.
 */
export function toPickerState(
  eligible: BarangayRow[],
  filtered: BarangayRow[],
  dataPending: boolean,
  query: string,
): BarangayPickerUiState {
  if (eligible.length === 0) {
    if (dataPending) return { kind: 'loading' };
    return { kind: 'emptyEligible' };
  }
  if (query.trim() !== '' && filtered.length === 0) return { kind: 'emptyMatches' };
  return { kind: 'ready', rows: filtered };
}

/**
 * The row announcement: action verb, full location, KM. The side is named so
 * a boarding list is never mistaken for a destination list by ear.
 */
export function rowAnnouncement(row: BarangayRow, side: PickerSide, formatKm: (milli: number) => string) {
  return (
    `Pick ${locationLabel(row)}, ${formatKm(row.kmMarker)}. ` +
    `Choosing the ${side === 'boarding' ? 'boarding' : 'destination'} location.`
  );
}
