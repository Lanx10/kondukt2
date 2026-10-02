import {
  FlatList,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SectionChrome } from '../components/SectionChrome';
import { SectionHeader } from '../components/SectionHeader';
import { GlassCard } from '../components/GlassCard';
import { PeriodControl, fmtDay, fmtShort, fmtMonth, fmtYear } from '../components/PeriodControl';
import {
  Skeleton,
  SummaryDisclosure,
  type SummaryBar,
  type SummaryStat,
} from '../components/SummaryDisclosure';
import { StorageNote } from '../components/StorageNote';
import { CategoryChip, LedgerRow } from '../components/LedgerRow';
import { RangeCalendarModal } from '../components/history/RangeCalendarModal';
import { Icon, type IconName } from '../icons';
import { maxContentWidth, onPrimarySolid, radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import {
  fetchDailyEarnings,
  fetchHistorySummary,
  fetchHistoryTotals,
  fetchPassengerBreakdown,
  fetchTicketsPage,
  fetchTripsPage,
  HISTORY_PAGE_SIZE,
  type HistorySummary,
  type HistoryTab,
  type HistoryTotals,
  type TicketHistoryRow,
  type TripHistoryRow,
} from '../data/historyStore';
import {
  breakdownByType,
  averageEarnings,
  customPeriod,
  emptyHistoryMessage,
  filterDailyRowsBySearch,
  groupDailyEarnings,
  HISTORY_TABS,
  mergePage,
  plural,
  resolvePeriod,
  SEARCH_PLACEHOLDERS,
  type RangeMode,
} from '../lib/historyState';
import { centavos, passengerTypeLabel } from '../lib/tripTicketsFormat';
import { formatMediumDate, formatShortTime } from '../lib/tripScreenFormat';
import { useNow } from '../lib/useNow';
import { ROW_STACK_WIDTH, STAT_STACK_WIDTH } from '../lib/layout';

export type HistoryScreenProps = {
  onBack: () => void;
  /** Opens a trip's ticket list, read-only — the only drill-down. */
  onOpenTrip: (tripId: number) => void;
  /** One-shot notice from the screen that ended a trip; shown then cleared. */
  operationMessage?: string | null;
};

type TripStatusFilter = 'ALL' | 'COMPLETED' | 'ACTIVE';

const STATUS_FILTER_LABELS: { value: TripStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All trips' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ACTIVE', label: 'In progress' },
];

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

/** One daily-earnings row: a local calendar day and the ledger it totals. */
type DailyRow = {
  dayStart: number;
  label: string;
  earnings: number;
  ticketCount: number;
  passengerCount: number;
};

/** One row of any tab's ledger — the FlatList's element type. */
type HistoryRow = TripHistoryRow | TicketHistoryRow | DailyRow;

/** The reference prints distances to one decimal — `10.8 km`, not `10.800 km`. */
const km = (milliKm: number) => `${(milliKm / 1000).toFixed(1)} km`;

/** The record-type tabs' leading icon, per the reference's tab pills. */
const TAB_ICONS: Record<HistoryTab, IconName> = {
  trips: 'bus',
  tickets: 'ticket',
  earnings: 'wallet',
};

/** Local midnight the record's timestamp falls on — a day-group's key. */
const localDay = (millis: number): number => {
  const d = new Date(millis);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** One FlatList item: a day-group head, or a ledger row under it. */
type HistoryListItem =
  | { kind: 'head'; key: string; heading: string; count: string }
  | { kind: 'row'; key: string; row: HistoryRow };

/**
 * Per-tab ledger state, keyed by tab — the shape the spec fixes. A tab switch
 * reads the record's own slot and clears nothing; a range or filter change
 * resets the record, never a set of three parallel fields.
 */
type RowsByTab = {
  trips: TripHistoryRow[];
  tickets: TicketHistoryRow[];
  earnings: DailyRow[];
};

type OffsetsByTab = Record<HistoryTab, number>;

/**
 * The History screen.
 *
 * Reports on a chosen period: one hero figure, a disclosure of the detail
 * behind it, and paged rows of trips, tickets, or per-day earnings, switchable
 * by tab. Read-only — nothing here writes.
 *
 * The interface follows the reference's History prototype: the shared period
 * control (Day/Week/Month segments, a stepper, a calendar for hand-picked
 * ranges — no chip wall of presets, no free-text dates), the summary
 * disclosure, the ledger rows, and the storage note, all on theme.glass.
 *
 * Two scoping rules, kept separate because they are different fields: trips
 * scope by when they started, tickets by when the fare was taken. The trips
 * page carries four bounds so a trip's aggregate counts the tickets created in
 * the *ticket* window, not merely those inside the trip's own start day.
 */
export function HistoryScreen({ onBack, onOpenTrip, operationMessage }: HistoryScreenProps) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow();

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [retryToken, setRetryToken] = useState(0);
  // A retry clears the error as well as bumping the token: the page effect
  // refuses to run while the screen is in the error state, so a token bump
  // alone re-read the summary and left the screen stuck on the error card.
  const retry = useCallback(() => {
    setLoad({ kind: 'loading' });
    setRetryToken((token) => token + 1);
  }, []);

  // The period: a mode, how many whole periods back, or a hand-picked window.
  // The resolved window is the screen's query key, so it is held here rather
  // recomputed by the control — the reference's one control, no preset chips.
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

  const [tab, setTab] = useState<HistoryTab>('trips');
  const [statusFilter, setStatusFilter] = useState<TripStatusFilter>('ALL');
  // Only meaningful on the tickets tab; hidden elsewhere so no filter can be
  // set that does nothing.
  const [passengerFilter, setPassengerFilter] = useState<'ALL' | 'REGULAR' | 'STUDENT' | 'SENIOR_CITIZEN' | 'PWD'>('ALL');
  // The search needle, shared shape across tabs but reset on tab switch —
  // each tab searches its own fields, so carrying the text over would match
  // against fields the other tab does not have.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTab, setSearchTab] = useState<HistoryTab>('trips');
  // Each tab's remembered needle, so switching back restores what it was
  // searching. Kept as plain state mirrors of the live field.
  const [perTabSearch, setPerTabSearch] = useState<Record<HistoryTab, string>>({
    trips: '',
    tickets: '',
    earnings: '',
  });
  // The live field writes through to the active tab's slot.
  const updateSearch = (text: string) => {
    setSearchQuery(text);
    setPerTabSearch((state) => ({ ...state, [searchTab]: text }));
  };

  // Rows and offsets keyed by tab — switching tabs preserves each tab's page.
  const [rows, setRows] = useState<RowsByTab>({ trips: [], tickets: [], earnings: [] });
  const [offsets, setOffsets] = useState<OffsetsByTab>({ trips: 0, tickets: 0, earnings: 0 });
  const [canLoadMore, setCanLoadMore] = useState<Record<HistoryTab, boolean>>({
    trips: true,
    tickets: true,
    earnings: true,
  });

  // Bumped whenever a period change must re-read even if the window bounds
  // happen to be identical (custom range equal to the current month, say) —
  // the pages were reset, so the effects have to re-run on a dep the window
  // comparison can't see.
  const [reloadToken, setReloadToken] = useState(0);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [breakdown, setBreakdown] = useState<ReturnType<typeof breakdownByType> | null>(null);
  const [totals, setTotals] = useState<HistoryTotals | null>(null);
  const [notice, setNotice] = useState<string | null>(operationMessage ?? null);

  // Reset pages whenever the period changes. Filters reset their own tab only.
  const resetPages = useCallback(() => {
    setRows({ trips: [], tickets: [], earnings: [] });
    setOffsets({ trips: 0, tickets: 0, earnings: 0 });
    setCanLoadMore({ trips: true, tickets: true, earnings: true });
  }, []);

  // Any change of period: reset every tab's pagination and re-read from row 0.
  const setPeriod = useCallback(
    (
      nextMode: RangeMode,
      nextOffset: number,
      nextCustom: { start: number; endExclusive: number } | null,
    ) => {
      setMode(nextMode);
      setOffset(nextOffset);
      setCustom(nextCustom);
      resetPages();
      setLoad({ kind: 'loading' });
      setReloadToken((token) => token + 1);
    },
    [resetPages],
  );

  // Render-time prop sync, the pattern DatePickerModal established: when the
  // caller hands down a new operation message, pick it up during render — no
  // effect, no cascading render. The message stays until the user dismisses it.
  const [lastMessage, setLastMessage] = useState(operationMessage);
  if (operationMessage !== lastMessage) {
    setLastMessage(operationMessage);
    if (operationMessage) setNotice(operationMessage);
  }

  // The summary and breakdown read live: any store write between loads
  // repaints them through the same subscription the pages use. The device
  // totals ride along — they are unbounded (the storage note reports what the
  // device holds, not what the period holds) but a retry should re-read them
  // with everything else.
  useEffect(() => {
    let cancelled = false;
    const run = () =>
      Promise.all([
        fetchHistorySummary({ start: period.startMillis, endExclusive: period.endExclusiveMillis }),
        fetchPassengerBreakdown({ start: period.startMillis, endExclusive: period.endExclusiveMillis }),
        fetchHistoryTotals(),
      ])
        .then(([summaryRow, breakdownRows, totalsRow]) => {
          if (!cancelled) {
            setSummary(summaryRow);
            setBreakdown(breakdownByType(breakdownRows));
            setTotals(totalsRow);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setLoad({
              kind: 'error',
              message:
                error instanceof Error ? error.message : 'The records on this device could not be read.',
            });
        });
    run();
    const unsubscribePromise = import('../data/tripTicketsStore').then((m) =>
      m.subscribeToTrips(run),
    );
    return () => {
      cancelled = true;
      void unsubscribePromise.then((unsubscribe) => unsubscribe());
    };
  }, [period.startMillis, period.endExclusiveMillis, retryToken, reloadToken]);

  // Page loading. Only the new page is fetched — accumulated pages stay in
  // state and are never re-fetched on each change. The store's change
  // notification re-runs the active page's fetch through `dataVersion`, so a
  // ticket or trip recorded anywhere repaints the list, not just the summary.
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    if (load.kind === 'error') return;
    let cancelled = false;
    const window = { start: period.startMillis, endExclusive: period.endExclusiveMillis };
    const jobs: Promise<void>[] = [];
    if (tab === 'trips') {
      jobs.push(
        fetchTripsPage(
          window,
          statusFilter,
          offsets.trips,
          searchTab === 'trips' ? searchQuery.trim() : '',
        )
          .then((page) => {
            if (cancelled) return;
            setRows((existing) => ({
              ...existing,
              trips: offsets.trips === 0 ? page : mergePage(existing.trips, page),
            }));
            setCanLoadMore((state) => ({ ...state, trips: page.length === HISTORY_PAGE_SIZE }));
          }),
      );
    } else if (tab === 'tickets') {
      jobs.push(
        fetchTicketsPage(
          window,
          offsets.tickets,
          passengerFilter === 'ALL' ? null : passengerFilter,
          searchTab === 'tickets' ? searchQuery.trim() : '',
        )
          .then((page) => {
            if (cancelled) return;
            setRows((existing) => ({
              ...existing,
              tickets: offsets.tickets === 0 ? page : mergePage(existing.tickets, page),
            }));
            setCanLoadMore((state) => ({ ...state, tickets: page.length === HISTORY_PAGE_SIZE }));
          }),
      );
    } else {
      // The earnings tab reads the same aggregate shape as trips, and honours
      // the same status filter — the two tabs must agree about a trip.
      jobs.push(
        fetchTripsPage(window, statusFilter, offsets.earnings)
          .then((page) => {
            if (cancelled) return;
            setCanLoadMore((state) => ({ ...state, earnings: page.length === HISTORY_PAGE_SIZE }));
            return fetchDailyEarnings(window).then((daily) => {
              if (cancelled) return;
              // The earnings search narrows by the formatted day label — the
              // text the row actually shows — applied after grouping.
              setRows((existing) => ({
                ...existing,
                earnings: filterDailyRowsBySearch(
                  groupDailyEarnings(daily, (millis) => formatMediumDate(millis)),
                  searchTab === 'earnings' ? searchQuery : '',
                ),
              }));
            });
          }),
      );
    }
    Promise.all(jobs)
      .then(() => {
        if (!cancelled) setLoad({ kind: 'ready' });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoad({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'The records on this device could not be read.',
          });
      });
    return () => {
      cancelled = true;
    };
    // `load.kind` deliberately excluded: a ready state does not re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    period.startMillis,
    period.endExclusiveMillis,
    tab,
    statusFilter,
    passengerFilter,
    searchQuery,
    searchTab,
    offsets.trips,
    offsets.tickets,
    offsets.earnings,
    retryToken,
    reloadToken,
    dataVersion,
  ]);

  // The same live subscription the summary rides: any write to trips or
  // tickets — a ticket recorded, a trip ended — bumps the version and the
  // active page re-fetches. Accumulated pages are untouched except where the
  // write actually changed them: offset 0 replaces wholesale (mergePage then
  // dedups), so a new newest row appears and a changed row re-reads, while
  // deeper pages only merge rows the store still returns.
  useEffect(() => {
    let cancelled = false;
    const unsubscribePromise = import('../data/tripTicketsStore').then((m) =>
      m.subscribeToTrips(() => {
        if (!cancelled) setDataVersion((version) => version + 1);
      }),
    );
    return () => {
      cancelled = true;
      void unsubscribePromise.then((unsubscribe) => unsubscribe());
    };
  }, []);

  // Read live rather than at module scope: the user can change font scale in
  // Settings while the app is running.
  const largeFont = PixelRatio.getFontScale() > 1.15;
  const contentWidth = Math.min(width, maxContentWidth);
  // The reference stacks its stats and rows on width *or* font scale.
  const stackStats = largeFont || contentWidth < STAT_STACK_WIDTH;
  const stackRows = largeFont || contentWidth < ROW_STACK_WIDTH;

  // A period with nothing in it swaps the summary for the reference's empty
  // card; a period with records whose *filter* matches nothing gets the list's
  // own empty state instead. Two different absences, two different sentences.
  const periodEmpty =
    load.kind === 'ready' && summary !== null && summary.tripCount === 0 && summary.ticketCount === 0;
  const summaryLoading = summary === null || load.kind === 'loading';

  const stats: SummaryStat[] = [
    {
      tone: 'primary',
      icon: 'bus',
      label: 'COMPLETED TRIPS',
      value: periodEmpty ? '\u2014' : String(summary?.tripCount ?? 0),
    },
    {
      tone: 'secondary',
      icon: 'ticket',
      label: 'TICKETS',
      value: periodEmpty ? '\u2014' : String(summary?.ticketCount ?? 0),
    },
    {
      tone: 'tertiary',
      icon: 'wallet',
      label: 'DISTANCE',
      value: summary && summary.distance_km_milli > 0 ? km(summary.distance_km_milli) : '\u2014',
    },
    {
      tone: 'primary',
      icon: 'wallet',
      label: 'AVG PER TRIP',
      value:
        summary && summary.tripCount > 0
          ? centavos(averageEarnings(summary.earnings, summary.tripCount))
          : '\u2014',
    },
  ];

  // The reference sorts the breakdown by count and draws every category.
  const bars: SummaryBar[] = [
    { label: 'Regular', count: breakdown?.regular ?? 0 },
    { label: 'Student', count: breakdown?.student ?? 0 },
    { label: 'Senior citizen', count: breakdown?.senior ?? 0 },
    { label: 'PWD', count: breakdown?.pwd ?? 0 },
  ].sort((a, b) => b.count - a.count);

  const summaryMeta = periodEmpty
    ? 'No records in this range'
    : summary === null
      ? undefined
      : `${plural(summary.tripCount, 'trip')} · ${plural(summary.ticketCount, 'ticket')} · ` +
        `${plural(summary.passengerCount, 'passenger')}`;

  // The reference's disclosure head: "TOTAL EARNINGS TODAY" for today, the
  // scope appended with an em dash for every other window.
  const headLabel =
    period.scope === 'TODAY' ? 'TOTAL EARNINGS TODAY' : `TOTAL EARNINGS \u2014 ${period.scope}`;

  // The ledger as FlatList items: a day-group head before each day's rows —
  // the reference's yellow bar — then the rows themselves. Derived from the
  // pages, never stored: pagination changes rows, and the heads follow.
  const listItems = useMemo<HistoryListItem[]>(() => {
    const base: HistoryRow[] =
      tab === 'trips' ? rows.trips : tab === 'tickets' ? rows.tickets : rows.earnings;
    const rowKey = (row: HistoryRow) =>
      String(
        'trip_number' in (row as object)
          ? (row as TripHistoryRow).id
          : (row as { dayStart: number }).dayStart,
      );
    if (base.length === 0) return [];
    if (tab === 'earnings') {
      return [
        {
          kind: 'head',
          key: 'head:earnings',
          heading: 'EARNINGS BY DAY',
          count: plural(base.length, 'day'),
        },
        ...base.map((row) => ({ kind: 'row' as const, key: rowKey(row), row })),
      ];
    }
    const noun = tab === 'trips' ? 'trip' : 'ticket';
    const groups: { day: number; items: HistoryRow[] }[] = [];
    base.forEach((row) => {
      const millis =
        'started_at' in row
          ? (row as TripHistoryRow).started_at
          : (row as TicketHistoryRow).created_at;
      const day = localDay(millis);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(row);
      else groups.push({ day, items: [row] });
    });
    const items: HistoryListItem[] = [];
    groups.forEach((group) => {
      items.push({
        kind: 'head',
        key: `head:${group.day}`,
        heading: fmtDay(group.day).toUpperCase(),
        count: plural(group.items.length, noun),
      });
      group.items.forEach((row) => items.push({ kind: 'row', key: rowKey(row), row }));
    });
    return items;
  }, [rows, tab]);

  return (
    <SectionChrome title="History" subtitle="Trip and ticket history" onBack={onBack} insets={insets}>
      {load.kind === 'error' ? (
        // The reference's error state: its state card on error-container ink —
        // glass with the error tint, not an opaque panel.
        <GlassCard tint={theme.palette.errorContainer} style={styles.errorCard}>
          <Text style={styles.errorHeading} accessibilityRole="header">
            Records could not be read
          </Text>
          <Text style={styles.stateText} accessibilityLiveRegion="polite">
            {load.message}
          </Text>
          <Pressable
            onPress={retry}
            accessibilityRole="button"
            accessibilityLabel="Retry reading history"
            style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
          >
            <Text style={styles.primaryActionLabel}>Retry</Text>
          </Pressable>
        </GlassCard>
      ) : (
        <FlatList<HistoryListItem>
          ListHeaderComponent={
            <>
              {notice ? (
                <Pressable
                  onPress={() => setNotice(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss notification"
                  style={({ pressed }) => [styles.noticeBanner, pressed && styles.pressed]}
                >
                  <Icon name="database" size={16} color={theme.accent.tertiary.onContainer} />
                  <Text style={styles.noticeText}>{notice}</Text>
                  <Icon name="close" size={14} color={theme.accent.tertiary.onContainer} />
                </Pressable>
              ) : null}

              <PeriodControl
                label="DATE RANGE"
                period={period}
                mode={mode}
                onStep={(delta) => setPeriod(mode, offset + delta, null)}
                onSelectMode={(next) => setPeriod(next, 0, null)}
                onOpenCalendar={() => setCalendarOpen(true)}
                onPress={offset === 0 && !period.isCustom ? undefined : () => setPeriod('day', 0, null)}
              />

              <SectionHeader title={`SUMMARY — ${period.scope}`} width={contentWidth} />
              <SummaryDisclosure
                head={headLabel}
                caption="TOTAL EARNINGS"
                total={periodEmpty ? '\u2014' : centavos(summary?.earnings ?? 0)}
                meta={summaryMeta}
                stats={stats}
                bars={bars}
                loading={summaryLoading}
                stacked={stackStats}
                glassTiles
              />

              <SectionHeader title="RECORDS" width={contentWidth} />
              {/* The reference's ledger card: one glass surface carrying the
                  tab track, the search and the filter rail — the controls read
                  as one panel, not loose chips on the backdrop. */}
              <GlassCard style={styles.ledgerCard}>
              <View style={styles.tabsTrack}>
                {HISTORY_TABS.map((entry) => {
                  const selected = tab === entry.tab;
                  return (
                    <Pressable
                      key={entry.tab}
                      onPress={() => {
                        // Per-tab search: each tab carries its own needle, so
                        // switching restores what that tab was searching and
                        // never applies it to fields it does not have.
                        setSearchTab(entry.tab);
                        setSearchQuery(searchTab === entry.tab ? searchQuery : perTabSearch[entry.tab]);
                        setTab(entry.tab);
                      }}
                      accessibilityRole="tab"
                      accessibilityLabel={`${entry.label} tab`}
                      accessibilityState={{ selected }}
                      // Native reads `accessibilityState`; the web build only
                      // maps the `aria-*` prop (the segments pass theirs the
                      // same way).
                      aria-selected={selected}
                      style={({ pressed }) => [
                        styles.tab,
                        selected && styles.tabSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Icon
                        name={TAB_ICONS[entry.tab]}
                        size={16}
                        color={selected ? onPrimarySolid : theme.palette.onSurfaceVariant}
                      />
                      <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
                        {entry.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Search, scoped to the selected tab. Trips and tickets search
                  in SQL; earnings filters the daily labels after grouping. */}
              <View style={styles.searchField}>
                <Icon name="search" size={18} color={theme.palette.outline} />
                <TextInput
                  value={searchQuery}
                  onChangeText={updateSearch}
                  placeholder={SEARCH_PLACEHOLDERS[tab]}
                  placeholderTextColor={theme.palette.outline}
                  accessibilityLabel={SEARCH_PLACEHOLDERS[tab]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={styles.searchInput}
                />
                {searchQuery !== '' ? (
                  <Pressable
                    onPress={() => setSearchQuery('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={8}
                    style={styles.searchClear}
                  >
                    <Icon name="close" size={16} color={theme.palette.onSurfaceVariant} />
                  </Pressable>
                ) : null}
              </View>

              {tab === 'trips' ? (
                <View style={styles.filterRow}>
                  {STATUS_FILTER_LABELS.map((option) => {
                    const selected = statusFilter === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => {
                          setStatusFilter(option.value);
                          // The status filter shapes both trip-shaped tabs;
                          // both pages reset so the filter takes effect from
                          // the first row.
                          setOffsets((state) => ({ ...state, trips: 0, earnings: 0 }));
                          setRows((state) => ({ ...state, trips: [], earnings: [] }));
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Filter trips: ${option.label}`}
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.filterChip,
                          selected && styles.filterChipSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        {selected ? (
                          <Icon name="check" size={14} color={onPrimarySolid} />
                        ) : null}
                        <Text
                          style={[
                            styles.filterChipLabel,
                            selected && styles.filterChipLabelSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {tab === 'tickets' ? (
                <View style={styles.filterRow}>
                  {(['ALL', 'REGULAR', 'STUDENT', 'SENIOR_CITIZEN', 'PWD'] as const).map((value) => {
                    const selected = passengerFilter === value;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => {
                          setPassengerFilter(value);
                          setOffsets((state) => ({ ...state, tickets: 0 }));
                          setRows((state) => ({ ...state, tickets: [] }));
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Filter tickets: ${value === 'ALL' ? 'all types' : passengerTypeLabel(value)}`}
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.filterChip,
                          selected && styles.filterChipSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        {selected ? (
                          <Icon name="check" size={14} color={onPrimarySolid} />
                        ) : null}
                        <Text
                          style={[
                            styles.filterChipLabel,
                            selected && styles.filterChipLabelSelected,
                          ]}
                        >
                          {value === 'ALL' ? 'All types' : passengerTypeLabel(value)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              </GlassCard>

              {load.kind === 'loading' ? (
                <View style={styles.loadingBlock}>
                  <Text style={styles.loadingText} accessibilityLiveRegion="polite">
                    Loading records…
                  </Text>
                  {[0, 1, 2].map((row) => (
                    <Skeleton key={row} height={84} style={styles.skeletonRow} />
                  ))}
                </View>
              ) : null}
            </>
          }
          // One union per tab; the render reads the tab it is on. Tagged by
          // row kind so the key extractor and renderer never guess.
          data={listItems}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            if (item.kind === 'head') {
              return <DayHead heading={item.heading} count={item.count} />;
            }
            const row = item.row;
            if (tab === 'trips') {
              const trip = row as TripHistoryRow;
              const active = trip.status === 'ACTIVE';
              const distance =
                trip.distance_km_milli > 0 ? km(trip.distance_km_milli) : 'distance not recorded';
              const label =
                `Trip number ${trip.trip_number}. ${trip.origin} to ${trip.destination}. ` +
                `${active ? 'In progress' : 'Completed'}. Started ${formatMediumDate(trip.started_at)}. ` +
                `${trip.distance_km_milli > 0 ? km(trip.distance_km_milli) : 'Distance not recorded'}. ` +
                `${trip.ticket_count} tickets, ${trip.passenger_count} passengers, ${centavos(trip.earnings)} collected.`;
              return (
                <LedgerRow
                  tone="primary"
                  icon="bus"
                  title={`${trip.origin} → ${trip.destination}`}
                  sub={`Trip #${trip.trip_number} · ${formatShortTime(trip.started_at)}`}
                  meta={`${plural(trip.ticket_count, 'ticket')} · ${plural(trip.passenger_count, 'passenger')} · ${distance}`}
                  status={active ? 'In progress' : 'Completed'}
                  amount={centavos(trip.earnings)}
                  amountLabel="EARNINGS"
                  chevron
                  stacked={stackRows}
                  onPress={() => onOpenTrip(trip.id)}
                  accessibilityLabel={label}
                  accessibilityHint="Opens the trip's tickets"
                />
              );
            }
            if (tab === 'tickets') {
              const ticket = row as TicketHistoryRow;
              // Tickets are a report: no navigation target, no tap.
              const label =
                `Ticket number ${ticket.id}, ${formatMediumDate(ticket.created_at)}. ` +
                `${ticket.origin} to ${ticket.destination} on trip number ${ticket.trip_number}, ` +
                `${passengerTypeLabel(ticket.passenger_type)}, quantity ${ticket.passenger_quantity}. ` +
                `Total ${centavos(ticket.total_fare)}, ${centavos(ticket.final_fare_per_passenger)} each.`;
              return (
                <LedgerRow
                  tone="secondary"
                  icon="ticket"
                  title={`#${ticket.id}`}
                  // The day is the group head above; the row's own stamp is
                  // the time, exactly as the reference's ticket-id column.
                  titleSuffix={formatShortTime(ticket.created_at)}
                  sub={`${ticket.origin} → ${ticket.destination} · Trip #${ticket.trip_number}`}
                  // The reference prints the category as a chip, then the
                  // quantity — a fare line is per passenger, so the count is
                  // the other half of the reading.
                  subExtra={
                    <>
                      <CategoryChip label={passengerTypeLabel(ticket.passenger_type)} />
                      <Text style={styles.qty}>{`· Qty ${ticket.passenger_quantity}`}</Text>
                    </>
                  }
                  amount={centavos(ticket.total_fare)}
                  amountLabel={`EACH ${centavos(ticket.final_fare_per_passenger)}`}
                  stacked={stackRows}
                  accessibilityLabel={label}
                />
              );
            }
            const day = row as DailyRow;
            return (
              <LedgerRow
                tone="tertiary"
                icon="calendar"
                title={day.label}
                sub={`${plural(day.ticketCount, 'ticket')} · ${plural(day.passengerCount, 'passenger')}`}
                amount={centavos(day.earnings)}
                amountLabel="TOTAL"
                stacked={stackRows}
                accessibilityLabel={`${day.label}. ${plural(day.ticketCount, 'ticket')}, ${plural(
                  day.passengerCount,
                  'passenger',
                )}, total ${centavos(day.earnings)}.`}
              />
            );
          }}
          ListEmptyComponent={
            load.kind === 'ready' ? (
              <GlassCard style={styles.stateCard}>
                <Text style={styles.stateHeading} accessibilityRole="header">
                  No records
                </Text>
                <Text style={styles.stateText} accessibilityLiveRegion="polite">
                  {emptyHistoryMessage(
                    tab,
                    searchTab === tab ? searchQuery : '',
                    tab === 'trips'
                      ? statusFilter !== 'ALL'
                      : tab === 'tickets'
                        ? passengerFilter !== 'ALL'
                        : statusFilter !== 'ALL',
                  )}
                </Text>
                <Pressable
                  onPress={() => setPeriod('day', 0, null)}
                  accessibilityRole="button"
                  accessibilityLabel="Show today"
                  style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
                >
                  <Icon name="calendar" size={16} color={onPrimarySolid} />
                  <Text style={styles.primaryActionLabel}>Show today</Text>
                </Pressable>
              </GlassCard>
            ) : null
          }
          ListFooterComponent={
            <>
              {canLoadMore[tab] && load.kind === 'ready' ? (
                <View style={styles.loadMoreWrap}>
                  <Pressable
                    onPress={() =>
                      setOffsets((state) => ({
                        ...state,
                        [tab]: state[tab] + HISTORY_PAGE_SIZE,
                      }))
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Load up to ${HISTORY_PAGE_SIZE} more records`}
                    style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}
                  >
                    <Text style={styles.loadMoreLabel}>Load more</Text>
                  </Pressable>
                </View>
              ) : null}
              {totals ? (
                <StorageNote
                  tripCount={totals.tripCount}
                  ticketCount={totals.ticketCount}
                  dayCount={totals.dayCount}
                  style={styles.storageSlot}
                />
              ) : null}
            </>
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + space(9) },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}

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
    </SectionChrome>
  );
}

/** One day-group head: the reference's slim yellow bar over each day's rows. */
function DayHead({ heading, count }: { heading: string; count: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.dayHead}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${heading}, ${count}`}
    >
      <Text style={styles.dayHeadLabel}>{heading}</Text>
      <Text style={styles.dayHeadCount}>{count}</Text>
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  pressed: { opacity: 0.88 },

  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginTop: space(3),
    marginHorizontal: space(5),
    padding: space(3),
    borderRadius: radius.medium,
    backgroundColor: theme.accent.tertiary.container,
  },
  noticeText: { ...type.bodySmall, color: theme.accent.tertiary.onContainer, flex: 1 },

  // The reference's ledger card: one glass surface holding the tab track, the
  // search and the filter rail.
  ledgerCard: {
    marginHorizontal: space(5),
    marginTop: space(3),
    paddingVertical: space(3),
    paddingHorizontal: space(3),
    gap: space(3),
  },
  // The reference's track: a translucent pill holding the three tabs, the
  // selected one solid primary. Unselected tabs carry no fill of their own.
  tabsTrack: {
    flexDirection: 'row',
    gap: space(1),
    padding: space(1),
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: theme.palette.outlineVariant,
    backgroundColor: theme.glass.tint,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1.5),
    borderRadius: radius.full,
  },
  tabSelected: {
    backgroundColor: theme.palette.primarySolid,
  },
  tabLabel: {
    ...type.bodyMedium,
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: theme.palette.onSurfaceVariant,
  },
  tabLabelSelected: {
    color: onPrimarySolid,
    fontFamily: 'Poppins_700Bold',
  },

  searchField: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: theme.palette.outlineVariant,
    backgroundColor: theme.glass.tint,
  },
  searchInput: { flex: 1, color: theme.palette.onSurface, ...type.bodyMedium },
  searchClear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  // The reference's chips: outline pills, the pressed one on the primary
  // container with a 2px ring and a check.
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(2),
  },
  filterChip: {
    minHeight: 44,
    paddingHorizontal: space(3.5),
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: theme.palette.outlineVariant,
    backgroundColor: theme.glass.tint,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1),
  },
  // The reference's `.chip.sel`: solid primary with the check and the label
  // knocked out in white — the pressed filter is the only filled chip.
  filterChipSelected: {
    backgroundColor: theme.palette.primarySolid,
    borderColor: theme.palette.primarySolid,
  },
  filterChipLabel: {
    ...type.bodySmall,
    fontSize: 13,
    color: theme.palette.onSurfaceVariant,
  },
  filterChipLabelSelected: {
    // `primarySolid` again: `onPrimaryContainer` is #4E2200, which sits at
    // ~2.8:1 on this fill in LIGHT mode already — the chip's own label was
    // failing AA before dark mode existed.
    color: onPrimarySolid,
    fontFamily: 'Poppins_600SemiBold',
  },
  qty: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
  },

  loadingBlock: {
    marginHorizontal: space(5),
    marginTop: space(3),
    gap: space(3),
  },
  loadingText: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    textAlign: 'center',
  },
  skeletonRow: {
    borderRadius: radius.large,
  },

  // The reference's day-group head: a solid secondary bar carrying the day
  // and its row count, one per group above that day's rows.
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(2),
    marginHorizontal: space(5),
    marginTop: space(3),
    paddingVertical: space(3),
    paddingHorizontal: space(4),
    borderRadius: radius.glass,
    backgroundColor: theme.palette.secondary,
  },
  dayHeadLabel: {
    ...type.labelSmall,
    color: theme.palette.onSecondary,
    fontFamily: 'Poppins_700Bold',
  },
  dayHeadCount: {
    ...type.bodySmall,
    color: theme.palette.onSecondary,
    fontFamily: 'Poppins_700Bold',
    fontVariant: ['tabular-nums'],
  },

  // The reference's state card: centred title, body, and one action.
  stateCard: {
    marginHorizontal: space(5),
    marginTop: space(3),
    padding: space(5),
    alignItems: 'center',
  },
  stateHeading: {
    ...type.titleMedium,
    color: theme.palette.onSurface,
    textAlign: 'center',
  },
  stateText: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginTop: space(1.5),
    textAlign: 'center',
  },
  errorCard: {
    marginHorizontal: space(5),
    marginTop: space(4),
    padding: space(5),
    alignItems: 'center',
  },
  errorHeading: {
    ...type.titleMedium,
    color: theme.palette.error,
    textAlign: 'center',
  },
  // The reference's `.primary-btn`: solid primary, 16px corners, icon and
  // label on one line — Retry and Show today share it.
  primaryAction: {
    marginTop: space(3.5),
    minHeight: 48,
    paddingHorizontal: space(5),
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
    flexDirection: 'row',
    gap: space(2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionLabel: { ...type.labelLarge, color: onPrimarySolid },

  loadMoreWrap: { alignItems: 'center', marginTop: space(4) },
  // The reference's ghost button: outline pill, on-surface ink.
  loadMore: {
    minHeight: 48,
    paddingHorizontal: space(5),
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: theme.palette.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreLabel: { ...type.labelLarge, color: theme.palette.onSurface },

  storageSlot: { marginHorizontal: space(5) },

  // The content column, capped like the header so the two share one gutter on
  // a wide window.
  listContent: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
  },
});
