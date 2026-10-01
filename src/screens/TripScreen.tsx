import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SectionChrome } from '../components/SectionChrome';
import { LocalStorageCard } from '../components/LocalStorageCard';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../icons';
import { accent, glass, palette, radius, space, type } from '../theme';
import {
  endActiveTrip,
  fetchTripBoard,
  subscribeToTrips,
  type EndTripResult,
} from '../data/tripTicketsStore';
import type { TripRowRecord } from '../data/schema';
import { tripNumber, tripRoute } from '../data/tripHelpers';
import { formatElapsed, formatMediumDate, formatShortTime } from '../lib/tripScreenFormat';
import { distanceKm } from '../lib/tripTicketsFormat';
import { ROW_STACK_WIDTH } from '../lib/layout';
import { useUpdateGuard } from '../lib/updateGuard';

/** Caps for the reader, sentence case on screen: the reference's own pairing. */
const RECENT_LABEL = 'RECENT COMPLETED TRIPS';

export type TripScreenProps = {
  onBack: () => void;
  /** Opens Trip Tickets for a trip — the ledger, not a history screen. */
  onOpenTickets: (tripId: number) => void;
  /** Opens the add-trip flow. Only offered when no trip is running. */
  onAddTrip: () => void;
  /** Opens History — the full trip list. */
  onViewAllTrips: () => void;
};

/**
 * The Trip screen.
 *
 * Answers one question — is a trip running right now — and lets the conductor
 * act on it: record a ticket, end the trip, start a trip when none is active,
 * or jump into a recent completed trip. The store is the source of truth: the
 * board is observed live, so ending a trip repaints this screen through the
 * store's own notification and no refresh control exists.
 *
 * The elapsed clock is derived, never stored: recomputed each second from
 * `now − started_at`, clamped at zero against clock changes. It holds a
 * non-zero keepalive while mounted — a zero holdoff froze the clock whenever
 * the screen lost focus.
 */
export function TripScreen({ onBack, onOpenTickets, onAddTrip, onViewAllTrips }: TripScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const stacked = width < ROW_STACK_WIDTH;
  // Ending the running trip is a transaction: no update sheet may open over
  // its confirm, and no restart may land mid-press. See updateGuard.
  useUpdateGuard('trip-management');

  type LoadState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; active: TripRowRecord | null; recentCompleted: TripRowRecord[] };

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [retryToken, setRetryToken] = useState(0);
  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      fetchTripBoard()
        .then((board) => {
          if (!cancelled)
            setLoad({
              kind: 'ready',
              active: board.active,
              recentCompleted: board.recentCompleted,
            });
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setLoad({
              kind: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'The trip records on this device could not be read.',
            });
        });
    run();
    const unsubscribe = subscribeToTrips(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [retryToken]);

  if (load.kind === 'loading') {
    return (
      <SectionChrome title="Trip" subtitle="Trip and route management" onBack={onBack} insets={insets}>
        <View style={styles.stateSlot}>
          <Text style={styles.stateText} accessibilityLiveRegion="polite">
            Loading trips…
          </Text>
        </View>
      </SectionChrome>
    );
  }

  if (load.kind === 'error') {
    return (
      <SectionChrome title="Trip" subtitle="Trip and route management" onBack={onBack} insets={insets}>
        <View style={[styles.stateSlot, styles.errorSlot]}>
          <Text style={styles.stateHeading} accessibilityRole="header">
            Trips could not be read
          </Text>
          <Text style={styles.stateText} accessibilityLiveRegion="polite">
            {load.message}
          </Text>
          <Pressable
            onPress={retry}
            accessibilityRole="button"
            accessibilityLabel="Retry reading trips"
            style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
          >
            <Text style={styles.primaryActionLabel}>Retry</Text>
            <Icon name="history" size={16} color={palette.onPrimary} />
          </Pressable>
        </View>
      </SectionChrome>
    );
  }

  return (
    <SectionChrome title="Trip" subtitle="Trip and route management" onBack={onBack} insets={insets}>
      <FlatList
        data={load.recentCompleted}
        keyExtractor={(trip) => String(trip.id)}
        ListHeaderComponent={
          <>
            <Text style={styles.sectionHeading} accessibilityRole="header">
              Current trip
            </Text>
            {load.active ? (
              <ActiveTripCard trip={load.active} />
            ) : (
              <EmptyCurrentTrip />
            )}
            {!load.active ? (
              <AddTripCard onPress={onAddTrip} />
            ) : (
              <ActiveTripActions trip={load.active} onOpenTickets={onOpenTickets} />
            )}

            {load.recentCompleted.length > 0 ? (
              <View style={styles.historyHeader}>
                <Text style={[styles.sectionHeading, styles.historyHeading]} accessibilityRole="header">
                  Recent completed trips
                </Text>
                <Pressable
                  onPress={onViewAllTrips}
                  accessibilityRole="button"
                  accessibilityLabel="View all trips"
                  hitSlop={12}
                  style={({ pressed }) => [styles.viewAll, pressed && styles.pressed]}
                >
                  <Text style={styles.viewAllLabel}>View all trips</Text>
                  <Icon name="chevron" size={14} color={glass.accentPrimary} />
                </Pressable>
              </View>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <CompletedTripRow
            trip={item}
            stacked={stacked}
            onPress={() => onOpenTickets(item.id)}
          />
        )}
        ListFooterComponent={
          <View style={styles.storageSlot}>
            <LocalStorageCard />
          </View>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + space(6) }}
        showsVerticalScrollIndicator={false}
      />
    </SectionChrome>
  );
}

/** The running trip: number, route, distance, start, live elapsed, status. */
function ActiveTripCard({ trip }: { trip: TripRowRecord }) {
  // One-second ticker, mounted with the screen and torn down with it. The
  // keepalive is non-zero — a zero holdoff froze the elapsed clock whenever
  // the screen lost focus and let it stutter on return.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    interval.current = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      if (interval.current) clearInterval(interval.current);
    };
  }, []);

  const elapsed = formatElapsed(nowTick - trip.started_at);
  const label =
    `Trip number ${tripNumber(trip)}. ${tripRoute(trip)}. In progress. ` +
    `Started ${formatShortTime(trip.started_at)}, ${formatMediumDate(trip.started_at)}. ` +
    `Running for ${elapsed}. ` +
    `${trip.distance_km_milli > 0 ? distanceKm(trip.distance_km_milli) : 'Distance not recorded'}.`;

  return (
    <View style={styles.gutter}>
      <View style={[styles.card, styles.cardActive]} accessible accessibilityLabel={label}>
        <View style={styles.pill}>
          <View style={styles.dot} />
          <Text style={styles.pillLabel}>In progress</Text>
        </View>
        <Text style={styles.activeRoute}>{tripRoute(trip)}</Text>
        <Text style={styles.activeMeta}>
          Trip #{tripNumber(trip)} ·{' '}
          {trip.distance_km_milli > 0 ? distanceKm(trip.distance_km_milli) : 'Distance not recorded'}
        </Text>
        <View style={styles.timesRow}>
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}>Started</Text>
            <Text style={styles.timeValue}>{formatShortTime(trip.started_at)}</Text>
            <Text style={styles.timeDate}>{formatMediumDate(trip.started_at)}</Text>
          </View>
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}>Elapsed</Text>
            <Text style={styles.elapsedValue}>{elapsed}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/** The two actions a running trip offers, held to 48dp. */
function ActiveTripActions({
  trip,
  onOpenTickets,
}: {
  trip: TripRowRecord;
  onOpenTickets: (tripId: number) => void;
}) {
  return (
    <View style={styles.gutter}>
      <Pressable
        onPress={() => onOpenTickets(trip.id)}
        accessibilityRole="button"
        accessibilityLabel={`Record a ticket on trip number ${tripNumber(trip)}`}
        style={({ pressed }) => [styles.actionButton, styles.recordButton, pressed && styles.pressed]}
      >
        <Icon name="ticket" size={20} color={palette.onSecondary} />
        <Text style={[styles.actionLabel, styles.recordLabel]}>Record ticket</Text>
      </Pressable>
      <EndTripButton trip={trip} />
    </View>
  );
}

/**
 * The end-trip action and its confirmation. The dialog states what the action
 * does and names the trip; cancel writes nothing; failure keeps the screen
 * open with the two causes distinguished — "already ended" refreshes instead
 * of offering a retry that can never succeed, while a write failure offers
 * retry, guarded so a discovery that the trip is gone stops the loop.
 */
function EndTripButton({ trip }: { trip: TripRowRecord }) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Extract<EndTripResult, 'noActiveTrip' | 'failed'> | null>(null);

  const confirm = () => {
    setPending(false);
    // Read at the moment of confirmation, not when the dialog opened.
    const endedAt = Date.now();
    void endActiveTrip(trip.id, endedAt).then((result) => {
      if (result === 'ended') {
        setFailure(null);
        // The store's change notification repaints this screen: the trip
        // leaves "Current trip" and appears in the completed list on its own.
        return;
      }
      setFailure(result);
    });
  };

  return (
    <View>
      <Pressable
        onPress={() => setPending(true)}
        accessibilityRole="button"
        accessibilityLabel={`End trip number ${tripNumber(trip)}. It moves to the completed list.`}
        style={({ pressed }) => [styles.actionButton, styles.endButton, pressed && styles.pressed]}
      >
        <Icon name="bus" size={20} color={palette.onError} />
        <Text style={[styles.actionLabel, styles.endLabel]}>End trip</Text>
      </Pressable>

      {failure === 'noActiveTrip' ? (
        <GlassCard style={styles.failureNote}>
          <Text style={styles.failureText}>
            This trip was already ended — possibly from another screen. The list below is refreshed.
          </Text>
        </GlassCard>
      ) : null}
      {failure === 'failed' ? (
        <View style={styles.failureNote}>
          <Text style={styles.failureText}>The trip could not be ended. </Text>
          <Pressable
            onPress={confirm}
            accessibilityRole="button"
            accessibilityLabel="Retry ending the trip"
            style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
          >
            <Text style={styles.textActionLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <EndTripDialog
        visible={pending}
        trip={trip}
        onCancel={() => {
          setPending(false);
          setFailure(null);
        }}
        onConfirm={confirm}
      />
    </View>
  );
}

/** The confirmation dialog. Destructive action is marked for assistive tech. */
function EndTripDialog({
  visible,
  trip,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  trip: TripRowRecord;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!visible) return null;
  return (
    <View style={styles.dialogScrim}>
      <GlassCard style={styles.dialogCard}>
        <Text style={styles.dialogTitle} accessibilityRole="header">
          End trip #{tripNumber(trip)}?
        </Text>
        <Text style={styles.dialogText}>
          This trip moves to the completed list below. Tickets already recorded stay on it.
        </Text>
        <View style={styles.dialogActions}>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel, keep the trip running"
            style={({ pressed }) => [styles.dialogCancel, pressed && styles.pressed]}
          >
            <Text style={styles.dialogCancelLabel}>Keep running</Text>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel="Confirm: end this trip"
            accessibilityState={{ busy: false }}
            style={({ pressed }) => [styles.dialogConfirm, pressed && styles.pressed]}
          >
            <Text style={styles.dialogConfirmLabel}>End trip</Text>
          </Pressable>
        </View>
      </GlassCard>
    </View>
  );
}

/** Empty current-trip state, in the Home empty-card language. */
function EmptyCurrentTrip() {
  return (
    <View style={styles.gutter}>
      <GlassCard style={styles.card}>
        <Text style={styles.emptyHeading} accessibilityRole="header">
          No active trip
        </Text>
        <Text style={styles.emptyText} accessibilityLiveRegion="polite">
          Start a trip to record fares against it.
        </Text>
      </GlassCard>
    </View>
  );
}

/** The add-trip action, only ever shown when no trip is running. */
function AddTripCard({ onPress }: { onPress: () => void }) {
  return (
    <GlassCard style={styles.gutter}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Add new trip"
        accessibilityHint="Opens the start-trip flow"
        style={({ pressed }) => [styles.addTrip, pressed && styles.cardPressed]}
      >
        <View style={[styles.addTripIcon, { backgroundColor: accent.primary.container }]}>
          <Icon name="bus" size={24} color={accent.primary.fg} />
        </View>
        <View style={styles.addTripBody}>
          <Text style={styles.addTripTitle}>Add new trip</Text>
          <Text style={styles.addTripText}>Start a new bus trip and set the route.</Text>
        </View>
        <Icon name="chevron" size={18} color={palette.outline} />
      </Pressable>
    </GlassCard>
  );
}

/** One completed trip. Opens its ticket list — not a history screen. */
function CompletedTripRow({
  trip,
  stacked,
  onPress,
}: {
  trip: TripRowRecord;
  stacked: boolean;
  onPress: () => void;
}) {
  const label =
    `${tripRoute(trip)}. Completed. ` +
    `Started ${formatShortTime(trip.started_at)}` +
    (trip.ended_at !== null ? ` · Ended ${formatShortTime(trip.ended_at)}.` : '.') +
    ` ${trip.distance_km_milli > 0 ? distanceKm(trip.distance_km_milli) : 'Distance not recorded'}.`;

  return (
    <View style={styles.gutter}>
      <Pressable
        onPress={onPress}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the trip's tickets"
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <GlassCard style={[styles.historyCard, stacked && styles.historyCardStacked]}>
          <View style={styles.historyIcon}>
            <Icon name="bus" size={20} color={accent.tertiary.fg} />
          </View>
          <View style={styles.historyBody}>
            <Text style={styles.historyRoute} numberOfLines={2}>
              {tripRoute(trip)}
            </Text>
            <Text style={styles.historyMeta}>
              {formatMediumDate(trip.started_at)} ·{' '}
              {trip.distance_km_milli > 0 ? distanceKm(trip.distance_km_milli) : 'Distance not recorded'}
            </Text>
            <Text style={styles.historyTimes}>
              Started {formatShortTime(trip.started_at)}
              {trip.ended_at !== null ? ` · Ended ${formatShortTime(trip.ended_at)}` : ''}
            </Text>
          </View>
          <Icon name="chevron" size={18} color={palette.outline} />
        </GlassCard>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  gutter: { marginHorizontal: space(5), marginTop: space(3) },
  pressed: { opacity: 0.88 },

  sectionHeading: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
    marginTop: space(5),
    marginBottom: space(1),
    marginHorizontal: space(5),
  },

  card: { padding: space(5) },
  cardActive: {
    backgroundColor: palette.secondary,
    borderRadius: radius.glass,
    shadowColor: 'rgba(90, 106, 130, 0.16)',
    shadowOpacity: 1,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cardPressed: { backgroundColor: 'rgba(255, 255, 255, 0.72)' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    alignSelf: 'flex-start',
    paddingHorizontal: space(2),
    paddingVertical: space(1),
    borderRadius: radius.full,
    backgroundColor: palette.onSecondary,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.secondary },
  pillLabel: { ...type.labelSmall, color: palette.secondary, letterSpacing: 0.6 },
  activeRoute: { ...type.titleMedium, color: palette.onSurface, marginTop: space(2) },
  activeMeta: {
    ...type.bodyMedium,
    color: palette.onSurfaceVariant,
    marginTop: space(1),
    fontVariant: ['tabular-nums'],
  },

  timesRow: { flexDirection: 'row', gap: space(6), marginTop: space(3) },
  timeBlock: {},
  timeLabel: { ...type.labelSmall, color: palette.onSurfaceVariant },
  timeValue: {
    ...type.titleMedium,
    color: palette.onSurface,
    marginTop: space(0.5),
    fontVariant: ['tabular-nums'],
  },
  timeDate: { ...type.bodySmall, color: palette.onSurfaceVariant, fontVariant: ['tabular-nums'] },
  elapsedValue: {
    ...type.titleMedium,
    color: palette.onSurface,
    marginTop: space(0.5),
    fontVariant: ['tabular-nums'],
  },

  actionButton: {
    marginTop: space(3),
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    borderRadius: radius.large,
    paddingHorizontal: space(5),
  },
  actionLabel: { ...type.labelLarge },
  recordButton: { backgroundColor: palette.secondary },
  recordLabel: { ...type.labelLarge, color: palette.onSecondary },
  endButton: { backgroundColor: palette.error },
  endLabel: { ...type.labelLarge, color: palette.onError },

  failureNote: { marginTop: space(2), padding: space(3) },
  failureText: { ...type.bodySmall, color: palette.onSurfaceVariant },
  textAction: { minHeight: 48, justifyContent: 'center' },
  textActionLabel: { ...type.labelLarge, color: glass.accentPrimary },

  dialogScrim: {
    flex: 1,
    backgroundColor: palette.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(6),
  },
  dialogCard: {
    width: '100%',
    maxWidth: 340,
    padding: space(5),
  },
  dialogTitle: { ...type.titleMedium, color: palette.onSurface },
  dialogText: { ...type.bodyMedium, color: palette.onSurfaceVariant, marginTop: space(2) },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space(3),
    marginTop: space(4),
  },
  dialogCancel: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space(3) },
  dialogCancelLabel: { ...type.labelLarge, color: palette.onSurfaceVariant },
  dialogConfirm: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space(4),
    borderRadius: radius.large,
    backgroundColor: palette.error,
  },
  dialogConfirmLabel: { ...type.labelLarge, color: palette.onError },

  emptyHeading: { ...type.titleMedium, color: palette.onSurface },
  emptyText: { ...type.bodyMedium, color: palette.onSurfaceVariant, marginTop: space(1) },

  addTrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(4),
    minHeight: 48,
  },
  addTripIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTripBody: { flex: 1 },
  addTripTitle: { ...type.titleMedium, color: palette.onSurface },
  addTripText: { ...type.bodySmall, color: palette.onSurfaceVariant, marginTop: space(1) },

  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space(5),
    marginHorizontal: space(5),
  },
  historyHeading: { marginTop: 0, marginBottom: 0, flex: 1 },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: space(1), minHeight: 48 },
  // 4.5:1, not `palette.primary`'s 3.79:1 — see SectionHeader.actionLabel.
  viewAllLabel: { ...type.labelSmall, color: glass.accentPrimary },

  historyCard: {
    padding: space(4),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
  },
  historyCardStacked: { flexDirection: 'column', alignItems: 'stretch' },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: accent.tertiary.container,
  },
  historyBody: { flex: 1 },
  historyRoute: { ...type.bodyMedium, color: palette.onSurface },
  historyMeta: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: space(1),
    fontVariant: ['tabular-nums'],
  },
  historyTimes: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: space(0.5),
    fontVariant: ['tabular-nums'],
  },

  stateSlot: {
    marginHorizontal: space(5),
    marginTop: space(4),
    padding: space(5),
    borderRadius: radius.xlarge,
    backgroundColor: palette.surfaceContainerLow,
    borderWidth: 1,
    borderColor: palette.outlineVariant,
  },
  errorSlot: { borderColor: palette.error, backgroundColor: palette.errorContainer },
  stateHeading: { ...type.titleMedium, color: palette.onSurface },
  stateText: { ...type.bodyMedium, color: palette.onSurfaceVariant, marginTop: space(2) },

  primaryAction: {
    marginTop: space(3),
    minHeight: 48,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(5),
    borderRadius: radius.large,
    backgroundColor: accent.primary.container,
  },
  primaryActionLabel: { ...type.labelLarge, color: accent.primary.onContainer },

  storageSlot: { marginTop: space(4) },
});
