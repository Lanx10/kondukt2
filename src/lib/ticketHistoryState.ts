import type { PassengerType, TicketRowRecord, TripRowRecord } from '../data/schema';

/**
 * Pure Trip Ticket History logic.
 *
 * No React, no SQLite — the scoping guard, the tie-break and the display
 * mapping are the parts a second implementation gets wrong, so they live here
 * where plain `tsx` can test them. The screen renders these facts; it does not
 * re-derive them.
 *
 * Three rules with teeth:
 * - The trip-id filter runs even though the SQL already scopes by it. It is
 *   the belt to the query's braces, and the guard that keeps one trip's
 *   tickets from ever appearing under another.
 * - The tie-break is createdAt ASC, then id ASC. The ticket book fills oldest
 *   first: a record you read against is a record you read in the order it
 *   happened. A stable or unstable sort must not be allowed to change it.
 * - The readable passenger type is what the user reads and hears — never the
 *   raw enum name.
 */

export type TicketHistoryRow = {
  ticketId: number;
  tripId: number;
  /** Epoch millis. */
  createdAt: number;
  origin: string;
  destination: string;
  passengerType: PassengerType;
  passengerQuantity: number;
  /** Centavos. */
  farePerPassenger: number;
  /** Centavos. */
  totalFare: number;
};

/**
 * Maps, filters and sorts the store's rows into display order.
 *
 * The trip-id filter is deliberately redundant with the SQL's WHERE clause:
 * the query scopes by trip, and this filter proves it. If a future edit
 * loosens the query, the filter is the line that stops another trip's tickets
 * from rendering here.
 */
export function buildTicketHistoryRows(
  tickets: TicketRowRecord[],
  tripId: number,
): TicketHistoryRow[] {
  return tickets
    .filter((row) => row.trip_id === tripId)
    .map((row) => ({
      ticketId: row.id,
      tripId: row.trip_id,
      createdAt: row.created_at,
      origin: row.origin_location_snapshot,
      destination: row.destination_location_snapshot,
      passengerType: row.passenger_type,
      passengerQuantity: row.passenger_quantity,
      farePerPassenger: row.final_fare_per_passenger,
      totalFare: row.total_fare,
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.ticketId - b.ticketId);
}

/** "1 passenger", "2 passengers" — pluralized by count, never "1 passengers". */
export function passengerCountLabel(quantity: number) {
  return `${quantity} ${quantity === 1 ? 'passenger' : 'passengers'}`;
}

/** "1 ticket", "2 tickets" — the store's own count, plural decided by it. */
export function ticketCountLabel(count: number) {
  return `${count} ${count === 1 ? 'ticket' : 'tickets'}`;
}

/**
 * The readable passenger type: PWD stays PWD (initialism, not a word to
 * spell out), everything else reads as a capitalized phrase — "Senior
 * citizen", never "SENIOR_CITIZEN".
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

/**
 * The card names the fare rather than printing its code: a reader who cannot
 * see "SENIOR_CITIZEN" behind the number still has to be able to tell a
 * senior's ticket from a student's.
 */
export function fareWord(type: PassengerType) {
  return `${readablePassengerType(type)} fare`;
}

/** Totals over the rows on show — the footer's "this trip sold…" line. */
export type TicketHistoryTotals = { count: number; pax: number; total: number };

export function ticketHistoryTotals(rows: TicketHistoryRow[]): TicketHistoryTotals {
  return rows.reduce(
    (acc, row) => {
      acc.count += 1;
      acc.pax += row.passengerQuantity;
      acc.total += row.totalFare;
      return acc;
    },
    { count: 0, pax: 0, total: 0 },
  );
}

/**
 * The chrome's subtitle. The pill names the trip because the lede below it
 * says "this trip" and a pronoun with no noun behind it is the kind of
 * sentence that ends an argument.
 */
export function ticketHistorySubtitle(
  trip: TripRowRecord | null,
  tripNumber: string,
): string {
  if (!trip) return 'No trip on this device';
  return `Trip #${tripNumber}${trip.status === 'ACTIVE' ? ' · running' : ''}`;
}

export type TicketHistoryUiState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; trip: TripRowRecord | null; tripNumber: string }
  | {
      kind: 'ready';
      trip: TripRowRecord | null;
      tripNumber: string;
      tickets: TicketHistoryRow[];
      totals: TicketHistoryTotals;
    };

/**
 * The single fold from a read outcome to a branch.
 *
 * Branch priority is enforced by the union, not by render-order luck: an
 * empty first emission lands on `empty`, never `loading`, and a failure never
 * masquerades as an empty list. The trip rides both content branches so the
 * chrome and the empty copy name the same noun the lede promises.
 */
export function toTicketHistoryState(
  read: { trip: TripRowRecord | null; tickets: TicketRowRecord[] },
  tripId: number,
): TicketHistoryUiState {
  const tripNumber = read.trip?.trip_number ?? '';
  const rows = buildTicketHistoryRows(read.tickets, tripId);
  if (rows.length === 0) return { kind: 'empty', trip: read.trip, tripNumber };
  return {
    kind: 'ready',
    trip: read.trip,
    tripNumber,
    tickets: rows,
    totals: ticketHistoryTotals(rows),
  };
}

/**
 * The row announcement: the ticket number, where the fare was taken, when
 * (clock and date — the card only prints the clock, so the reader gets both),
 * the count with the plural decided by the count, the named fare, the money
 * each and in total, and which trip it belongs to — read in the order the
 * card reads. The id lives in the label rather than on the card: it is a
 * thing you read to somebody on the phone, not a thing you scan on a list.
 */
export function ticketRowAnnouncement(
  row: TicketHistoryRow,
  formatFare: (centavos: number) => string,
  formatStamp: (millis: number) => string,
  tripNumber: string,
) {
  return (
    `Ticket ${row.ticketId}. ` +
    `${row.origin} to ${row.destination}. ` +
    `Taken ${formatStamp(row.createdAt)}. ` +
    `${fareWord(row.passengerType)}, ${passengerCountLabel(row.passengerQuantity)}. ` +
    `${formatFare(row.farePerPassenger)} each, ${formatFare(row.totalFare)} collected. ` +
    `Trip ${tripNumber}. Open the receipt.`
  );
}
