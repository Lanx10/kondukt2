import { useCallback, useMemo, useState } from 'react';
import {
  PixelRatio,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../components/GlassCard';
import { SectionChrome } from '../components/SectionChrome';
import { SectionHeader } from '../components/SectionHeader';
import { PeriodControl, fmtDay } from '../components/PeriodControl';
import { SummaryDisclosure, type SummaryBar, type SummaryStat } from '../components/SummaryDisclosure';
import { StorageNote } from '../components/StorageNote';
import { StatusCard } from '../components/dashboard/StatusCard';
import { RangeCalendarModal } from '../components/history/RangeCalendarModal';
import {
  EMPTY_AGGREGATE,
  TicketRow,
  TripRow,
  useTripAggregates,
} from '../components/dashboard/Rows';
import { useKondukt } from '../data/konduktStore';
import { buildDashboardState, type ByCategory } from '../lib/dashboardState';
import { formatDateLong, php, startOfDay } from '../lib/format';
import { formatShortTime } from '../lib/tripScreenFormat';
import { useNow } from '../lib/useNow';
import { ROW_STACK_WIDTH, STAT_STACK_WIDTH } from '../lib/layout';
import { customPeriod, plural, resolvePeriod, type RangeMode } from '../lib/historyState';
import { maxContentWidth, palette, space, type } from '../theme';

/** Shown in place of a value that has no meaning yet. */
const EMPTY_VALUE = '\u2014';

const BREAKDOWN_LABELS: { key: keyof ByCategory; label: string }[] = [
  { key: 'regular', label: 'Regular' },
  { key: 'student', label: 'Student' },
  { key: 'senior', label: 'Senior citizen' },
  { key: 'pwd', label: 'PWD' },
];

const fmtShort = (millis: number) => {
  const date = new Date(millis);
  return `${formatDateLong(date).split(',')[0]}`;
};

const fmtMonth = (millis: number) =>
  formatDateLong(new Date(millis)).split(' ')[0].replace(',', '');

const fmtYear = (millis: number) => String(new Date(millis).getFullYear());

/**
 * The Dashboard.
 *
 * One period, one status, one hero figure, and the two ledgers under it. It
 * owns no arithmetic: `buildDashboardState` maps the store to the snapshot, and
 * the screen only decides which figure goes in which slot.
 */
export function DashboardScreen({
  onBack,
  onOpenHistory,
  onOpenTrip,
  onOpenTicket,
}: {
  onBack: () => void;
  onOpenHistory: () => void;
  onOpenTrip: () => void;
  onOpenTicket: (ticketId: string, tripId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const now = useNow();
  const { trips, tickets, status } = useKondukt();

  // The period: a mode, how many whole periods back, or a hand-picked window.
  // The resolved window is the screen's query key, so it is held here rather
  // recomputed by the control.
  const [mode, setMode] = useState<RangeMode>('day');
  const [offset, setOffset] = useState(0);
  const [custom, setCustom] = useState<{ start: number; endExclusive: number } | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const period = useMemo(() => {
    if (mode === 'custom' && custom) {
      return customPeriod(custom.start, custom.endExclusive, fmtShort, fmtYear);
    }
    return resolvePeriod(
      mode === 'custom' ? 'day' : mode,
      offset,
      now.getTime(),
      fmtShort,
      fmtDay,
      fmtMonth,
      fmtYear,
    );
  }, [mode, offset, custom, now]);

  /** Any change of window re-reads from the first row. */
  const setPeriod = useCallback(
    (
      nextMode: RangeMode,
      nextOffset: number,
      nextCustom: { start: number; endExclusive: number } | null,
    ) => {
      setMode(nextMode);
      setOffset(nextOffset);
      setCustom(nextCustom);
    },
    [],
  );

  const state = useMemo(
    () =>
      buildDashboardState(
        trips,
        tickets,
        { start: period.startMillis, endExclusive: period.endExclusiveMillis },
        now,
      ),
    [trips, tickets, period.startMillis, period.endExclusiveMillis, now],
  );

  // Read live rather than at module scope: the user can change font scale in
  // Settings while the app is running.
  const largeFont = PixelRatio.getFontScale() > 1.15;

  // Container width, not window width: the content column is capped at
  // `maxContentWidth`, so past that point a card is narrower than the window
  // and should lay out for the card, not the screen.
  const [containerWidth, setContainerWidth] = useState(windowWidth);
  const contentWidth = Math.min(containerWidth, maxContentWidth);

  // Two thresholds, both real: the summary's stat grid drops to one column when
  // two tiles would be too narrow to hold a peso amount, rows stack when a route
  // and a fare no longer fit side by side, and a large font scale alone triggers
  // both regardless of width.
  const stackStats = largeFont || contentWidth < STAT_STACK_WIDTH;
  const stackRows = largeFont || contentWidth < ROW_STACK_WIDTH;
  const aggregates = useTripAggregates(tickets);

  // Both ids: the ledger row is (trip, ticket), and the Tickets section is
  // scoped by trip id — a ticket id alone left the router with no trip and
  // the tap fell through to the placeholder net.
  const openTicket = useCallback(
    (id: string, tripId: string) => onOpenTicket(id, tripId),
    [onOpenTicket],
  );

  const scope = period.isCustom
    ? 'CUSTOM'
    : mode === 'day'
      ? offset === 0
        ? 'TODAY'
        : offset === -1
          ? 'YESTERDAY'
          : fmtDay(period.startMillis).toUpperCase()
      : mode === 'week'
        ? offset === 0
          ? 'LAST 7 DAYS'
          : `${fmtShort(period.startMillis)} – ${fmtShort(period.endExclusiveMillis - 1)}`.toUpperCase()
        : offset === 0
          ? 'THIS MONTH'
          : `${fmtMonth(period.startMillis)} ${fmtYear(period.startMillis)}`.toUpperCase();

  const stats: SummaryStat[] = [
    { tone: 'primary', icon: 'bus', label: 'COMPLETED TRIPS', value: String(state.completedTripCount) },
    { tone: 'secondary', icon: 'ticket', label: 'TICKETS', value: String(state.ticketCount) },
    {
      tone: 'tertiary',
      icon: 'wallet',
      label: 'DISTANCE',
      value:
        state.completedTripCount > 0 ? `${(state.distanceMetres / 1000).toFixed(1)} km` : EMPTY_VALUE,
    },
    {
      tone: 'primary',
      icon: 'wallet',
      label: 'AVG PER TRIP',
      value: state.completedTripCount > 0 ? php(state.averageEarningsPerTrip) : EMPTY_VALUE,
    },
  ];

  const bars: SummaryBar[] = BREAKDOWN_LABELS.map(({ key, label }) => ({
    label,
    count: state.byCategory[key],
  }))
    // The reference drops empty categories rather than drawing four bars with
    // three of them at zero.
    .filter((bar) => bar.count > 0)
    .sort((a, b) => b.count - a.count);

  const dayCount = useMemo(
    () =>
      new Set(
        tickets.map((ticket) => startOfDay(new Date(ticket.issuedAt)).getTime()),
      ).size,
    [tickets],
  );

  // The caption under the period card says what the window holds, not what the
  // stepper three lines above already printed: counts, or the day the figures
  // really belong to. The reference's own line; the dates version is History's.
  const periodCaptionText = state.isShowingRecentTripFallback
    ? `Data is from ${fmtDay((state.fallbackDate ?? now).getTime())} — today has no records yet.`
    : state.trips.length === 0 && state.ticketCount === 0
      ? 'No records in this window.'
      : `${plural(state.completedTripCount, 'completed trip')}  ·  ` +
        `${plural(state.ticketCount, 'ticket')} recorded` +
        `${state.activeTrip ? '  ·  Trip running' : ''}.`;

  // The first read has not answered yet — or could not. Zeros and
  // "NOTHING RECORDED" under a loading store would be a lie the screen
  // tells before the device has said anything, so both states get their
  // own card instead of a fabricated empty dashboard.
  if (status !== 'ready') {
    return (
      <View
        style={styles.screen}
        onLayout={(e: LayoutChangeEvent) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        <SectionChrome
          title="Dashboard"
          subtitle="Offline overview"
          titleMinHeight={56}
          backLabel="Back to home"
          onBack={onBack}
          insets={insets}
          testID="dash-chrome"
          backTestID="dash-back"
        >
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + space(9) }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.readableWidth}>
              <InlineEmpty
                message={
                  status === 'loading'
                    ? 'Reading the trips and fares on this device…'
                    : 'The records on this device could not be read. Nothing was lost — the trips and fares are still stored, and reading them again is safe.'
                }
              />
            </View>
          </ScrollView>
        </SectionChrome>
      </View>
    );
  }

  return (
    <View
      style={styles.screen}
      onLayout={(e: LayoutChangeEvent) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      <SectionChrome
        title="Dashboard"
        subtitle="Offline overview"
        titleMinHeight={56}
        backLabel="Back to home"
        onBack={onBack}
        insets={insets}
        testID="dash-chrome"
        backTestID="dash-back"
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + space(9) }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.readableWidth}>
            {state.activeTrip ? (
              <StatusCard
                tone="active"
                eyebrow="TRIP IN PROGRESS"
                eyebrowChip="RUNNING"
                title={`${state.activeTrip.origin.barangay} → ${state.activeTrip.destination.barangay}`}
                body={`Started ${formatShortTime(state.activeTrip.startedAt)}.`}
                meta={
                  `${plural(state.activeTicketCount, 'ticket')} · ` +
                  `${plural(state.activePassengerCount, 'passenger')} · ` +
                  (state.activeTrip.distanceMetres > 0
                    ? `${(state.activeTrip.distanceMetres / 1000).toFixed(1)} km · `
                    : '') +
                  `${php(state.activeCollected)} so far`
                }
                actionTone="ghost"
                actionLabel="Trip details"
                onPress={onOpenTrip}
              />
            ) : state.isShowingRecentTripFallback ? (
              <StatusCard
                eyebrow="OFFLINE SNAPSHOT"
                eyebrowChip={`DATA DATE · ${fmtShort(
                  startOfDay(state.fallbackDate ?? now).getTime(),
                ).toUpperCase()}`}
                title="Showing the last recorded day"
                body="This device has no record for today yet. Every figure below is labelled with the day it actually describes."
                action="bus"
                actionLabel="Start a trip"
                onPress={onOpenTrip}
              />
            ) : state.isClosed ? (
              <StatusCard
                eyebrow="PERIOD CLOSED"
                title="A window from the past"
                body="This period has already ended, so there is nothing to run from here. Review its numbers below, or step back to today."
              />
            ) : state.trips.length === 0 && state.ticketCount === 0 ? (
              <StatusCard
                eyebrow="NOTHING RECORDED"
                title={`No trips in this window`}
                body="Figures appear as trips are recorded on this device. Start one, or step the period back to a day with records."
                action="bus"
                actionLabel="Start a trip"
                onPress={onOpenTrip}
              />
            ) : (
              <StatusCard
                eyebrow="READY TO START"
                title="No trip running."
                body="Start a trip and it stays pinned here while it runs, with fares counted as they are issued."
                meta={`${plural(state.completedTripCount, 'completed trip')} · ${plural(
                  state.ticketCount,
                  'ticket',
                )} · ${php(state.totalEarnings)}`}
                action="bus"
                actionLabel="Start a trip"
                onPress={onOpenTrip}
              />
            )}

            <PeriodControl
              label="PERIOD"
              period={period}
              mode={mode}
              caption={periodCaptionText}
              onStep={(delta) => setPeriod(mode, offset + delta, null)}
              onSelectMode={(next) => setPeriod(next, 0, null)}
              onOpenCalendar={() => setCalendarOpen(true)}
              onPress={offset === 0 && !period.isCustom ? undefined : () => setPeriod('day', 0, null)}
            />

            {state.completedTripCount === 0 && state.ticketCount === 0 ? (
              <InlineEmpty message="No records in this window. Nothing was recorded in this period, so there is nothing to total." />
            ) : (
              <>
                <SectionHeader title={`${scope} EARNINGS`} width={contentWidth} />
                <SummaryDisclosure
                  caption="TOTAL EARNINGS"
                  total={php(state.totalEarnings)}
                  meta={`${plural(state.completedTripCount, 'trip')}  ·  ${plural(
                    state.ticketCount,
                    'ticket',
                  )}  ·  ${plural(state.passengerCount, 'passenger')}`}
                  stats={stats}
                  bars={bars}
                  stacked={stackStats}
                />
              </>
            )}

            <SectionHeader
              title={`${scope} TRIPS`}
              actionLabel="Open History"
              onAction={onOpenHistory}
              width={contentWidth}
            />
            {state.trips.length > 0 ? (
              state.trips.map((trip) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  aggregate={aggregates.get(trip.id) ?? EMPTY_AGGREGATE}
                  stacked={stackRows}
                  onPress={onOpenTrip}
                />
              ))
            ) : (
              <InlineEmpty message="No trips in this window." />
            )}

            <SectionHeader title={`${scope} TICKETS`} width={contentWidth} />
            {state.recentTickets.length > 0 ? (
              state.recentTickets.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  stacked={stackRows}
                  onPress={() => openTicket(ticket.id, ticket.tripId)}
                />
              ))
            ) : (
              <InlineEmpty message="No tickets in this window." />
            )}

            <StorageNote
              tripCount={trips.length}
              ticketCount={tickets.length}
              dayCount={dayCount}
              style={styles.storageSlot}
            />
          </View>
        </ScrollView>
      </SectionChrome>

      <RangeCalendarModal
        visible={calendarOpen}
        onCancel={() => setCalendarOpen(false)}
        onApply={(startMillis, endMillis) => {
          // The grid hands back inclusive days; the query wants an exclusive
          // end, counted on the local calendar — `+ 86_400_000` lands on 1am or
          // 11pm across a daylight-saving boundary.
          const end = new Date(endMillis);
          setPeriod('custom', 0, {
            start: startMillis,
            endExclusive: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime(),
          });
          setCalendarOpen(false);
        }}
      />
    </View>
  );
}

/** An empty section that is never a bare gap — it says what is missing. */
function InlineEmpty({ message }: { message: string }) {
  return (
    <View style={styles.inlineEmpty}>
      <GlassCard style={styles.inlineEmptyCard}>
        <Text style={styles.inlineEmptyText}>{message}</Text>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  readableWidth: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
  inlineEmpty: {
    marginHorizontal: space(5),
    marginTop: space(3),
  },
  inlineEmptyCard: {
    padding: space(5),
    alignItems: 'center',
  },
  inlineEmptyText: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    textAlign: 'center',
  },
  storageSlot: {
    marginHorizontal: space(5),
  },
});
