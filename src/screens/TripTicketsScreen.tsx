import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { SectionChrome } from '../components/SectionChrome';
import { SectionHeader } from '../components/SectionHeader';
import { LocalStorageCard } from '../components/LocalStorageCard';
import { GlassCard } from '../components/GlassCard';
import { Skeleton } from '../components/SummaryDisclosure';
import { Icon } from '../icons';
import { cardShadowFor, onAmber, onPrimarySolid, radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import {
  fetchTripWithTickets,
  subscribeToTripWithTickets,
} from '../data/tripTicketsStore';
import type { TicketRowRecord } from '../data/schema';
import {
  RECENT_TICKET_LIMIT,
  toLoadState,
  type LoadState,
  type TicketRow,
  type TripTicketsUiState,
} from '../lib/tripTicketsState';
import {
  centavos,
  formatRowStamp,
  passengerTypeLabel,
} from '../lib/tripTicketsFormat';
import { plural } from '../lib/historyState';
import { formatDate } from '../lib/format';
import { ROW_STACK_WIDTH } from '../lib/layout';

export type TripTicketsScreenProps = {
  onBack: () => void;
  /** Existing trip management destination. */
  onOpenTrip: () => void;
  /** Existing add-ticket flow, opened for this trip. */
  onAddTicket: (tripId: number) => void;
  /** Existing ticket-history destination. */
  onViewAllTickets: () => void;
  /** Existing ticket detail, opened for this ticket. */
  onOpenTicket: (tripId: number, ticketId: number) => void;

  tripId: number;
  /** True when the trip is being viewed without recording rights. */
  readOnly?: boolean;
};

/**
 * One decimal, and never a bare 0: a route nobody measured prints the words,
 * which is what the reference's kmText does. The registry-grade three-decimal
 * form belongs to config screens, not to a trip card.
 */
const kmText = (milliKm: number) =>
  milliKm > 0 ? `${(milliKm / 1000).toFixed(1)} km` : 'Distance not recorded';

/**
 * The Trip Tickets screen.
 *
 * One trip's identity, its money, and the ledger of every ticket recorded
 * against it — the reference's (trip-tickets.html) layout, over the local
 * store, which is the source of truth.
 *
 * ONE CARD, NOT THREE. Identity, route, the collected figure and the three
 * derived numbers share the hero card, so the peso sits on the route it is
 * about; the card itself is not a button — its only control is Record a fare.
 * The gate note under the card names which of the two reasons applies
 * (closed trip, no recording rights) and says what still works.
 *
 * Reading is never gated, only writing: every ledger row opens its ticket in
 * all six states, and VIEW ALL is a reading action so it is never gated
 * either. The ledger shows the first RECENT_TICKET_LIMIT rows and says so.
 *
 * Branching is the `LoadState` union and nothing else: loading, missing trip,
 * failed read, content. Recovery from a failed read goes through Read records
 * again, which resubscribes to the same queries.
 */
export function TripTicketsScreen({
  onBack,
  onOpenTrip,
  onAddTicket,
  onViewAllTickets,
  onOpenTicket,
  tripId,
  readOnly = false,
}: TripTicketsScreenProps) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const stackedRows = width < ROW_STACK_WIDTH;

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  // Retry is the only recovery from a failed read: it resubscribes by
  // re-running the same effect path — both queries, never a cached replay.
  const [retryToken, setRetryToken] = useState(0);
  const refresh = useCallback(() => setRetryToken((token) => token + 1), []);

  useEffect(() => {
    // Initial read through the same path as a store change, so the first
    // paint and every repaint are one mechanism. The read itself is async —
    // the effect body only kicks it off and subscribes; the setState calls
    // happen in the promise callbacks, not in the effect body.
    let cancelled = false;
    const run = () =>
      fetchTripWithTickets(tripId)
        .then((read) => {
          if (!cancelled) setLoad(toLoadState(read));
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setLoad({
              kind: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'The records on this device could not be read.',
            });
        });
    run();
    const unsubscribe = subscribeToTripWithTickets(tripId, run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tripId, retryToken]);

  // The chrome subtitle is the screen's state line: one variable decides it,
  // so the pill above and the card below can never disagree.
  if (load.kind === 'loading') {
    return (
      <ScreenChrome onBack={onBack} title="Trip tickets" subtitle="Loading records" insets={insets}>
        <View
          style={styles.gutter}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel="Loading trip records"
        >
          <GlassCard style={styles.heroCard}>
            <Skeleton height={12} style={styles.skEyebrow} />
            <Skeleton height={26} style={styles.skRoute} />
            <Skeleton height={16} style={styles.skDetail} />
            <Skeleton height={32} style={styles.skMoney} />
            <View style={styles.skFigs}>
              <Skeleton height={30} style={styles.skFig} />
              <Skeleton height={30} style={styles.skFig} />
              <Skeleton height={30} style={styles.skFig} />
            </View>
            <Skeleton height={48} style={styles.skBtn} />
          </GlassCard>
        </View>
        <SectionHeader title="TICKET LEDGER" width={width} />
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} height={91} style={styles.skRow} />
        ))}
        <StorageFooter />
      </ScreenChrome>
    );
  }

  if (load.kind === 'error') {
    return (
      <ScreenChrome onBack={onBack} title="Trip tickets" subtitle="Records unreadable" insets={insets}>
        <View style={styles.gutter}>
          <GlassCard
            tint={theme.palette.errorContainer}
            style={styles.heroCard}
            accessible
            accessibilityRole="alert"
            accessibilityLabel={`Records unavailable. Could not read the trip records. ${load.message}`}
          >
            <Text style={styles.errorEyebrow}>RECORDS UNAVAILABLE</Text>
            <Text style={styles.heroRoute}>Could not read the trip records</Text>
            <Text style={styles.stateText}>
              Nothing was lost. The trips and fares are still on this device, and reading them
              again is safe.
            </Text>
            <View style={styles.cardActions}>
              <Pressable
                onPress={refresh}
                accessibilityRole="button"
                accessibilityLabel="Read records again"
                style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
              >
                <Text style={styles.primaryActionLabel}>Read records again</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
        <SectionHeader
          title="TICKET LEDGER"
          actionLabel="VIEW ALL"
          onAction={onViewAllTickets}
          width={width}
        />
        <StorageFooter />
      </ScreenChrome>
    );
  }

  if (load.kind === 'notFound') {
    return (
      <ScreenChrome onBack={onBack} title="Trip tickets" subtitle="Trip not found" insets={insets}>
        <View style={styles.gutter}>
          <GlassCard
            style={styles.heroCard}
            accessible
            accessibilityLabel="No such trip. Trip not found. No trip with this record exists on this device."
          >
            <Text style={styles.heroEyebrowText}>NO SUCH TRIP</Text>
            <Text style={styles.heroRoute}>Trip not found</Text>
            <Text style={styles.stateText}>
              No trip with this record exists on this device.
            </Text>
            <View style={styles.cardActions}>
              <Pressable
                onPress={onOpenTrip}
                accessibilityRole="button"
                accessibilityLabel="Go to trip"
                style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
              >
                <Text style={styles.primaryActionLabel}>Go to trip</Text>
              </Pressable>
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={({ pressed }) => [styles.quietAction, pressed && styles.pressed]}
              >
                <Text style={styles.quietActionLabel}>Go back</Text>
              </Pressable>
            </View>
          </GlassCard>
        </View>
        <SectionHeader
          title="TICKET LEDGER"
          actionLabel="VIEW ALL"
          onAction={onViewAllTickets}
          width={width}
        />
        <StorageFooter />
      </ScreenChrome>
    );
  }

  const state = load.state;
  const { trip } = state;
  // Writing requires a live trip AND recording rights. Reading is never
  // gated: rows and VIEW ALL open in every state.
  const canRecord = !readOnly && trip.status === 'ACTIVE';
  const capped = state.ticketHistory.length > RECENT_TICKET_LIMIT;

  return (
    <ScreenChrome
      onBack={onBack}
      title="Trip tickets"
      subtitle={`Trip #${trip.trip_number} · ${plural(state.totalTickets, 'fare')}`}
      insets={insets}
    >
      <FlatList
        // The cap is applied here, once — the reference's RECENT_TICKET_LIMIT.
        data={state.recentTickets}
        keyExtractor={(row) => String(row.ticketId)}
        // The header is everything above the ledger; the rows are the list.
        // FlatList owns the scrolling so the ledger virtualizes.
        ListHeaderComponent={
          <>
            {/* One card: identity, route, money, figures, the one action. */}
            <TripHero state={state} canRecord={canRecord} onRecord={() => onAddTicket(trip.id)} />

            {/* Which of the two reasons applies, and what still works. */}
            {canRecord ? null : <GateNote state={state} readOnly={readOnly} />}

            <SectionHeader
              title="TICKET LEDGER"
              actionLabel="VIEW ALL"
              onAction={onViewAllTickets}
              width={width}
            />
            {state.ticketHistory.length === 0 ? (
              <GlassCard style={styles.emptyCard}>
                <Text style={styles.stateHeading} accessibilityRole="header">
                  NO TICKETS ON THIS TRIP
                </Text>
                <Text style={styles.emptyText} accessibilityLiveRegion="polite">
                  {canRecord
                    ? 'Record a fare and it appears here, newest first.'
                    : 'This trip closed with nothing recorded against it.'}
                </Text>
              </GlassCard>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          // Reading a fare is never gated — only writing one is.
          <LedgerRow
            row={item}
            stacked={stackedRows}
            onPress={() => onOpenTicket(trip.id, item.ticketId)}
          />
        )}
        ListFooterComponent={
          <>
            {capped ? (
              <Text style={styles.capLine}>
                {`Showing the ${RECENT_TICKET_LIMIT} most recent of ${state.totalTickets} recorded fares.`}
              </Text>
            ) : null}
            <StorageFooter />
          </>
        }
        contentContainerStyle={{
          paddingBottom: insets.bottom + space(9),
        }}
        showsVerticalScrollIndicator={false}
      />
    </ScreenChrome>
  );
}

/**
 * The chrome every branch shares. Extracted to `SectionChrome` so the Trip
 * screen renders the identical header; this file now only supplies props.
 */
function ScreenChrome(props: React.ComponentProps<typeof SectionChrome>) {
  return <SectionChrome {...props} />;
}

/**
 * The hero: identity, route, the collected figure, the three derived numbers,
 * and the one action. Amber solid while the trip runs, glass once it closes —
 * the app-wide invariant that amber means a trip is running. Not a button:
 * its only control is Record a fare.
 */
function TripHero({
  state,
  canRecord,
  onRecord,
}: {
  state: TripTicketsUiState;
  canRecord: boolean;
  onRecord: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const trip = state.trip;
  const active = trip.status === 'ACTIVE';
  const detail = [
    kmText(trip.distance_km_milli),
    `started ${formatRowStamp(trip.started_at)}`,
    formatDate(new Date(trip.started_at)),
    // A running trip has no end time; the reference only names it when it is
    // known and the trip is closed.
    !active && trip.ended_at !== null ? `ended ${formatRowStamp(trip.ended_at)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const body = (
    <>
      <View style={styles.heroEyebrow}>
        <Text style={[styles.heroEyebrowText, active && styles.heroEyebrowTextSolid]}>
          {active ? 'TRIP IN PROGRESS' : 'TRIP COMPLETED'}
        </Text>
        <View style={[styles.heroPill, active && styles.heroPillSolid]}>
          <Text style={[styles.heroPillText, active && styles.heroPillTextSolid]}>
            {`TRIP #${trip.trip_number}`}
          </Text>
        </View>
      </View>

      <Text style={[styles.heroRoute, active && styles.heroRouteSolid]}>
        {trip.origin_location_snapshot} → {trip.destination_location_snapshot}
      </Text>
      <Text style={[styles.heroDetail, active && styles.heroDetailSolid]}>{detail}</Text>

      <Text style={[styles.heroLead, active && styles.heroLeadSolid]}>
        {state.totalEarnings > 0 ? centavos(state.totalEarnings) : '—'}
      </Text>
      <Text style={[styles.heroLeadCap, active && styles.heroLeadCapSolid]}>
        COLLECTED ON THIS TRIP
      </Text>

      <View style={[styles.heroFigures, active && styles.heroFiguresSolid]}>
        <HeroFigure label="FARES" value={String(state.totalTickets)} solid={active} />
        <HeroFigure label="PASSENGERS" value={String(state.totalPassengers)} solid={active} />
        <HeroFigure
          label="AVG PER PAX"
          value={state.totalPassengers > 0 ? centavos(state.averageFarePerPassenger) : '—'}
          solid={active}
        />
      </View>

      {canRecord ? (
        <View style={styles.cardActions}>
          <Pressable
            onPress={onRecord}
            accessibilityRole="button"
            accessibilityLabel="Record a fare"
            accessibilityHint="Opens the fare sheet for this trip"
            style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
          >
            <Icon name="ticket" size={18} color={onPrimarySolid} />
            <Text style={styles.primaryActionLabel}>Record a fare</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.gutter}>
      {active ? (
        // The app-wide invariant: the running trip is the one solid amber
        // card — no rim, no tint, no sheen over it.
        <View style={[styles.heroCard, styles.heroSolid]}>{body}</View>
      ) : (
        <GlassCard style={styles.heroCard}>{body}</GlassCard>
      )}
    </View>
  );
}

/** One figure in the hero's row: the value, then its label. */
function HeroFigure({ label, value, solid }: { label: string; value: string; solid: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.heroFigure}>
      <Text style={[styles.heroFigureValue, solid && styles.heroFigureValueSolid]}>
        {value}
      </Text>
      <Text style={[styles.heroFigureLabel, solid && styles.heroFigureLabelSolid]}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The gate note: two reasons a fare cannot be recorded, and it must say which
 * one applies — plus that reading every ticket still works.
 */
function GateNote({ state, readOnly }: { state: TripTicketsUiState; readOnly: boolean }) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const trip = state.trip;
  const closed = trip.status !== 'ACTIVE';
  const stamp =
    trip.ended_at !== null
      ? `${formatRowStamp(trip.ended_at)} on ${formatDate(new Date(trip.ended_at))}`
      : null;

  const body = closed
    ? state.totalTickets === 0
      ? `Trip #${trip.trip_number} closed${stamp ? ` ${stamp}` : ''}. Nothing was recorded against it, and no new fares can be added.`
      : `Trip #${trip.trip_number} closed${stamp ? ` ${stamp}` : ''}. Its ${plural(
          state.totalTickets,
          'ticket',
        )} and ${centavos(state.totalEarnings)} stay on it for good and every one still opens — only adding new ones is refused.`
    : state.totalTickets === 0
      ? `It was opened without recording rights, so no new tickets can be added to trip #${trip.trip_number}, and no tickets were recorded on it.`
      : `It was opened without recording rights, so no new tickets can be added to trip #${trip.trip_number}. The ${plural(
          state.totalTickets,
          'ticket',
        )} already on it are complete, and every one of them still opens.`;

  return (
    <GlassCard
      style={styles.gate}
      accessible
      accessibilityLabel={`${closed ? 'This trip is closed' : 'New fares are refused here'}. ${body}`}
    >
      <View style={styles.gateChip}>
        <Icon name="lock" size={18} color={theme.accent.tertiary.onContainer} />
      </View>
      <View style={styles.gateBody}>
        <Text style={styles.gateTitle}>
          {closed ? 'THIS TRIP IS CLOSED' : 'NEW FARES ARE REFUSED HERE'}
        </Text>
        <Text style={styles.gateText}>{body}</Text>
      </View>
    </GlassCard>
  );
}

/**
 * One ledger row: the time leads, then the category chip with the unit price
 * and the passenger count, then the peso with the ticket number under it. The
 * route is deliberately absent — the card above already says it once — and the
 * row opens in every state, because reading a fare is never gated.
 */
function LedgerRow({
  row,
  stacked,
  onPress,
}: {
  row: TicketRow;
  stacked: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const label =
    `${formatRowStamp(row.createdAt)}, ${formatDate(new Date(row.createdAt))}. ` +
    `${passengerTypeLabel(row.passengerType)}, ${plural(row.passengerQuantity, 'passenger')} ` +
    `at ${centavos(row.farePerPassenger)} each, ${centavos(row.totalFare)} total. ` +
    `Ticket number ${row.ticketId}.`;

  const sub = `${centavos(row.farePerPassenger)} each · ${row.passengerQuantity} pax`;
  const fare = (
    <>
      <Text style={styles.fareValueEmphasis}>{centavos(row.totalFare)}</Text>
      <Text style={styles.ticketNo}>{`#${row.ticketId}`}</Text>
    </>
  );

  return (
    <View style={styles.gutter}>
      <Pressable
        onPress={onPress}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the ticket"
        style={({ pressed }) => [styles.ledgerPressable, pressed && styles.pressed]}
      >
        <GlassCard
          cornerRadius={radius.large}
          style={[styles.ledgerCard, stacked && styles.ledgerCardStacked]}
        >
          {stacked ? (
            <>
              <View style={styles.ledgerHead}>
                <View>
                  <Text style={styles.ledgerTime}>{formatRowStamp(row.createdAt)}</Text>
                  <Text style={styles.ledgerDate}>{formatDate(new Date(row.createdAt))}</Text>
                </View>
                <View style={styles.fareCol}>{fare}</View>
              </View>
              <View style={styles.tagRow}>
                <CategoryChip type={row.passengerType} />
                <Text style={styles.ledgerSub}>{sub}</Text>
              </View>
            </>
          ) : (
            <>
              {/* Fixed 74px: the measured worst-case time, so the column is
                  identical row to row whether or not the font is tabular. */}
              <View style={styles.timeBlock}>
                <Text style={styles.ledgerTime}>{formatRowStamp(row.createdAt)}</Text>
                <Text style={styles.ledgerDate}>{formatDate(new Date(row.createdAt))}</Text>
              </View>
              <View style={styles.ledgerBody}>
                <CategoryChip type={row.passengerType} />
                <Text style={styles.ledgerSub}>{sub}</Text>
              </View>
              <View style={styles.fareCol}>{fare}</View>
            </>
          )}
        </GlassCard>
      </Pressable>
    </View>
  );
}

/**
 * Category chip. Regular on the primary container, the three discounted types
 * on the tertiary one — never amber, which is reserved for a running trip.
 */
function CategoryChip({ type }: { type: TicketRowRecord['passenger_type'] }) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const discounted = type !== 'REGULAR';
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: discounted ? theme.accent.tertiary.container : theme.accent.primary.container },
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          { color: discounted ? theme.accent.tertiary.onContainer : theme.accent.primary.onContainer },
        ]}
      >
        {passengerTypeLabel(type)}
      </Text>
    </View>
  );
}

/** The storage footer, under every branch. */
function StorageFooter() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.storageSlot}>
      <LocalStorageCard />
      <Text style={styles.footnote}>{'Kondukt — fares stay on this device.'}</Text>
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  pressed: { opacity: 0.88 },

  // The reference's chrome margin: the card takes its top air from the
  // section rhythm, 20px.
  gutter: { marginHorizontal: space(5), marginTop: space(5) },

  // ── the hero card ──
  heroCard: { padding: space(5) },
  // The one solid card in the app: amber, no rim, no tint, no sheen.
  heroSolid: {
    backgroundColor: theme.palette.secondary,
    borderRadius: radius.glass,
    ...cardShadowFor(theme),
    // Only the shadow's colour follows the mode — the geometry is the card's.
    shadowColor: theme.glass.shadow,
  },
  heroEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    flexWrap: 'wrap',
  },
  heroEyebrowText: { ...type.labelSmall, color: theme.palette.onSurfaceVariant },
  heroEyebrowTextSolid: { color: onAmber.detail },
  heroPill: {
    height: 24,
    paddingHorizontal: space(2.5),
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.secondaryContainer,
  },
  heroPillSolid: { backgroundColor: theme.palette.onSecondary },
  heroPillText: { ...type.labelSmall, color: theme.palette.onSecondaryContainer },
  heroPillTextSolid: { color: theme.palette.secondary },
  heroRoute: {
    ...type.headlineSmall,
    color: theme.palette.onSurface,
    marginTop: space(1.5),
  },
  heroRouteSolid: { color: onAmber.primary },
  heroDetail: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginTop: space(1),
    fontVariant: ['tabular-nums'],
  },
  heroDetailSolid: { color: onAmber.muted },
  heroLead: {
    ...type.displaySmall,
    color: theme.palette.onSurface,
    marginTop: space(3.5),
    fontVariant: ['tabular-nums'],
  },
  heroLeadSolid: { color: onAmber.primary },
  heroLeadCap: { ...type.labelSmall, color: theme.palette.onSurfaceVariant, marginTop: space(0.5) },
  heroLeadCapSolid: { color: onAmber.detail },
  heroFigures: {
    flexDirection: 'row',
    gap: space(5),
    marginTop: space(3.5),
    paddingTop: space(3.5),
    borderTopWidth: 1,
    borderTopColor: theme.palette.outline,
  },
  heroFiguresSolid: { borderTopColor: 'rgba(61, 46, 0, 0.7)' },
  heroFigure: { minWidth: 0 },
  heroFigureValue: {
    ...type.titleMedium,
    fontFamily: 'Poppins_700Bold',
    color: theme.palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  heroFigureValueSolid: { color: onAmber.primary },
  heroFigureLabel: { ...type.labelSmall, color: theme.palette.onSurfaceVariant, marginTop: space(0.5) },
  heroFigureLabelSolid: { color: onAmber.detail },

  // ── buttons: one primary, one quiet ──
  cardActions: { flexDirection: 'row', gap: space(2), marginTop: space(4) },
  primaryAction: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    paddingHorizontal: space(5),
    borderRadius: radius.full,
    backgroundColor: theme.palette.primarySolid,
  },
  primaryActionLabel: { ...type.labelLarge, color: onPrimarySolid },
  quietAction: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(5),
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: theme.palette.outline,
  },
  quietActionLabel: { ...type.labelLarge, color: theme.palette.onSurface },

  // ── the gate note ──
  gate: {
    flexDirection: 'row',
    gap: space(3),
    marginHorizontal: space(5),
    marginTop: space(5),
    paddingVertical: space(4),
    paddingHorizontal: space(5),
    borderRadius: radius.large,
  },
  gateChip: {
    width: 40,
    height: 40,
    borderRadius: radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent.tertiary.container,
    flexShrink: 0,
  },
  gateBody: { flex: 1 },
  gateTitle: { ...type.labelSmall, color: theme.palette.onSurface },
  gateText: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(1) },

  // ── ledger ──
  capLine: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginHorizontal: space(5),
    marginTop: space(2.5),
  },
  emptyCard: {
    marginHorizontal: space(5),
    marginTop: space(3),
    padding: space(5),
  },
  stateHeading: { ...type.titleMedium, color: theme.palette.onSurface },
  emptyText: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(1.5) },

  ledgerPressable: {},
  ledgerCard: {
    padding: space(5),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    minHeight: 91,
  },
  ledgerCardStacked: { flexDirection: 'column', alignItems: 'stretch', gap: space(2) },
  ledgerHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  // Fixed, not content-sized: the measured widest time/date the column holds.
  timeBlock: { width: 74 },
  ledgerTime: { ...type.titleMedium, color: theme.palette.onSurface, fontVariant: ['tabular-nums'] },
  ledgerDate: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(0.5) },
  ledgerBody: { flex: 1, minWidth: 0 },
  ledgerSub: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(1) },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' },
  fareCol: { alignItems: 'flex-end', gap: space(1) },
  fareValueEmphasis: {
    ...type.titleMedium,
    fontFamily: 'Poppins_700Bold',
    color: theme.palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  ticketNo: { ...type.bodySmall, color: theme.palette.onSurfaceVariant },

  chip: {
    minHeight: 26,
    paddingHorizontal: space(2.5),
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  chipLabel: { ...type.labelSmall },

  // ── states ──
  skEyebrow: { width: 130 },
  skRoute: { width: '70%', marginTop: space(3) },
  skDetail: { width: '60%', marginTop: space(2) },
  skMoney: { width: 120, marginTop: space(3.5) },
  skFigs: {
    flexDirection: 'row',
    gap: space(5),
    marginTop: space(4),
    paddingTop: space(3.5),
    borderTopWidth: 1,
    borderTopColor: theme.palette.outline,
  },
  skFig: { flex: 1 },
  skBtn: { borderRadius: radius.full, marginTop: space(4) },
  skRow: {
    marginHorizontal: space(5),
    marginTop: space(3),
    borderRadius: radius.large,
  },

  errorEyebrow: { ...type.labelSmall, color: theme.palette.error },
  stateText: { ...type.bodyMedium, color: theme.palette.onSurfaceVariant, marginTop: space(1) },

  // ── footer ──
  storageSlot: { marginTop: space(4) },
  footnote: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    textAlign: 'center',
    paddingTop: space(4),
    paddingBottom: space(1),
  },
});
