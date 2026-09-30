import { useEffect, useState } from 'react';
import { round2 } from '../lib/format';

// `tripTicketsStore` is imported dynamically, inside the loader: it pulls in
// `expo-sqlite` / `react-native`, which plain `tsx` cannot transform — and the
// unit tests (`calculations.test`, `dashboardState`'s suite) import this file
// for `ticketTotal` and the view types only. A static import here made those
// suites unrunnable; the dynamic one keeps this module's top level pure.

/**
 * The Dashboard's view of the application data.
 *
 * ── What this file is now ──────────────────────────────────────────────────
 * This used to hold a hard-coded seed: a placeholder snapshot the Dashboard
 * read while every other screen read the real store. The two disagreed on
 * every figure — a phantom "Iba → Olongapo" active trip, a different today's
 * total — so the Dashboard reported a device that did not exist. The seed is
 * gone; `useKondukt` now reads the same `kondukt.db` every other screen reads
 * (`tripTicketsStore`) and maps rows into the view shapes below.
 *
 * The view types stay deliberately separate from the stored row records: the
 * Dashboard's calculations (`dashboardState`, `calculations`) are pure
 * functions over pesos-as-floats and Places, unit-tested against these shapes,
 * and the store keeps centavos and snapshot strings. The mapping is here, in
 * one place, next to the only consumer.
 *
 * Two invariants carried over from the original design:
 *  1. Money is derived, never authored. A ticket's total is qty × fareEach —
 *     `ticketTotal` is the only place that product is taken on this side.
 *  2. A trip's `endedAt` is what scopes it to a day. An active trip has
 *     `endedAt: null` and belongs to no day — it is surfaced by status.
 */

export type PassengerCategory = 'Regular' | 'Student' | 'Senior Citizen' | 'Pwd';

export type Place = {
  barangay: string;
  municipality: string;
};

export type Ticket = {
  id: string;
  tripId: string;
  issuedAt: number;
  from: Place;
  to: Place;
  category: PassengerCategory;
  qty: number;
  fareEach: number;
};

export type TripStatus = 'ACTIVE' | 'COMPLETED';

export type Trip = {
  id: string;
  origin: Place;
  destination: Place;
  startedAt: number;
  endedAt: number | null;
  /** Metres, matching the Android build's `distanceKm` source column. */
  distanceMetres: number;
  status: TripStatus;
};

export type KonduktSnapshot = {
  trips: Trip[];
  tickets: Ticket[];
  /** Loading is its own state: zeros before the first read are a lie. */
  status: 'loading' | 'ready' | 'error';
};

/** Derived, never stored — a ticket's total is a fact about the ticket. */
export function ticketTotal(ticket: Ticket) {
  return round2(ticket.fareEach * ticket.qty);
}

/**
 * "Barangay, Municipality" → the pair, from one snapshot string.
 *
 * The stored snapshot is the terminal's own name ("Santa Cruz, Olongapo"),
 * and a name without a separator reads as both halves — the label helper
 * collapses equal halves, so that is the same output the seed produced for
 * "Olongapo, Olongapo".
 */
function parsePlace(snapshot: string): Place {
  const cut = snapshot.indexOf(',');
  if (cut === -1) return { barangay: snapshot, municipality: snapshot };
  return {
    barangay: snapshot.slice(0, cut).trim(),
    municipality: snapshot.slice(cut + 1).trim(),
  };
}

/** The store's passenger keys become the Dashboard's display categories. */
const CATEGORY: Record<string, PassengerCategory> = {
  REGULAR: 'Regular',
  STUDENT: 'Student',
  SENIOR_CITIZEN: 'Senior Citizen',
  PWD: 'Pwd',
};

type TripRow = {
  id: number;
  origin_location_snapshot: string;
  destination_location_snapshot: string;
  started_at: number;
  ended_at: number | null;
  distance_km_milli: number;
  status: TripStatus;
};

type TicketRow = {
  id: number;
  trip_id: number;
  created_at: number;
  origin_location_snapshot: string;
  destination_location_snapshot: string;
  passenger_type: string;
  passenger_quantity: number;
  final_fare_per_passenger: number;
};

function mapTrip(row: TripRow): Trip {
  return {
    id: String(row.id),
    origin: parsePlace(row.origin_location_snapshot),
    destination: parsePlace(row.destination_location_snapshot),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    // milli-km and metre are the same unit (1/1000 km): no scaling. The ×1000
    // that was here read every trip as 1000× its length ("4400.0 km").
    distanceMetres: row.distance_km_milli,
    status: row.status,
  };
}

function mapTicket(row: TicketRow): Ticket {
  return {
    id: String(row.id),
    tripId: String(row.trip_id),
    issuedAt: row.created_at,
    from: parsePlace(row.origin_location_snapshot),
    to: parsePlace(row.destination_location_snapshot),
    category: CATEGORY[row.passenger_type] ?? 'Regular',
    qty: row.passenger_quantity,
    // Centavos → pesos: every Dashboard calculation is in pesos.
    fareEach: row.final_fare_per_passenger / 100,
  };
}

/**
 * One full read of both tables.
 *
 * The whole ledger, not a window: the Dashboard steps through day, week,
 * month and custom ranges client-side, and the empty-today fallback looks at
 * earlier days — any server-side window would have to be re-queried per step.
 * A bus route's ledger is thousands of rows at most; this is not a feed.
 */
async function loadSnapshot(): Promise<{ trips: Trip[]; tickets: Ticket[] }> {
  const { getDefaultDatabase } = await import('./tripTicketsStore');
  const db = await getDefaultDatabase();
  const [tripRows, ticketRows] = await Promise.all([
    db.getAllAsync<TripRow>('SELECT * FROM trips'),
    db.getAllAsync<TicketRow>('SELECT * FROM passenger_transactions'),
  ]);
  return {
    trips: tripRows.map(mapTrip),
    tickets: ticketRows.map(mapTicket),
  };
}

/**
 * The Dashboard's data hook: the real store, live.
 *
 * Starts in `loading` (never in a fabricated ready state), re-reads on every
 * store change through the store's own subscription — the same paint path
 * Home and Trip use — and keeps the last good snapshot on a failed re-read so
 * a transient error does not blank figures that were already correct.
 */
export function useKondukt(): KonduktSnapshot {
  const [snapshot, setSnapshot] = useState<KonduktSnapshot>({
    trips: [],
    tickets: [],
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      loadSnapshot()
        .then(({ trips, tickets }) => {
          if (!cancelled) setSnapshot({ trips, tickets, status: 'ready' });
        })
        .catch(() => {
          // First read failed: nothing to keep, say so. Later failures fall
          // through here too but keep the previous trips/tickets below.
          if (!cancelled) {
            setSnapshot((previous) =>
              previous.status === 'ready' ? previous : { ...previous, status: 'error' },
            );
          }
        });
    };
    run();
    let unsubscribe: (() => void) | undefined;
    let cancelledSubscribe = false;
    void import('./tripTicketsStore').then(({ subscribeToTrips }) => {
      if (cancelledSubscribe) return;
      unsubscribe = subscribeToTrips(run);
    });
    return () => {
      cancelled = true;
      cancelledSubscribe = true;
      unsubscribe?.();
    };
  }, []);

  return snapshot;
}
