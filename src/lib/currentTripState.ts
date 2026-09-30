import type { PassengerType, TicketRowRecord, TripRowRecord } from '../data/schema';
import { formatKm, formatPeso } from './addTicketFare';
import { centavos } from './tripTicketsFormat';

/**
 * Pure Current Trip screen logic.
 *
 * No React, no SQLite — the totals fold and the load-state mapping are the
 * parts a second implementation gets wrong, so they live here where plain
 * `tsx` can test them. The screen renders these facts; it does not re-derive
 * them.
 *
 * Two rules with teeth:
 * - A "passenger" is a **quantity**, never a row. A qty-3 ticket is three
 *   passengers in every total.
 * - Senior and PWD share one bucket. They are discounted categories reported
 *   together, and splitting them would disagree with the breakdown line.
 */

// ── Totals ──────────────────────────────────────────────────────────────────

export type TripTotals = {
  passengers: number;
  regular: number;
  student: number;
  seniorAndPwd: number;
  /**
   * Integer thousandths of a km, quantity-weighted. Derived from the trip's
   * route distance: the store has no per-ticket distance column, and every
   * ticket on a trip rode the same route.
   */
  passengerDistanceMilli: number;
  /** Centavos. Sums `total_fare`, never fare × quantity. */
  collection: number;
};

/**
 * The screen's one fold. Every total derives from the observed rows — no
 * caching, no second source — and all arithmetic is integer arithmetic
 * (centavos and milli-km are stored integers).
 */
export function computeTripTotals(
  tickets: TicketRowRecord[],
  trip: TripRowRecord,
): TripTotals {
  let passengers = 0;
  let regular = 0;
  let student = 0;
  let seniorAndPwd = 0;
  let collection = 0;

  for (const ticket of tickets) {
    const qty = ticket.passenger_quantity;
    passengers += qty;
    collection += ticket.total_fare;
    if (ticket.passenger_type === 'REGULAR') regular += qty;
    else if (ticket.passenger_type === 'STUDENT') student += qty;
    // The discounted bucket: SENIOR_CITIZEN and PWD together, per spec.
    else seniorAndPwd += qty;
  }

  // No per-ticket distance exists; the route distance is the same for every
  // ticket on the trip, so the passenger-distance total is route distance
  // times passengers — integer milli-km times an integer count.
  return {
    passengers,
    regular,
    student,
    seniorAndPwd,
    passengerDistanceMilli: trip.distance_km_milli * passengers,
    collection,
  };
}

/**
 * The breakdown line: "REGULAR 90 · STUDENT 20 · SENIOR/PWD 15".
 *
 * One string with the counts inlined and separated by a middot — deliberately
 * not a three-column layout, and deliberately in the store's raw category
 * shape (uppercase, SENIOR/PWD) because the line is a compact operational
 * label, not a sentence.
 */
export function formatBreakdownLine(totals: TripTotals) {
  return `REGULAR ${totals.regular} · STUDENT ${totals.student} · SENIOR/PWD ${totals.seniorAndPwd}`;
}

/**
 * The readable passenger-type form, for both the row line and the row
 * announcement. Porting fix: the visual line must match what is announced —
 * a screen must not read "SENIOR_CITIZEN" and say "Senior citizen".
 */
export function readablePassengerType(type: PassengerType) {
  switch (type) {
    case 'PWD':
      return 'PWD';
    case 'SENIOR_CITIZEN':
      return 'Senior citizen';
    case 'REGULAR':
      return 'Regular';
    case 'STUDENT':
      return 'Student';
  }
}

// ── Ledger wording ──────────────────────────────────────────────────────────

/** The two floors a fare can land on, in the units the store keeps. */
export type BoardingRules = {
  minimumFareCentavos: number;
  minimumDistanceMilli: number;
};

/** "1 boarding" / "3 boardings" — the counts the ledger and the note print. */
export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The word under a boarding's fare: which bound set it, or the unit price.
 *
 * The store keeps no `atFloor` flag, so the classification is re-derived from
 * the two facts the row does carry — the stored total and the leg between its
 * two snapshots (the terminal KM markers the app never joins, joined here).
 * Priority is distance first, matching the reference's own seed: a row stopped
 * by the minimum distance lands on the minimum fare too, and "minimum
 * distance" is the bound that actually moved the billable distance.
 *
 * The leg is `null` when either snapshot is not a registered terminal; an
 * unknown leg can still confirm the fare floor from the unit price but can
 * never claim the distance floor.
 */
export function boardingNote(input: {
  totalCentavos: number;
  quantity: number;
  legMilli: number | null;
  rules: BoardingRules | null;
}): string {
  const quantity = Math.max(1, Math.trunc(input.quantity));
  // `total_fare` is per-passenger fare × quantity, so the division is exact;
  // the floor only guards a row written by something other than the calculator.
  const unit = Math.floor(input.totalCentavos / quantity);
  if (!input.rules) return `${formatPeso(unit)} each`;
  if (input.legMilli !== null && input.legMilli < input.rules.minimumDistanceMilli)
    return 'minimum distance';
  if (unit === input.rules.minimumFareCentavos) return 'minimum fare';
  return `${formatPeso(unit)} each`;
}

/**
 * The storage footer's sentence: the fold, then — when the floors are
 * knowable — which bound took how many rows.
 *
 * With no fare configuration on the device the floors do not exist, so the
 * second sentence would name numbers the device cannot hold; it is dropped
 * rather than printed against a placeholder.
 */
export function storageNote(input: {
  totals: TripTotals;
  rows: number;
  byFare: number;
  byDistance: number;
  rules: BoardingRules | null;
}): string {
  const head =
    `Every figure here is a sum of stored rows: ${plural(input.rows, 'boarding', 'boardings')}, ` +
    `${plural(input.totals.passengers, 'passenger', 'passengers')}, ` +
    `${centavos(input.totals.collection)} collected.`;
  if (!input.rules || input.rows === 0) return head;
  const priced = input.rows - input.byFare - input.byDistance;
  return (
    `${head} ${priced} of ${input.rows} are priced above both floors by distance, ` +
    `${input.byFare} land on the ${formatPeso(input.rules.minimumFareCentavos)} minimum fare and ` +
    `${input.byDistance} on the ${formatKm(input.rules.minimumDistanceMilli)} minimum distance, ` +
    'which at these rates is most of a provincial run.'
  );
}

// ── Load state ──────────────────────────────────────────────────────────────

export type CurrentTripUiState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; trip: TripRowRecord; tickets: TicketRowRecord[]; totals: TripTotals }
  | { kind: 'error'; message: string };

/**
 * The single fold from a read outcome to a branch.
 *
 * The loading branch exists so the empty state cannot flash on launch: the
 * screen renders loading until the store has *positively* reported either an
 * active trip or none. `notFound` is folded into `empty` — on this screen a
 * vanished trip id and "no active trip" are the same operational state.
 */
export function toCurrentTripState(
  trip: TripRowRecord | null,
  tickets: TicketRowRecord[],
): CurrentTripUiState {
  if (trip === null) return { kind: 'empty' };
  return { kind: 'ready', trip, tickets, totals: computeTripTotals(tickets, trip) };
}
