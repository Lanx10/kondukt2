/**
 * Shared helpers over the local SQLite row shapes.
 *
 * Pure, dependency-free: both Trip screens and their tests read these, and the
 * money arithmetic is cent-safe integer work — never float division.
 */

import type { TicketRowRecord, TripRowRecord } from './schema';

/**
 * The identifier every surface shows for a trip.
 *
 * The store's autoincrement `id` is a row handle, not a public number: the
 * reference screens label trips by their `trip_number`, and printing the
 * primary key under a "Trip #" label would disagree with the number the ledger
 * reports for the same row. Every `trip_number` is unique.
 */
export function tripNumber(row: TripRowRecord) {
  return row.trip_number;
}

/**
 * A snapshot reads "Barangay, Municipality" — except when they share a name.
 * "Olongapo, Olongapo" prints the word twice and costs the row's horizontal
 * space for nothing. The same rule `placeLabel` applies to the parsed Place on
 * Dashboard, so a trip reads the same route on every screen.
 */
function collapseSnapshot(snapshot: string) {
  const parts = snapshot.split(', ');
  if (parts.length >= 2 && parts[0] === parts[1]) parts.splice(1, 1);
  return parts.join(', ');
}

/** Route as one string; nulls render explicit fallbacks, never a bare dash. */
export function tripRoute(row: TripRowRecord) {
  const origin = row.origin_location_snapshot ?? 'Route not configured';
  const destination = row.destination_location_snapshot ?? 'Destination not configured';
  return `${collapseSnapshot(origin)} → ${collapseSnapshot(destination)}`;
}

/** Centavos → pesos as an integer-cent-safe string ("7733" → "77.33"). */
export function centavosToPesoString(centavos: number) {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(centavos));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** The passenger-weighted average fare of a ledger, floored to the cent. */
export function averageFare(tickets: TicketRowRecord[], passengers: number) {
  const total = tickets.reduce((sum, t) => sum + t.total_fare, 0);
  return passengers === 0 ? 0 : Math.floor(total / passengers);
}

/** Total collected on a ledger, in centavos. */
export function totalEarnings(tickets: TicketRowRecord[]) {
  return tickets.reduce((sum, t) => sum + t.total_fare, 0);
}

/** Total passengers on a ledger. */
export function totalPassengers(tickets: TicketRowRecord[]) {
  return tickets.reduce((sum, t) => sum + t.passenger_quantity, 0);
}
