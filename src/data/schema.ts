/**
 * Row shapes of the local SQLite store (`kondukt.db`).
 *
 * Types only — no `expo-sqlite` import — so the pure mapper and its tests can
 * run under plain `tsx` without pulling the native module. Column names match
 * the database exactly (`SELECT *` feeds these directly); money columns are
 * integer centavos and distance is integer thousandths of a kilometre.
 */

/** Lifecycle of a trip in the store. */
export type TripStatusRecord = 'ACTIVE' | 'COMPLETED';

/** A configured stop. `km_marker` is integer thousandths of a km. */
export type TerminalRowRecord = {
  id: number;
  name: string;
  km_marker: number;
  is_active: number;
  /** The municipality grouping this stop belongs to; null when unlinked. */
  municipality_id: number | null;
};

/**
 * A grouping of barangays. Added for the Barangay Configuration screen —
 * the Barangay Picker's registry stays the `terminals` table.
 */
export type MunicipalityRowRecord = {
  id: number;
  name: string;
  province: string;
  is_active: number;
};

export type PassengerType = 'REGULAR' | 'STUDENT' | 'SENIOR_CITIZEN' | 'PWD';

export type TripRowRecord = {
  id: number;
  /** Public display number — the one screens show. Unique. */
  trip_number: string;
  /** Location as recorded when the trip started, e.g. "Santa Cruz, Olongapo". */
  origin_location_snapshot: string;
  destination_location_snapshot: string;
  /** Epoch millis. */
  started_at: number;
  /** Null while the trip is running. */
  ended_at: number | null;
  /** Integer thousandths of a km (86200 → 86.200 km). */
  distance_km_milli: number;
  status: TripStatusRecord;
  /** 1 when the trip runs on the express way, 0 on the ordinary road. */
  uses_sctex: number;
};

export type TicketRowRecord = {
  id: number;
  trip_id: number;
  /** Epoch millis. */
  created_at: number;
  origin_location_snapshot: string;
  destination_location_snapshot: string;
  passenger_type: PassengerType;
  passenger_quantity: number;
  /** Centavos. */
  final_fare_per_passenger: number;
  /** Centavos. */
  total_fare: number;
};
