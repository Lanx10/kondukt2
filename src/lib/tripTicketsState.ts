import type {
  PassengerType,
  TicketRowRecord,
  TripRowRecord,
} from '../data/schema';

/**
 * Pure mapping from store rows to the screen's UI state.
 *
 * No React, no SQLite — every branch and number here is testable under plain
 * `tsx`, which is why the loader and the component stay thin. This module owns
 * the LoadState union, so the two representations of "in progress" an earlier
 * implementation kept (`isLoading` plus an error string) cannot disagree here:
 * a read is loading, missing, failed, or ready — exactly one, enforced by the
 * type.
 *
 * Nothing in this file formats for display. It produces facts; the screen
 * renders them. The one exception is `notFound`, which is an outcome, not a
 * string — branching on user-facing copy was how the Compose build rerouted
 * its error UI whenever the message was reworded.
 */

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; state: TripTicketsUiState };

export type TicketRow = {
  ticketId: number;
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

export type TripTicketsUiState = {
  trip: TripRowRecord;
  totalTickets: number;
  totalPassengers: number;
  /** Centavos. */
  totalEarnings: number;
  /** Centavos, floored — see `buildTripTicketsState`. */
  averageFarePerPassenger: number;
  /** First eight ledger rows, newest first. Kept for caller parity. */
  recentTickets: TicketRow[];
  /** The full ledger, newest first. */
  ticketHistory: TicketRow[];
  notFound: boolean;
};

/** How much of the ledger `recentTickets` carries. */
export const RECENT_TICKET_LIMIT = 8;

/**
 * Builds the ready state from one trip row and its ledger.
 *
 * The ledger arrives already scoped (`WHERE trip_id = ?`) and already sorted
 * (`created_at DESC, id DESC`) — re-sorting or re-filtering here would create a
 * second opinion about ordering that the SQL index quietly stops serving.
 */
export function buildTripTicketsState(
  trip: TripRowRecord,
  tickets: TicketRowRecord[],
): TripTicketsUiState {
  const history: TicketRow[] = tickets.map((row) => ({
    ticketId: row.id,
    createdAt: row.created_at,
    origin: row.origin_location_snapshot,
    destination: row.destination_location_snapshot,
    passengerType: row.passenger_type,
    passengerQuantity: row.passenger_quantity,
    farePerPassenger: row.final_fare_per_passenger,
    totalFare: row.total_fare,
  }));

  const totalTickets = history.length;
  const totalPassengers = history.reduce((sum, row) => sum + row.passengerQuantity, 0);
  const totalEarnings = history.reduce((sum, row) => sum + row.totalFare, 0);
  // Floored to the cent, guarded against the empty ledger: 0, never NaN.
  const averageFarePerPassenger =
    totalPassengers === 0 ? 0 : Math.floor(totalEarnings / totalPassengers);

  return {
    trip,
    totalTickets,
    totalPassengers,
    totalEarnings,
    averageFarePerPassenger,
    recentTickets: history.slice(0, RECENT_TICKET_LIMIT),
    ticketHistory: history,
    notFound: false,
  };
}

/**
 * The single fold from a read outcome to a load state. The screen calls this;
 * it never inspects strings or booleans to decide which branch it is in.
 */
export function toLoadState(read: {
  trip: TripRowRecord | null;
  tickets: TicketRowRecord[];
}): LoadState {
  if (!read.trip) return { kind: 'notFound' };
  return { kind: 'ready', state: buildTripTicketsState(read.trip, read.tickets) };
}
