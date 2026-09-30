import { ticketTotal, type Ticket, type Trip } from '../data/konduktStore';
import { averageEarnings, busDistance, sumTicketEarnings } from './calculations';
import { startOfDay } from './format';

export { ticketTotal };

/** How many recent tickets the Dashboard shows. */
const RECENT_LIMIT = 6;

/** A window of records: `start` inclusive, `endExclusive` the first ms outside. */
export type Window = { start: number; endExclusive: number };

/** A place as the store records it, for "Barangay, Municipality" labels. */
export type Place = { barangay: string; municipality: string };

/** Passenger counts per category, in the four slots the breakdown renders. */
export type ByCategory = {
  regular: number;
  student: number;
  senior: number;
  pwd: number;
};

/** The snapshot the Dashboard renders. */
export type DashboardState = {
  isToday: boolean;
  reachesToday: boolean;
  isClosed: boolean;
  dataDate: Date;
  activeTrip: Trip | null;
  activeTicketCount: number;
  activePassengerCount: number;
  activeCollected: number;
  totalEarnings: number;
  completedTripCount: number;
  ticketCount: number;
  passengerCount: number;
  distanceMetres: number;
  averageEarningsPerTrip: number;
  byCategory: ByCategory;
  trips: Trip[];
  recentTickets: Ticket[];
  isShowingRecentTripFallback: boolean;
  fallbackDate: Date | null;
};

/** Completed before active, then newest first by each date it has. */
function sortTrips(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'COMPLETED' ? -1 : 1;
    const aEnd = a.endedAt ?? a.startedAt;
    const bEnd = b.endedAt ?? b.startedAt;
    if (aEnd !== bEnd) return bEnd - aEnd;
    if (a.startedAt !== b.startedAt) return b.startedAt - a.startedAt;
    return b.id.localeCompare(a.id);
  });
}

/**
 * A place reads "Barangay, Municipality" — except when they share a name.
 * Iba, Iba and Olongapo, Olongapo are real places, and printing the name twice
 * is noise that costs horizontal space exactly where there is least of it.
 */
function placeLabel(place: Place | null): string {
  if (!place) return '\u2014';
  return place.barangay === place.municipality
    ? place.barangay
    : `${place.barangay}, ${place.municipality}`;
}

export function placeSummary(from: Place | null, to: Place | null): string {
  return `${placeLabel(from)} \u2192 ${placeLabel(to)}`;
}

/** Collapses a trip + its tickets into one summary row. */
function countByCategory(tickets: Ticket[]): ByCategory {
  const count = (category: Ticket['category']) =>
    tickets.filter((ticket) => ticket.category === category).reduce((sum, t) => sum + t.qty, 0);
  return {
    regular: count('Regular'),
    student: count('Student'),
    senior: count('Senior Citizen'),
    pwd: count('Pwd'),
  };
}

/**
 * Builds the whole snapshot the Dashboard renders.
 *
 * The fallback rule, which is the only real logic here: a window that reaches
 * today, with no active trip and no trips inside it, but with earlier trips on
 * file, means every figure would read 0. Showing zeros would be a lie about a
 * working app, so the screen swaps in the most recent recorded day and
 * relabels itself with that day's date. It is flagged, and `isToday` is forced
 * false, so no section can be read as live.
 */
export function buildDashboardState(
  trips: Trip[],
  tickets: Ticket[],
  window: Window,
  now: Date,
): DashboardState {
  const { start, endExclusive } = window;
  const todayStart = startOfDay(now).getTime();

  // A completed trip is scoped to the window it ended in; an active one to no
  // window. Scoping by `endedAt` is the rule this screen has always used: a trip
  // that ran across midnight belongs to the day it finished, which is the day
  // its money is actually in.
  const inWindow = trips.filter(
    (trip) => trip.endedAt !== null && trip.endedAt >= start && trip.endedAt < endExclusive,
  );
  const ticketsInWindow = tickets.filter(
    (ticket) => ticket.issuedAt >= start && ticket.issuedAt < endExclusive,
  );
  const isPresentWindow = start === todayStart && endExclusive === todayStart + 86_400_000;
  const reachesToday = endExclusive > todayStart;
  const isClosed = endExclusive <= todayStart;
  // A running trip is a fact about *now*, not about the selected window: any
  // window that contains the present moment shows it. Gating on the day window
  // alone (as this once did) made Week/Month report "No trip running" while a
  // trip was in fact running. A window fully in the past still gets null — the
  // screen's "PERIOD CLOSED" branch answers for it.
  const includesNow = start <= now.getTime() && now.getTime() < endExclusive;
  const activeTrip = includesNow
    ? (trips.find((trip) => trip.status === 'ACTIVE') ?? null)
    : null;
  const activeTickets = activeTrip ? tickets.filter((t) => t.tripId === activeTrip.id) : [];
  const isToday = isPresentWindow;
  const completedTrips = sortTrips(trips.filter((trip) => trip.status === 'COMPLETED'));
  const earlierTrips = completedTrips.filter((trip) => (trip.endedAt ?? 0) < todayStart);

  // The fallback only ever fires for the present window: a window the user
  // stepped back to is already describing its own past honestly.
  const shouldFallBack = isToday && !activeTrip && inWindow.length === 0 && earlierTrips.length > 0;

  // Under the fallback, the "selected" window becomes the most recent recorded
  // day, and its records stand in for today's.
  const latestTrip = earlierTrips[0];
  const fallbackDay = latestTrip ? new Date(latestTrip.endedAt ?? latestTrip.startedAt) : null;
  let sourceTrips = inWindow;
  let sourceTickets = ticketsInWindow;
  if (shouldFallBack && fallbackDay) {
    const dayStart = startOfDay(fallbackDay).getTime();
    sourceTrips = completedTrips.filter(
      (trip) => (trip.endedAt ?? 0) >= dayStart && (trip.endedAt ?? 0) < dayStart + 86_400_000,
    );
    const tripIds = new Set(sourceTrips.map((trip) => trip.id));
    sourceTickets = tickets.filter((ticket) => tripIds.has(ticket.tripId));
  }
  const completed = sourceTrips.filter((trip) => trip.status === 'COMPLETED');
  // Deliberately NOT filtered: a ticket issued on an active trip still counts
  // toward the day's total. The active trip is running inside today's window,
  // and its money has been collected.
  const scopedTickets = sourceTickets;

  return {
    isToday: isToday && !shouldFallBack,
    reachesToday,
    isClosed,
    dataDate: shouldFallBack && fallbackDay ? fallbackDay : new Date(start),
    activeTrip,
    activeTicketCount: activeTickets.length,
    activePassengerCount: activeTickets.reduce((sum, t) => sum + t.qty, 0),
    activeCollected: sumTicketEarnings(activeTickets),
    totalEarnings: sumTicketEarnings(scopedTickets),
    completedTripCount: completed.length,
    ticketCount: scopedTickets.length,
    passengerCount: scopedTickets.reduce((sum, t) => sum + t.qty, 0),
    distanceMetres: busDistance(sourceTrips),
    averageEarningsPerTrip: averageEarnings(sourceTrips, scopedTickets),
    byCategory: countByCategory(scopedTickets),
    trips: sortTrips(sourceTrips).slice(0, RECENT_LIMIT),
    recentTickets: [...scopedTickets]
      .sort((a, b) => b.issuedAt - a.issuedAt || b.id.localeCompare(a.id))
      .slice(0, RECENT_LIMIT),
    isShowingRecentTripFallback: shouldFallBack,
    fallbackDate: shouldFallBack ? fallbackDay : null,
  };
}
