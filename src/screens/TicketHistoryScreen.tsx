import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionChrome } from '../components/SectionChrome';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../icons';
import { onPrimarySolid, radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import {
  fetchTripWithTickets,
  subscribeToTripWithTickets,
} from '../data/tripTicketsStore';
import { fetchHistorySummary } from '../data/historyStore';
import {
  fareWord,
  passengerCountLabel,
  ticketCountLabel,
  ticketHistorySubtitle,
  ticketRowAnnouncement,
  toTicketHistoryState,
  type TicketHistoryRow,
  type TicketHistoryTotals,
  type TicketHistoryUiState,
} from '../lib/ticketHistoryState';
import { centavos, formatReceiptStamp, formatRowStamp } from '../lib/tripTicketsFormat';

export type TicketHistoryScreenProps = {
  /** Required: the trip whose tickets are listed. A missing id is a broken link, not an empty list. */
  tripId: number;
  onBack: () => void;
  /** The empty state's one way out — a range search lives in History, not here. */
  onSearchRange: () => void;
  /** Opens ticket detail for this trip and this ticket — both ids, always. */
  onOpenTicket: (tripId: number, ticketId: number) => void;
};

/**
 * The Trip Ticket History screen — the ticket book of ONE trip.
 *
 * Every anonymous passenger ticket recorded on this trip, oldest first, and
 * nothing else — no totals on the cards, no search, no filters, no writes.
 * The card prints six of the row's nine fields; the fare note, the full
 * record and the trip's distance belong to the receipt the chevron opens.
 *
 * Ported from the `ticket-history.html` reference: the lede that promises one
 * trip, the glass card whose fare is the one orange thing on it, the four
 * states (tickets / empty / loading / error), and the storage footer that
 * counts the trip against the whole store. Card text wraps rather than
 * truncates — a clipped route is a wrong route.
 */

/**
 * Every epoch-millis record the store can hold — the footer's store counts
 * come from this one whole-store summary.
 */
const WHOLE_STORE = { start: 0, endExclusive: 8_640_000_000_000_000 };

/**
 * The reference's chrome pair is `title-m` over `body-s`, and neither sets
 * tracking — while the shared pill's defaults (`headline-s`, `label-s`) do.
 * Passing the roles alone therefore leaves the pill's own -0.3 and 0.6 on the
 * text, so both opt back to normal here.
 */
const CHROME_TITLE = { ...type.titleMedium, letterSpacing: 0 };
const CHROME_SUBTITLE = { ...type.bodySmall, letterSpacing: 0 };

export function TicketHistoryScreen({
  tripId,
  onBack,
  onSearchRange,
  onOpenTicket,
}: TicketHistoryScreenProps) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  // The loading branch is honest by construction: `load` starts at loading
  // and the fold below never returns loading, so the first emission — an
  // empty book included — moves the screen off loading permanently.
  const [load, setLoad] = useState<TicketHistoryUiState>({ kind: 'loading' });
  // Store-wide counts for the footer's privacy line — the same ledger the
  // receipt is counting, never this screen's own row tally.
  const [store, setStore] = useState<{ fares: number; trips: number } | null>(null);
  // Retry is the only recovery from a failed read: it re-runs both queries.
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      Promise.all([fetchTripWithTickets(tripId), fetchHistorySummary(WHOLE_STORE)])
        .then(([read, summary]) => {
          if (cancelled) return;
          setStore({ fares: summary.ticketCount, trips: summary.tripCount });
          setLoad(toTicketHistoryState(read, tripId));
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setLoad({
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Local ticket history is unavailable.',
          });
        });
    void run();
    // Live: a ticket recorded elsewhere repaints this list through the
    // store's own change notification. No polling, no refresh control.
    const unsubscribe = subscribeToTripWithTickets(tripId, () => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tripId, retryToken]);

  const subtitle =
    load.kind === 'loading'
      ? 'Reading the trip…'
      : load.kind === 'error'
        ? 'Records unavailable'
        : ticketHistorySubtitle(load.kind === 'ready' || load.kind === 'empty' ? load.trip : null, load.kind === 'ready' || load.kind === 'empty' ? load.tripNumber : '');

  const rows = load.kind === 'ready' ? load.tickets : [];

  return (
    <SectionChrome
      title="Ticket History"
      subtitle={subtitle}
      backLabel="Trip tickets"
      // The list reference's chrome: left pair, title-m over body-s.
      titleAlign="flex-start"
      titleStyle={CHROME_TITLE}
      subtitleStyle={CHROME_SUBTITLE}
      titleMinHeight={44}
      onBack={onBack}
      insets={insets}
      testID="th-chrome"
      backTestID="th-back"
      subtitleTestID="th-subtitle"
    >
      <ScrollView
        // The reference's scroll stops at the safe edge — nothing between
        // the footer and the byline pinned over the frame.
        contentContainerStyle={[styles.column, { paddingBottom: insets.bottom + space(9) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The reference's list section: eyebrow, lede and whatever the
            store answered, under one id. */}
        <View testID="trip-history-list">
          {/* The screen's one promise, in the same words the eyebrow uses, so
              the claim and the list cannot disagree. */}
          <View style={styles.lede}>
            <Text style={styles.eyebrow}>TICKET HISTORY</Text>
            <Text style={styles.ledeText}>
              Every passenger ticket recorded on this trip.
            </Text>
          </View>

          {load.kind === 'loading' ? <LoadingList /> : null}

          {load.kind === 'error' ? (
            <ErrorState onRetry={() => setRetryToken((token) => token + 1)} />
          ) : null}

          {load.kind === 'empty' ? (
            <EmptyState trip={load.trip} tripNumber={load.tripNumber} onSearchRange={onSearchRange} />
          ) : null}

          {load.kind === 'ready' ? (
            // No paging: a trip's book is short enough to read whole.
            <View style={styles.tkList}>
              {rows.map((row) => (
                <TicketCard
                  key={row.ticketId}
                  row={row}
                  tripNumber={load.tripNumber}
                  onPress={() => onOpenTicket(tripId, row.ticketId)}
                />
              ))}
            </View>
          ) : null}
        </View>

        <StorageFooter
          load={load}
          store={store}
          totals={load.kind === 'ready' ? load.totals : null}
        />
      </ScrollView>
    </SectionChrome>
  );
}

/**
 * One ticket card — a link, not a button: it opens a receipt, so it says
 * where it goes in its own label. The route wraps on either side; a clipped
 * destination is not a fare a conductor can settle a dispute about.
 */
function TicketCard({
  row,
  tripNumber,
  onPress,
}: {
  row: TicketHistoryRow;
  tripNumber: string;
  onPress: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // The label reads the whole stamp (clock and date); the card's meta line
  // prints the clock only — the reference keeps the date for the ear.
  const label = ticketRowAnnouncement(row, centavos, formatReceiptStamp, tripNumber);

  return (
    // The reference's structure: an invisible <a> carries the semantics, and
    // the glass card inside it carries the material — tint, rim, shadow and
    // the pressed wash — exactly as `.tk-link > .theme.glass.tk-card` does.
    <Pressable
      onPress={onPress}
      accessible
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint="Opens the ticket detail"
      testID={`th-ticket-${row.ticketId}`}
    >
      {({ pressed }) => (
        <GlassCard style={[styles.tkCard, pressed && styles.tkCardPressed]}>
          <View style={styles.tkIcon}>
            <Icon name="ticket" size={22} color={theme.palette.primarySolid} />
          </View>
          <View style={styles.tkMid}>
            <Text style={styles.tkTitle}>
              {row.origin} → {row.destination}
            </Text>
            <Text style={styles.tkMeta}>
              {passengerCountLabel(row.passengerQuantity)} · {formatRowStamp(row.createdAt)}
            </Text>
          </View>
          <View style={styles.tkFare}>
            <Text style={styles.tkFareAmount}>{centavos(row.totalFare)}</Text>
            <Text style={styles.tkFareType}>{fareWord(row.passengerType)}</Text>
          </View>
          <Icon name="chevron" size={18} color={theme.palette.outline} />
        </GlassCard>
      )}
    </Pressable>
  );
}

/** The cards' own shape while the read is in flight — the book's proportions. */
function LoadingList() {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // The reference's .sk sweep: the same ink breathing between its own two
  // stops (.05 → .09) on the same 1.4s beat, parked when the system asks for
  // reduced motion — which is what the reference's media query does too.
  // Lazy state, not a ref: one Animated.Value for the component's life,
  // without reading a ref during render.
  const [shimmer] = useState(() => new Animated.Value(0));
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReducedMotion(enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 700,
          useNativeDriver: false,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 700,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, shimmer]);

  const ink = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange:
      theme.mode === 'dark'
        ? ['rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.12)']
        : ['rgba(0, 0, 0, 0.05)', 'rgba(0, 0, 0, 0.09)'],
  });
  const block = (extra: StyleProp<ViewStyle>) => (
    <Animated.View
      style={[styles.skeleton, reducedMotion ? null : { backgroundColor: ink }, extra]}
    />
  );

  return (
    <View
      style={styles.tkList}
      accessibilityRole="progressbar"
      accessibilityLabel="Reading the trip's tickets"
    >
      {[0, 1, 2].map((index) => (
        <GlassCard key={index} style={styles.tkCard}>
          {block(styles.skIcon)}
          <View style={styles.tkMid}>
            {block(styles.skTitle)}
            {block(styles.skMeta)}
          </View>
          {block(styles.skFare)}
        </GlassCard>
      ))}
    </View>
  );
}

/**
 * A failed read is not an empty device. The reference's own copy, and Retry —
 * the read is safe, so it is the one action worth offering.
 */
function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const body =
    'The tickets on this device did not answer, so no card on this screen can be shown. Nothing was lost — they are still in the local store, and Retry reads them again.';
  return (
    <View
      style={[styles.state, styles.stateError]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`Records could not be read. ${body}`}
      testID="th-error"
    >
      <Text style={styles.stateTitle} accessibilityRole="header">
        Records could not be read
      </Text>
      <Text style={[styles.stateBody, styles.stateBodyError]}>{body}</Text>
      <Pressable
        onPress={onRetry}
        testID="th-error-retry"
        accessibilityRole="button"
        accessibilityLabel="Retry"
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
      >
        <Icon name="history" size={18} color={onPrimarySolid} />
        <Text style={styles.primaryBtnLabel}>Retry</Text>
      </Pressable>
    </View>
  );
}

/**
 * A trip that has sold nothing — an ordinary trip, not an error. It names the
 * trip rather than shrugging at "no data", and its one way out is the range
 * search, which is where a range belongs.
 */
function EmptyState({
  trip,
  tripNumber,
  onSearchRange,
}: {
  trip: { trip_number: string } | null;
  tripNumber: string;
  onSearchRange: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const body = `Trip ${trip ? `#${tripNumber}` : ''} has not sold a ticket yet. A ticket appears here the moment one is issued, with the fare it was bought for.`;
  return (
    <View
      style={styles.state}
      accessible
      accessibilityLabel={`No tickets on this trip. ${body}`}
      testID="th-empty"
    >
      <Text style={styles.stateTitle} accessibilityRole="header">
        No tickets on this trip
      </Text>
      <Text style={styles.stateBody}>{body}</Text>
      <Pressable
        onPress={onSearchRange}
        testID="th-empty-back"
        accessibilityRole="button"
        accessibilityLabel="Search a date range"
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
      >
        <Icon name="calendar" size={18} color={onPrimarySolid} />
        <Text style={styles.primaryBtnLabel}>Search a date range</Text>
      </Pressable>
    </View>
  );
}

/**
 * Where the rows live, and how many there are that this screen is not
 * showing. The counts are the store's own — a list that says "saved on this
 * device" has to be talking about the same ledger the receipt is talking
 * about.
 */
function StorageFooter({
  load,
  store,
  totals,
}: {
  load: TicketHistoryUiState;
  store: { fares: number; trips: number } | null;
  totals: TicketHistoryTotals | null;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const text =
    load.kind === 'loading'
      ? 'Reading the local store…'
      : load.kind === 'error'
        ? 'The local store did not answer. No figure on this screen is computed.'
        : store && totals
          ? `This trip sold ${ticketCountLabel(totals.count)} for ${centavos(
              totals.total,
            )}, out of a local store of ${store.fares} tickets across ${store.trips} trips. Nothing is sent anywhere.`
          : 'Reading the local store…';

  return (
    <GlassCard
      testID="storage-footer"
      style={styles.storage}
      accessible
      accessibilityLabel={`Local storage note. ${text}`}
    >
      <Icon name="database" size={18} color={theme.glass.onGlassVariant} />
      {/* The emphasised figures are the numbers the line is actually about —
          trip sold, store holds — at the reference's bold ink. */}
      <Text style={styles.storageText}>
        {load.kind !== 'loading' && load.kind !== 'error' && store && totals ? (
          <>
            This trip sold{' '}
            <Text style={styles.storageStrong}>{ticketCountLabel(totals.count)}</Text> for{' '}
            <Text style={styles.storageStrong}>{centavos(totals.total)}</Text>, out of a local
            store of <Text style={styles.storageStrong}>{store.fares}</Text> tickets across{' '}
            <Text style={styles.storageStrong}>{store.trips}</Text> trips. Nothing is sent
            anywhere.
          </>
        ) : (
          text
        )}
      </Text>
    </GlassCard>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  column: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    // The reference's readable gutter.
    paddingHorizontal: space(5),
  },
  pressed: { opacity: 0.88 },

  // ── The lede ──────────────────────────────────────────────────────────────
  lede: { marginBottom: 14 },
  eyebrow: { ...type.labelSmall, color: theme.glass.onGlassVariant },
  ledeText: { ...type.bodyMedium, color: theme.glass.onGlassVariant, marginTop: 4 },

  // ── The ticket cards ──────────────────────────────────────────────────────
  tkList: { gap: space(2.5) },
  // The GlassCard inside the link, at the reference's row rhythm: 76 tall,
  // 12/14 padding, 12 between the four parts.
  tkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    minHeight: 76,
    paddingVertical: space(3),
    paddingHorizontal: 14,
  },
  // Hover/active deepen the surface, never the ink — pressed is the phone's
  // half of the same move.
  tkCardPressed: {
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.86)',
  },
  tkIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent.primary.container,
  },
  tkMid: { flex: 1, minWidth: 0 },
  // The route is a snapshot pair, so it wraps rather than truncates.
  tkTitle: { ...type.titleMedium, color: theme.glass.onGlass },
  tkMeta: { ...type.bodySmall, color: theme.glass.onGlassVariant, marginTop: 2 },
  tkFare: { alignItems: 'flex-end' },
  // The one orange thing on a card, and it is the dark orange: #C2410C is
  // 5.0:1 on the glass field, while #E65100 is 3.7:1 and fails AA.
  tkFareAmount: {
    ...type.titleMedium,
    color: theme.palette.primarySolid,
    fontVariant: ['tabular-nums'],
  },
  tkFareType: { ...type.bodySmall, color: theme.glass.onGlassVariant },

  // ── Skeletons ─────────────────────────────────────────────────────────────
  // The reference's .sk ink is a translucent black on the glass, not a solid
  // surface swatch — the card underneath has to keep reading as theme.glass.
  skeleton: {
    borderRadius: 8,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
  },
  // 40×40 at the icon box's radius — never the icon box's own container fill.
  skIcon: { width: 40, height: 40, borderRadius: radius.medium },
  skTitle: { width: '74%', height: 15 },
  skMeta: { width: '46%', height: 11, marginTop: 10 },
  skFare: { width: 54, height: 18 },

  // ── States ────────────────────────────────────────────────────────────────
  // The reference's state frame: 24 radius, the outline's border, a 55% white
  // wash — the error variant swaps in errorContainer and the error border.
  state: {
    padding: space(5),
    borderRadius: radius.xlarge,
    borderWidth: 1,
    borderColor: theme.palette.outlineVariant,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.55)',
  },
  stateError: {
    borderColor: theme.palette.error,
    backgroundColor: theme.palette.errorContainer,
  },
  stateTitle: { ...type.headlineSmall, color: theme.glass.onGlass },
  stateBody: { ...type.bodyMedium, color: theme.glass.onGlassVariant, marginTop: space(2) },
  stateBodyError: { color: theme.palette.onErrorContainer },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space(2),
    minHeight: 48,
    paddingHorizontal: space(5),
    marginTop: 14,  // The reference draws this one r16, not the full pill the receipt wears.
  borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  primaryBtnLabel: { ...type.labelLarge, color: onPrimarySolid },

  // ── Storage footer ────────────────────────────────────────────────────────
  storage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2.5),
    marginTop: space(5),
    paddingVertical: space(3),
    paddingHorizontal: space(5),
  },
  storageText: { ...type.bodySmall, color: theme.glass.onGlassVariant, flex: 1 },
  storageStrong: { fontFamily: 'Poppins_700Bold', color: theme.glass.onGlass },
});
