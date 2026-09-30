import * as SQLite from 'expo-sqlite';

/**
 * The Passenger screen's data layer.
 *
 * Read-only over the same `kondukt.db` the other screens write — this screen
 * performs no writes, opens no second database, and invents no new source of
 * truth. One scoping rule runs through every query here:
 *
 * A passenger is a **quantity** on a ticket (`passenger_quantity`), never a
 * row. Every count in this module sums quantities; counting rows would
 * disagree with the Dashboard and Trip screens' passenger totals.
 *
 * The location snapshots are display text ("Barangay, Municipality"), not
 * structured columns — municipality grouping happens in the mapper
 * (`passengerState.municipalityOf`), not in SQL, so the schema stays untouched.
 */

import {
  fetchTripBoard,
  getDefaultDatabase,
  subscribeToTrips,
} from './tripTicketsStore';

/** One trip's ticket rows, already scoped to that trip by SQL. */
const TRIP_TICKETS_QUERY = `
  SELECT origin_location_snapshot, destination_location_snapshot,
         passenger_type, passenger_quantity, created_at
  FROM passenger_transactions
  WHERE trip_id = ?
    AND (? IS NULL OR passenger_type = ?)
  ORDER BY created_at ASC, id ASC`;

/** One trip's tickets (all categories), for the unfiltered totals. */
export type PassengerTicketRow = {
  origin_location_snapshot: string;
  destination_location_snapshot: string;
  passenger_type: import('./schema').PassengerType;
  passenger_quantity: number;
  /** The group sheet's first/last boarded stamps. */
  created_at: number;
};

/**
 * Reads one trip's tickets. The filter clause is parameterized as
 * `(? IS NULL OR passenger_type = ?)` rather than string-built — the same
 * pattern the History screen's status filter uses, with no interpolated SQL.
 */
export async function fetchTripTickets(
  tripId: number,
  passengerType: import('./schema').PassengerType | null,
): Promise<PassengerTicketRow[]> {
  const db = await openStore();
  return db.getAllAsync<PassengerTicketRow>(TRIP_TICKETS_QUERY, [
    tripId,
    passengerType,
    passengerType,
  ]);
}

export type PassengerTripRecord = import('./schema').TripRowRecord;

/**
 * The trip picker's options, live.
 *
 * Active trip first, then completed trips newest first — the same board
 * `fetchTripBoard` returns, ordered here by the shared rule
 * (`orderAvailableTrips`) so the pure logic owns the sort, not the SQL.
 */
export async function fetchAvailableTrips(): Promise<{
  active: PassengerTripRecord | null;
  completed: PassengerTripRecord[];
}> {
  const db = await openStore();
  const board = await db.getAllAsync<PassengerTripRecord>(
    `SELECT * FROM trips ORDER BY COALESCE(ended_at, started_at) DESC, id DESC`,
  );
  const active = board.find((trip) => trip.status === 'ACTIVE') ?? null;
  const completed = board.filter((trip) => trip.status === 'COMPLETED');
  return { active, completed };
}

/**
 * Live subscription. The store's own change notification — no polling. A
 * ticket recorded on any screen re-runs the caller's loader through this.
 */
export function subscribeToPassengerData(onChange: () => void): () => void {
  return subscribeToTrips(onChange);
}

/** Re-exported so the screen's retry path can re-run without new imports. */
export { fetchTripBoard };

/** Opens the shared database without re-running the other screens' setup. */
function openStore(): Promise<SQLite.SQLiteDatabase> {
  return getDefaultDatabase();
}
