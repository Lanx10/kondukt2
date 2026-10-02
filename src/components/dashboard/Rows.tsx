import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { ticketTotal, type Ticket, type Trip } from '../../data/konduktStore';
import { CategoryChip, LedgerRow } from '../LedgerRow';
import { placeSummary } from '../../lib/dashboardState';
import { passengerTypeLabel } from '../../lib/tripTicketsFormat';
import { formatShortTime } from '../../lib/tripScreenFormat';
import { formatDate, php } from '../../lib/format';
import { type, type KonduktTheme } from '../../theme';
import { useKonduktTheme } from '../../lib/themeContext';

/** What one trip's ledger adds up to, for the trip row's meta line. */
export type TripAggregate = {
  earnings: number;
  ticketCount: number;
  passengerCount: number;
};

/**
 * Per-trip totals, in one pass over the tickets.
 *
 * The live store's `Trip` carries no aggregates and no trip number, so the trip
 * row's earnings, ticket count and passenger count are all derived here rather
 * than read. One pass rather than three filters per trip: the Dashboard draws
 * six rows, and a filter per row per figure is eighteen passes over the ledger.
 */
export function useTripAggregates(tickets: Ticket[]): Map<string, TripAggregate> {
  return useMemo(() => {
    const totals = new Map<string, TripAggregate>();
    for (const ticket of tickets) {
      const slot = totals.get(ticket.tripId) ?? {
        earnings: 0,
        ticketCount: 0,
        passengerCount: 0,
      };
      slot.earnings += ticketTotal(ticket);
      slot.ticketCount += 1;
      slot.passengerCount += ticket.qty;
      totals.set(ticket.tripId, slot);
    }
    return totals;
  }, [tickets]);
}

const EMPTY: TripAggregate = {
  earnings: 0,
  ticketCount: 0,
  passengerCount: 0,
};

export { EMPTY as EMPTY_AGGREGATE };

/**
 * The Dashboard's two lists, in the shared ledger row.
 *
 * Both take a `stacked` flag the screen passes down, because the reference
 * stacks its rows on width *or* font scale and a row that decided for itself
 * would be the one place the two thresholds could disagree.
 */
export function TripRow({
  trip,
  aggregate,
  stacked,
  onPress,
}: {
  trip: Trip;
  aggregate: TripAggregate;
  stacked: boolean;
  onPress?: () => void;
}) {
  const route = placeSummary(trip.origin, trip.destination);
  const distance =
    trip.distanceMetres > 0 ? `${(trip.distanceMetres / 1000).toFixed(1)} km` : 'distance not recorded';
  const active = trip.status === 'ACTIVE';
  const counts =
    `${aggregate.ticketCount} ${aggregate.ticketCount === 1 ? 'ticket' : 'tickets'} · ` +
    `${aggregate.passengerCount} ${aggregate.passengerCount === 1 ? 'passenger' : 'passengers'}`;

  return (
    <LedgerRow
      tone="primary"
      icon="bus"
      title={route}
      sub={
        active
          ? `In progress · ${formatShortTime(trip.startedAt)}`
          : formatShortTime(trip.startedAt)
      }
      meta={`${counts} · ${distance}`}
      status={active ? 'In progress' : 'Completed'}
      amount={php(aggregate.earnings)}
      amountLabel="EARNINGS"
      chevron
      stacked={stacked}
      onPress={onPress}
      accessibilityHint="Opens the trip"
      accessibilityLabel={`${route}, ${active ? 'in progress' : 'completed'}, started ${formatShortTime(
        trip.startedAt,
      )}. ${counts}, ${distance}, earnings ${php(aggregate.earnings)}.`}
    />
  );
}

export function TicketRow({
  ticket,
  stacked,
  onPress,
}: {
  ticket: Ticket;
  stacked: boolean;
  onPress?: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const route = placeSummary(ticket.from, ticket.to);
  const total = ticketTotal(ticket);
  // The stored category reads `Pwd` / `Senior Citizen`; the reference and the
  // History screen both label them `PWD` / `Senior citizen`, so the row speaks
  // in the same words as the rest of the app.
  const categoryLabel = passengerTypeLabel(ticket.category);

  return (
    <LedgerRow
      tone="secondary"
      icon="ticket"
      title={`#${ticket.id}`}
      titleSuffix={formatDate(new Date(ticket.issuedAt))}
      sub={route}
      // The reference prints the category as a chip, then the quantity — a fare
      // line is per passenger, so the count is the other half of the reading.
      subExtra={
        <>
          <CategoryChip label={categoryLabel} />
          <Text style={styles.qty}>{`· Qty ${ticket.qty}`}</Text>
        </>
      }
      amount={php(total)}
      amountLabel={`EACH ${php(ticket.fareEach)}`}
      chevron
      stacked={stacked}
      onPress={onPress}
      accessibilityHint="Opens the ticket"
      accessibilityLabel={`Ticket number ${ticket.id}, ${formatDate(
        new Date(ticket.issuedAt),
      )}. ${route}, ${categoryLabel}, quantity ${ticket.qty}. ${php(
        ticket.fareEach,
      )} each, ${php(total)} total.`}
    />
  );
}

/**
 * The quantity suffix, from the theme.
 *
 * This read the light `palette` at module scope, so in Dark mode the "· Qty 3"
 * beside a ticket's category chip rendered light-theme grey on a dark ledger
 * row — a row whose other text had already been fixed by a theme-aware parent.
 */
const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
    qty: {
      ...type.bodySmall,
      color: theme.palette.onSurfaceVariant,
    },
  });
