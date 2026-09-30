import * as SQLite from 'expo-sqlite';

/**
 * The History screen's data layer.
 *
 * Read-only over the same `kondukt.db`. Two scoping rules run through every
 * query here and they are deliberately different:
 *
 * - Trips scope by `started_at` — a trip belongs to the window it began in.
 * - Tickets scope by `created_at` — the ledger lands where the fare was taken.
 *
 * A trip that started before midnight with tickets after it therefore appears
 * in both windows under different rules. The trips-page query carries four
 * bounds for exactly this reason: two for the ticket-aggregate subquery (the
 * ticket window) and two for the outer trip filter (the trip window). Conflating
 * them is the classic bug — the earnings of a multi-day trip would count only
 * the tickets created on its start day.
 */

/** Trip window. */
const TRIP_BOUNDS = 't.started_at >= ? AND t.started_at < ?';
/** Ticket window. */
const TICKET_BOUNDS = 'p.created_at >= ? AND p.created_at < ?';

/**
 * The columns are aliased to the names `HistorySummary` declares, because
 * SQLite hands back the alias verbatim and nothing maps the row afterwards.
 * `trip_count`/`ticket_count`/`passenger_count` here read as `undefined` at
 * every call site — Home's tagline, the five tiles and the storage note all
 * render a figure straight off this row.
 */
const SUMMARY_QUERY = `
  SELECT
    (SELECT COUNT(*) FROM trips WHERE started_at >= ? AND started_at < ?) AS tripCount,
    (SELECT COALESCE(SUM(distance_km_milli), 0) FROM trips WHERE started_at >= ? AND started_at < ?) AS distance_km_milli,
    (SELECT COUNT(*) FROM passenger_transactions WHERE created_at >= ? AND created_at < ?) AS ticketCount,
    (SELECT COALESCE(SUM(passenger_quantity), 0) FROM passenger_transactions WHERE created_at >= ? AND created_at < ?) AS passengerCount,
    (SELECT COALESCE(SUM(total_fare), 0) FROM passenger_transactions WHERE created_at >= ? AND created_at < ?) AS earnings`;

const BREAKDOWN_QUERY = `
  SELECT passenger_type,
         COALESCE(SUM(passenger_quantity), 0) AS passenger_count,
         COALESCE(SUM(total_fare), 0) AS earnings
  FROM passenger_transactions
  WHERE created_at >= ? AND created_at < ?
  GROUP BY passenger_type
  ORDER BY passenger_type`;

/** Page size for every paged tab. A short page means the end has been reached. */
export const HISTORY_PAGE_SIZE = 25;

function tripsPageQuery(status: 'ALL' | 'COMPLETED' | 'ACTIVE') {
  return `
    SELECT t.id, t.trip_number, t.started_at, t.ended_at,
           t.origin_location_snapshot AS origin,
           t.destination_location_snapshot AS destination,
           t.distance_km_milli, t.status,
           COALESCE(a.ticket_count, 0) AS ticket_count,
           COALESCE(a.passenger_count, 0) AS passenger_count,
           COALESCE(a.earnings, 0) AS earnings
    FROM trips t
    LEFT JOIN (
      SELECT trip_id,
             COUNT(*) AS ticket_count,
             COALESCE(SUM(passenger_quantity), 0) AS passenger_count,
             COALESCE(SUM(total_fare), 0) AS earnings
      FROM passenger_transactions
      WHERE created_at >= ? AND created_at < ?
      GROUP BY trip_id
    ) a ON a.trip_id = t.id
    WHERE ${TRIP_BOUNDS}
      ${status === 'ALL' ? '' : `AND t.status = '${status}'`}
      -- Case-insensitive substring match over the trip's number and route.
      -- The empty needle matches everything, so the caller passes '' for off.
      AND (? = '' OR CAST(t.trip_number AS TEXT) LIKE '%' || ? || '%'
        OR COALESCE(t.origin_location_snapshot, '') LIKE '%' || ? || '%'
        OR COALESCE(t.destination_location_snapshot, '') LIKE '%' || ? || '%')
    ORDER BY t.started_at DESC, t.id DESC
    LIMIT ? OFFSET ?`;
}

const TICKETS_PAGE_QUERY = `
  SELECT p.id, p.trip_id, t.trip_number, p.created_at,
         p.origin_location_snapshot AS origin,
         p.destination_location_snapshot AS destination,
         p.passenger_type, p.passenger_quantity,
         p.final_fare_per_passenger, p.total_fare
  FROM passenger_transactions p
  JOIN trips t ON t.id = p.trip_id
  WHERE ${TICKET_BOUNDS}
    -- The passenger-type filter: NULL means all types, no predicate.
    AND (? IS NULL OR p.passenger_type = ?)
    -- Case-insensitive substring match over route and trip number.
    AND (? = '' OR CAST(p.id AS TEXT) LIKE '%' || ? || '%'
      OR t.trip_number LIKE '%' || ? || '%'
      OR COALESCE(p.origin_location_snapshot, '') LIKE '%' || ? || '%'
      OR COALESCE(p.destination_location_snapshot, '') LIKE '%' || ? || '%')
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT ? OFFSET ?`;

/** Daily earnings, grouped by local calendar day in the mapper, from ticket time. */
const DAILY_EARNINGS_QUERY = `
  SELECT created_at, total_fare, passenger_quantity
  FROM passenger_transactions
  WHERE created_at >= ? AND created_at < ?
  ORDER BY created_at ASC, id ASC`;

export type HistoryRange = { start: number; endExclusive: number };

export type TripHistoryRow = {
  id: number;
  trip_number: string;
  started_at: number;
  ended_at: number | null;
  origin: string;
  destination: string;
  distance_km_milli: number;
  status: 'ACTIVE' | 'COMPLETED';
  ticket_count: number;
  passenger_count: number;
  earnings: number;
};

export type TicketHistoryRow = {
  id: number;
  trip_id: number;
  trip_number: string;
  created_at: number;
  origin: string;
  destination: string;
  passenger_type: import('./schema').PassengerType;
  passenger_quantity: number;
  final_fare_per_passenger: number;
  total_fare: number;
};

export type HistorySummary = {
  tripCount: number;
  ticketCount: number;
  passengerCount: number;
  /** Centavos. */
  earnings: number;
  /** Integer thousandths of a km. */
  distance_km_milli: number;
};

export type PassengerBreakdownRow = {
  passenger_type: import('./schema').PassengerType;
  passenger_count: number;
  earnings: number;
};

export type HistoryTab = 'trips' | 'tickets' | 'earnings';

/** All-time record totals, for the storage note under the ledger. */
export type HistoryTotals = {
  tripCount: number;
  ticketCount: number;
  dayCount: number;
};

/** The most recently completed trip, with the totals of its own ledger. */
export type LastCompletedTrip = {
  id: number;
  trip_number: string;
  origin_location_snapshot: string;
  destination_location_snapshot: string;
  ended_at: number;
  ticket_count: number;
  passenger_count: number;
  earnings: number;
};

/**
 * All-time record totals, for the storage note under the ledger.
 *
 * Deliberately unbounded: the note reports what the device holds in total, not
 * what the selected period holds, so it must not inherit the period's window.
 * `localtime` resolves each timestamp on the *device's* calendar, which is the
 * same local-midnight rule the rest of this module's windows use — a UTC day
 * would file evening fares under tomorrow.
 */
const TOTALS_QUERY = `
  SELECT
    (SELECT COUNT(*) FROM trips) AS tripCount,
    (SELECT COUNT(*) FROM passenger_transactions) AS ticketCount,
    (SELECT COUNT(DISTINCT date(created_at / 1000, 'unixepoch', 'localtime'))
     FROM passenger_transactions) AS dayCount`;

export async function fetchHistoryTotals(): Promise<HistoryTotals> {
  const db = await openStore();
  const row = await db.getFirstAsync<HistoryTotals>(TOTALS_QUERY);
  return row ?? { tripCount: 0, ticketCount: 0, dayCount: 0 };
}

/**
 * The most recently completed trip, with the totals of its own ledger.
 *
 * Unbounded on purpose, unlike every paged query in this file: Home's "last
 * trip" card reports whichever run finished last, however long ago that was,
 * and a window would make the card silently describe a different day.
 */
const LAST_COMPLETED_QUERY = `
  SELECT t.id, t.trip_number, t.origin_location_snapshot, t.destination_location_snapshot,
         t.ended_at,
         COALESCE(a.ticket_count, 0) AS ticket_count,
         COALESCE(a.passenger_count, 0) AS passenger_count,
         COALESCE(a.earnings, 0) AS earnings
  FROM trips t
  LEFT JOIN (
    SELECT trip_id,
           COUNT(*) AS ticket_count,
           COALESCE(SUM(passenger_quantity), 0) AS passenger_count,
           COALESCE(SUM(total_fare), 0) AS earnings
    FROM passenger_transactions
    GROUP BY trip_id
  ) a ON a.trip_id = t.id
  WHERE t.status = 'COMPLETED' AND t.ended_at IS NOT NULL
  ORDER BY t.ended_at DESC
  LIMIT 1`;

export async function fetchLastCompletedTrip(): Promise<LastCompletedTrip | null> {
  const db = await openStore();
  return (await db.getFirstAsync<LastCompletedTrip>(LAST_COMPLETED_QUERY)) ?? null;
}

export async function fetchHistorySummary(
  range: HistoryRange,
): Promise<HistorySummary> {
  const db = await openStore();
  const row = await db.getFirstAsync<HistorySummary>(SUMMARY_QUERY, [
    range.start, range.endExclusive,
    range.start, range.endExclusive,
    range.start, range.endExclusive,
    range.start, range.endExclusive,
    range.start, range.endExclusive,
  ]);
  return (
    row ?? { tripCount: 0, ticketCount: 0, passengerCount: 0, earnings: 0, distance_km_milli: 0 }
  );
}

export async function fetchPassengerBreakdown(
  range: HistoryRange,
): Promise<PassengerBreakdownRow[]> {
  const db = await openStore();
  return db.getAllAsync<PassengerBreakdownRow>(BREAKDOWN_QUERY, [range.start, range.endExclusive]);
}

/**
 * One page of the trips tab. The four bounds: the first pair scopes the
 * per-trip ticket aggregate to the *ticket* window, the second pair scopes the
 * trips themselves to the *trip* window.
 */
export async function fetchTripsPage(
  range: HistoryRange,
  status: 'ALL' | 'COMPLETED' | 'ACTIVE',
  offset: number,
  search = '',
): Promise<TripHistoryRow[]> {
  const db = await openStore();
  return db.getAllAsync<TripHistoryRow>(
    tripsPageQuery(status),
    [
      range.start, range.endExclusive,
      range.start, range.endExclusive,
      search, search, search, search,
      HISTORY_PAGE_SIZE, offset,
    ],
  );
}

export async function fetchTicketsPage(
  range: HistoryRange,
  offset: number,
  passengerType: import('./schema').PassengerType | null = null,
  search = '',
): Promise<TicketHistoryRow[]> {
  const db = await openStore();
  return db.getAllAsync<TicketHistoryRow>(TICKETS_PAGE_QUERY, [
    range.start, range.endExclusive,
    passengerType, passengerType,
    // Five needles, not four: the predicate binds one for the `= ''` guard
    // and one per searched column (id, trip number, origin, destination).
    // One short shifted every later value a slot — LIMIT bound the offset and
    // the page came back `LIMIT 0`: a tickets tab that never showed a ticket.
    search, search, search, search, search,
    HISTORY_PAGE_SIZE, offset,
  ]);
}

export type DailyEarningsRow = { dayStart: number; earnings: number };

/**
 * Daily earnings built from ticket creation times. Grouping by local calendar
 * day happens in the mapper, which owns the local-midnight arithmetic.
 */
export async function fetchDailyEarnings(
  range: HistoryRange,
): Promise<{ created_at: number; total_fare: number; passenger_quantity: number }[]> {
  const db = await openStore();
  return db.getAllAsync<{
    created_at: number;
    total_fare: number;
    passenger_quantity: number;
  }>(
    DAILY_EARNINGS_QUERY,
    [range.start, range.endExclusive],
  );
}

/** Opens the shared database without re-running the other screens' setup. */
let storeOpen: Promise<SQLite.SQLiteDatabase> | null = null;
function openStore() {
  storeOpen ??= import('./tripTicketsStore').then((m) => m.getDefaultDatabase());
  return storeOpen;
}
