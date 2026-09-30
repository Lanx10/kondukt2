import { ticketTotal, type Ticket, type Trip } from '../data/konduktStore';
import { round2 } from './format';

/**
 * The three Dashboard numbers, as pure functions.
 *
 * They live here rather than inside the Dashboard component for two reasons.
 * First, they are the business rules the spec calls the classic bug site: they
 * look interchangeable and are not. Second, pure functions over a plain array
 * are the only part of this data path that can be tested without a renderer,
 * a store, or a device.
 */

/** Fares belong to the ticket, not the trip — summing trip rows loses money. */
export function sumTicketEarnings(tickets: Ticket[]): number {
  return round2(tickets.reduce((sum, ticket) => sum + ticketTotal(ticket), 0));
}

/**
 * Distance across completed trips only.
 *
 * The filter comes first, deliberately. Summing then filtering divides a
 * partly-raw total by a filtered count, and the two disagree the moment an
 * active trip is in range.
 */
export function busDistance(trips: Trip[]): number {
  return trips
    .filter((trip) => trip.status === 'COMPLETED')
    .reduce((sum, trip) => sum + trip.distanceMetres, 0);
}

/**
 * Average across completed trips, floored to whole pesos.
 *
 * Takes the trip list rather than a ticket count on purpose. The caller cannot
 * pass "the completed tickets" here without re-deriving the membership rule, and
 * the rule — fares belonging to COMPLETED trips only — is precisely the thing
 * that gets conflated with totalEarnings. Deriving it inside makes the
 * difference structural instead of a thing to remember at the call site.
 *
 * Returns 0 rather than NaN when there is nothing to average: a dashboard
 * showing "—" is fine, one showing `NaN` is a bug the user is asked to read.
 */
export function averageEarnings(trips: Trip[], tickets: Ticket[]): number {
  const completed = new Set(
    trips.filter((trip) => trip.status === 'COMPLETED').map((trip) => trip.id),
  );
  const count = completed.size;
  if (count === 0) return 0;
  const earned = sumTicketEarnings(tickets.filter((ticket) => completed.has(ticket.tripId)));
  // Floored, not rounded: a dashboard total should never read higher than the
  // sum of the rows it summarises.
  return Math.floor(earned / count);
}
