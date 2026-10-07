import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DetailCard, DetailRow, Handoff, Sheet } from '../components/BottomSheet';
import { GlassCard } from '../components/GlassCard';
import { SectionChrome } from '../components/SectionChrome';
import { Icon } from '../icons';
import { cardShadowFor, onAmber, onPrimarySolid, radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import {
  endActiveTrip,
  fetchAllTerminals,
  fetchTripBoard,
  fetchTripWithTickets,
  subscribeToTripWithTickets,
  type EndTripResult,
} from '../data/tripTicketsStore';
import { fetchFareConfiguration } from '../data/fareStore';
import type { TicketRowRecord } from '../data/schema';
import {
  boardingNote,
  plural,
  readablePassengerType,
  storageNote,
  toCurrentTripState,
  type CurrentTripUiState,
} from '../lib/currentTripState';
import {
  formatKm,
  formatPeso,
  formatRate,
  toFareRules,
  type FareRules,
} from '../lib/addTicketFare';
import { centavos, formatRowStamp } from '../lib/tripTicketsFormat';
import { useUpdateGuard } from '../lib/updateGuard';

export type CurrentTripScreenProps = {
  onBack: () => void;
  /** Branch A's exit — the Trip management screen. */
  onStartTrip: () => void;
  /**
   * Record a fare on the running trip. The most frequent action of the whole
   * app has to be one tap from the live trip: without it the conductor backs
   * out to Home to board a passenger. Resolves the ACTIVE trip itself, same as
   * Home's RECORD A FARE.
   */
  onRecordFare: () => void;
  /**
   * The trip-ended signal: carries the message History shows once and clears.
   * The app's existing one-shot channel, not a second one.
   */
  onTripEnded: (message: string) => void;
};

/** The shared storage failure text, verbatim — no bespoke copy here. */
const STORAGE_FAILURE = 'The records on this device could not be read.';

type Banner = { message: string; severity: 'info' | 'error' };

/**
 * The two reads the ledger's wording needs: the floors a fare can land on and
 * the KM markers that turn a row's two snapshots into a leg. Both come from
 * configuration that changes rarely, so they ride the same observation as the
 * trip rather than a second subscription.
 */
type RuleContext = {
  rules: FareRules | null;
  kmByName: Record<string, number>;
};

type SheetKind = 'end' | 'back';

/**
 * The Current Trip screen.
 *
 * The live operational view of the running trip: the RUNNING card, every
 * boarding on the run, and the one destructive action that closes it. It
 * observes the store and writes exactly one thing — the end-trip update.
 *
 * Two observations, one subscription: the trip and its tickets ride the
 * store's single change notification, so a ticket recorded on Trip Tickets
 * repaints the totals and the ledger together, and a successful end hands
 * History the one-shot message on the app's existing channel.
 */
export function CurrentTripScreen({
  onBack,
  onStartTrip,
  onRecordFare,
  onTripEnded,
}: CurrentTripScreenProps) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Ending the running trip is a transaction: no update sheet may open over
  // its confirm, and no restart may land mid-press. See updateGuard.
  useUpdateGuard('current-trip');

  // One load state, one subscription. `currentTripId` keys the ticket
  // observation, so a new active trip re-scopes the list and the previous
  // trip's tickets can never leak in.
  const [state, setState] = useState<CurrentTripUiState>({ kind: 'loading' });
  const [currentTripId, setCurrentTripId] = useState<number | null>(null);
  const [ctx, setCtx] = useState<RuleContext | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  // The dialog's local state: whether its write is in flight. The confirm
  // action is disabled while in flight, so the write cannot be issued twice.
  const [ending, setEnding] = useState(false);
  // The clock the confirm sheet quotes — stamped when the sheet opens, not
  // re-read on every render.
  const [confirmOpenedAt, setConfirmOpenedAt] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      Promise.all([
        fetchTripBoard(),
        fetchFareConfiguration(),
        fetchAllTerminals(),
      ])
        .then(([board, fares, terminals]) => {
          if (cancelled) return;
          const kmByName: Record<string, number> = {};
          for (const terminal of terminals) kmByName[terminal.name] = terminal.km_marker;
          setCtx({
            rules: fares.fare ? toFareRules(fares.fare) : null,
            kmByName,
          });
          const active = board.active;
          setCurrentTripId(active?.id ?? null);
          if (!active) {
            // The store positively reports no active trip — only now may the
            // empty branch render, never while the first read is pending.
            setState({ kind: 'empty' });
            return;
          }
          return fetchTripWithTickets(active.id).then((read) => {
            if (cancelled) return;
            setState(toCurrentTripState(read.trip, read.tickets));
          });
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setState({
              kind: 'error',
              message: error instanceof Error ? error.message : STORAGE_FAILURE,
            });
        });
    run();
    // The store's single change notification re-runs the whole read: board
    // first (the active trip may have changed), then the scoped ticket read.
    const unsubscribe = subscribeToTripWithTickets(currentTripId ?? -1, () =>
      void run(),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentTripId, retryToken]);

  const ready = state.kind === 'ready' ? state : null;
  const rules = ctx?.rules ?? null;
  const kmByName = ctx?.kmByName ?? {};

/**
 * The leg between a row's two snapshots, in milli-km, or null when either
 * end is not a registered terminal. The terminal's name carries its
 * municipality and the snapshots are that same string, so the lookup is
 * exact — the join the store never makes, and what lets a floored row say
 * which floor took it.
 */
const legOf = (origin: string, destination: string): number | null => {
  const from = kmByName[origin.trim()];
  const to = kmByName[destination.trim()];
  if (from == null || to == null) return null;
  return Math.abs(from - to);
};

  // Every figure on the card and in the footer folds from the observed rows —
  // no caching, no second source.
  const notes = ready
    ? ready.tickets.map((ticket) =>
        boardingNote({
          totalCentavos: ticket.total_fare,
          quantity: ticket.passenger_quantity,
          legMilli: legOf(
            ticket.origin_location_snapshot,
            ticket.destination_location_snapshot,
          ),
          rules,
        }),
      )
    : [];
  const byFare = notes.filter((note) => note === 'minimum fare').length;
  const byDistance = notes.filter((note) => note === 'minimum distance').length;

  const subtitle =
    state.kind === 'loading'
      ? 'Reading the running trip…'
      : state.kind === 'error'
        ? 'Records unavailable'
        : state.kind === 'empty'
          ? 'No trip is running'
          : ready
            ? `Trip #${ready.trip.trip_number} · ${ready.trip.origin_location_snapshot} → ${ready.trip.destination_location_snapshot}`
            : '';

  // The footer's sentence, in the reference's four branches.
  const storageFooter =
    state.kind === 'empty'
      ? 'Nothing is running, so there is nothing to read. The store positively reported no active trip — this is not a loading state waiting to resolve.'
      : state.kind === 'loading'
        ? 'Reading the active trip and its tickets.'
        : state.kind === 'error'
          ? 'The trips table could not be read. Nothing was written and the run is untouched.'
          : ready
            ? storageNote({
                totals: ready.totals,
                rows: ready.tickets.length,
                byFare,
                byDistance,
                rules,
              })
            : '';

  const endTrip = () => {
    if (state.kind !== 'ready' || ending) return;
    setEnding(true);
    void endActiveTrip(state.trip.id, Date.now())
      .then((result: EndTripResult) => {
        setEnding(false);
        setSheet(null);
        if (result === 'ended') {
          // No refresh: the observation emits null, and Home hands History the
          // one-shot message on the channel it already has.
          onTripEnded('Trip ended');
          return;
        }
        setBanner({
          message: result === 'noActiveTrip' ? 'No active trip' : STORAGE_FAILURE,
          severity: 'error',
        });
      })
      .catch(() => {
        setEnding(false);
        setSheet(null);
        setBanner({ message: STORAGE_FAILURE, severity: 'error' });
      });
  };

  const openEndSheet = () => {
    setConfirmOpenedAt(Date.now());
    setSheet('end');
  };

  const header = (
    <>
      {banner ? (
        <Pressable
          onPress={() => setBanner(null)}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${banner.severity === 'error' ? 'error' : 'notification'}: ${banner.message}`}
          style={({ pressed }) => [
            styles.banner,
            banner.severity === 'error' ? styles.bannerError : styles.bannerInfo,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.bannerText,
              banner.severity === 'error'
                ? styles.bannerTextError
                : styles.bannerTextInfo,
            ]}
          >
            {banner.severity === 'error' ? 'Error' : 'Info'}: {banner.message}
          </Text>
          <Text
            style={[
              styles.bannerDismiss,
              banner.severity === 'error'
                ? styles.bannerTextError
                : styles.bannerTextInfo,
            ]}
          >
            Dismiss
          </Text>
        </Pressable>
      ) : null}

      {state.kind === 'loading' ? (
        <GlassCard
          style={styles.card}
          testID="ct-loading"
          accessible
          accessibilityLabel="Reading the running trip."
          accessibilityLiveRegion="polite"
        >
          <View style={[styles.skeleton, styles.skLabel]} />
          <View style={[styles.skeleton, styles.skBig]} />
          <View style={[styles.skeleton, styles.skLine]} />
          <View style={[styles.skeleton, styles.skBlock]} />
          <View style={[styles.skeleton, styles.skBlock2]} />
        </GlassCard>
      ) : null}

      {state.kind === 'error' ? (
        <GlassCard
          style={[styles.card, styles.errorCard]}
          testID="ct-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Text style={styles.errorTitle} accessibilityRole="header">
            The current trip could not be read
          </Text>
          <Text style={styles.errorBody}>
            The records on this device could not be read, so the totals and the ledger are
            unknown. Nothing was written and the run is still open.
          </Text>
          <Text style={styles.errorBody}>
            The app has no network path for this screen. Retry, and if it keeps failing the
            device is the thing to check.
          </Text>
          <Pressable
            onPress={retry}
            testID="ct-retry"
            accessibilityRole="button"
            accessibilityLabel="Retry reading the current trip"
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </GlassCard>
      ) : null}

      {state.kind === 'empty' ? (
        <GlassCard style={styles.card} testID="ct-empty">
          <View style={styles.stIcon}>
            <Icon name="bus" size={28} color={theme.palette.onTertiaryContainer} />
          </View>
          <Text style={[styles.stateTitle, styles.stateTitleSpaced]} accessibilityRole="header">
            No active trip
          </Text>
          <Text style={styles.stateBody}>
            Start a trip before recording passenger tickets. A boarding is always added to a run,
            so with nothing running there is nothing to add one to.
          </Text>
          <Handoff testID="ct-empty-handoff">
            Trips are started on the Trip screen, which is also where the Dashboard sends you.
            There is no way to start one from here.
          </Handoff>
          <Pressable
            onPress={onStartTrip}
            testID="ct-empty-start"
            accessibilityRole="button"
            accessibilityLabel="Start Trip. Opens trip management."
            style={({ pressed }) => [
              styles.solidButton,
              styles.sheetAction,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.solidButtonLabel}>Start trip</Text>
          </Pressable>
        </GlassCard>
      ) : null}

      {/* 1. Is it running, and what has it made. The two figures sit side by
          side: the passenger count is the number that changes as the conductor
          works, the money is the one checked at the end. */}
      {ready ? (
        <GlassCard
          style={styles.runCard}
          testID="ct-run-card"
          accessible
          accessibilityRole="summary"
          accessibilityLabel={
            `Running trip ${ready.trip.trip_number}. ${ready.totals.passengers} passengers, ` +
            `${centavos(ready.totals.collection)} collected. ` +
            `Route ${ready.trip.origin_location_snapshot} to ${ready.trip.destination_location_snapshot}.`
          }
        >
          <View style={styles.runTop}>
            <View style={styles.stPill}>
              <View style={styles.stDot} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              <Text style={styles.stPillText}>RUNNING</Text>
            </View>
            <View style={styles.flag}>
              <Text style={styles.flagText}>
                {ready.trip.uses_sctex === 1 ? 'SCTEX' : 'ORDINARY ROAD'}
              </Text>
            </View>
          </View>

          <View style={styles.figs}>
            <View style={styles.figCol}>
              <Text style={styles.figLabel}>PASSENGERS</Text>
              <Text style={styles.figValue}>{ready.totals.passengers}</Text>
            </View>
            <View style={styles.figCol}>
              <Text style={[styles.figLabel, styles.figAlignRight]}>COLLECTED</Text>
              <Text style={[styles.figValue, styles.figAlignRight]}>
                {centavos(ready.totals.collection)}
              </Text>
            </View>
          </View>

          {/* One track, three fills, in the order the buckets are reported.
              Widths are shares of the passenger count, never of the row count:
              a qty-8 boarding that is 1 of 15 rows is 17% of the people. */}
          <View
            style={styles.mixBar}
            accessible
            accessibilityRole="image"
            accessibilityLabel={
              `Passenger mix. ${ready.totals.regular} regular, ${ready.totals.student} student, ` +
              `${ready.totals.seniorAndPwd} senior or PWD.`
            }
          >
            {ready.totals.passengers > 0 && ready.totals.regular > 0 ? (
              <View
                style={[
                  styles.mixSeg,
                  styles.mixRegular,
                  { flexGrow: ready.totals.regular },
                ]}
              />
            ) : null}
            {ready.totals.passengers > 0 && ready.totals.student > 0 ? (
              <View
                style={[
                  styles.mixSeg,
                  styles.mixStudent,
                  { flexGrow: ready.totals.student },
                ]}
              />
            ) : null}
            {ready.totals.passengers > 0 && ready.totals.seniorAndPwd > 0 ? (
              <View
                style={[
                  styles.mixSeg,
                  styles.mixDisc,
                  { flexGrow: ready.totals.seniorAndPwd },
                ]}
              />
            ) : null}
          </View>
          <Text style={styles.mixLegend}>
            <Text style={styles.mixLegendCount}>{ready.totals.regular}</Text> Regular{'\u00A0\u00A0'}
            <Text style={styles.mixLegendCount}>{ready.totals.student}</Text> Student{'\u00A0\u00A0'}
            <Text style={styles.mixLegendCount}>{ready.totals.seniorAndPwd}</Text> Senior/PWD
          </Text>

          <View style={styles.runRows}>
            <RunRow
              k="Route"
              v={`${ready.trip.origin_location_snapshot} → ${ready.trip.destination_location_snapshot}`}
            />
            <RunRow k="Route distance" v={formatKm(ready.trip.distance_km_milli)} />
            <RunRow
              k="Rate per km"
              v={
                rules
                  ? `${formatRate(
                      ready.trip.uses_sctex === 1
                        ? rules.expressRatePerKmCentavos
                        : rules.ratePerKmCentavos,
                    )} / km`
                  : '—'
              }
            />
            <RunRow
              k="Boarding fare floor"
              v={rules ? formatPeso(rules.minimumFareCentavos) : '—'}
            />
            <RunRow k="Started" v={formatRowStamp(ready.trip.started_at)} last />
          </View>
          <Text style={styles.runNote}>The road is what moves every peso on this run.</Text>
        </GlassCard>
      ) : null}

      {/* 2. Every boarding on the run, newest first, each with its own clock.
          No distance column: the trip's distance is a trip-level fact and
          printing it on fifteen rows is how it stops being legible as one. */}
      {ready ? (
        <View style={styles.secHead}>
          <Text style={styles.secTitle} accessibilityRole="header">
            BOARDINGS
          </Text>
          <Text style={styles.secCount}>
            {plural(ready.tickets.length, 'boarding', 'boardings')}
          </Text>
        </View>
      ) : null}
    </>
  );

  const footer = (
    <GlassCard style={styles.storageCard} testID="ct-storage">
      <Icon name="database" size={18} color={theme.palette.onSurfaceVariant} />
      <Text style={styles.storageNote}>{storageFooter}</Text>
    </GlassCard>
  );

  return (
    <SectionChrome
      title="Current trip"
      subtitle={subtitle}
      titleMinHeight={56}
      onBack={() => setSheet('back')}
      insets={insets}
      testID="ct-chrome"
      backTestID="ct-back"
      subtitleTestID="ct-chrome-sub"
    >
      <FlatList
        style={styles.screen}
        // Branch A has no list; branch B virtualizes its ledger. The store's
        // existing order — created_at DESC, id DESC — is set in SQL; no
        // re-sort here.
        data={ready ? ready.tickets : []}
        keyExtractor={(ticket) => String(ticket.id)}
        ListHeaderComponent={header}
        renderItem={({ item, index }) =>
          ready ? (
            <BoardingRow
              ticket={item}
              note={notes[index] ?? null}
              testID={`ct-tk-${item.id}`}
            />
          ) : null
        }
        ListFooterComponent={footer}
        contentContainerStyle={[
          styles.column,
          {
            paddingBottom: ready
              ? space(4)
              : insets.bottom + space(9),
          },
        ]}
        showsVerticalScrollIndicator={false}
      />

      {/* 3. The one control that closes the run, outside the scroll — the
          reference keeps it reachable while the ledger runs long. */}
      {ready ? (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + space(9) }]}>
          <Pressable
            onPress={openEndSheet}
            disabled={ending}
            testID="ct-end"
            accessibilityRole="button"
            accessibilityLabel={
              ending ? 'Ending the trip' : 'End trip. Opens confirmation before closing the run.'
            }
            accessibilityState={{ disabled: ending, busy: ending }}
            style={({ pressed }) => [
              styles.endButton,
              ending && styles.endButtonDisabled,
              pressed && !ending && styles.pressed,
            ]}
          >
            <Text
              style={[styles.endLabel, ending && styles.endLabelDisabled]}
            >
              {ending ? 'Ending…' : 'End trip'}
            </Text>
          </Pressable>
          <Text style={styles.endCount}>Closes the run and sends it to History</Text>
        </View>
      ) : null}

      {/* ── the two sheets ─────────────────────────────────────────────── */}
      {sheet === 'end' && ready ? (
        <Sheet
          kind="end"
          title={`End trip #${ready.trip.trip_number}?`}
          subtitle={`${ready.trip.origin_location_snapshot} → ${ready.trip.destination_location_snapshot}`}
          onClose={() => {
            if (!ending) setSheet(null);
          }}
          footer={
            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => setSheet(null)}
                disabled={ending}
                testID="ct-end-cancel"
                accessibilityRole="button"
                accessibilityLabel="Keep the trip running"
                style={({ pressed }) => [styles.ghostAction, pressed && styles.pressed]}
              >
                <Text style={styles.ghostActionLabel}>Keep running</Text>
              </Pressable>
              <Pressable
                onPress={endTrip}
                disabled={ending}
                testID="ct-end-confirm"
                accessibilityRole="button"
                accessibilityLabel="Confirm: end this trip"
                accessibilityState={{ disabled: ending, busy: ending }}
                style={({ pressed }) => [
                  styles.destructiveAction,
                  ending && styles.destructiveActionDisabled,
                  pressed && !ending && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.destructiveLabel, ending && styles.destructiveLabelDisabled]}
                >
                  {ending ? 'Ending…' : 'End trip'}
                </Text>
              </Pressable>
            </View>
          }
        >
          <DetailCard>
            <DetailRow label="Trip" value={`#${ready.trip.trip_number}`} />
            <DetailRow
              label="Route"
              value={`${ready.trip.origin_location_snapshot} → ${ready.trip.destination_location_snapshot}`}
            />
            <DetailRow label="Started" value={formatRowStamp(ready.trip.started_at)} />
            <DetailRow label="Boardings" value={String(ready.tickets.length)} />
            <DetailRow label="Passengers" value={String(ready.totals.passengers)} />
            <DetailRow label="Collected" value={centavos(ready.totals.collection)} />
          </DetailCard>
          <Text style={styles.hint}>
            {`The run is stamped ended at ${formatRowStamp(confirmOpenedAt)} and moves to History. The ${plural(
              ready.tickets.length,
              'boarding',
              'boardings',
            )} and the ${centavos(ready.totals.collection)} stay with it, and nothing on this screen can reopen it — ending a trip is not undoable from here.`}
          </Text>
          <Handoff testID="ct-end-handoff">
            endActiveTrip writes the end clock and the status in one transaction. The
            observation then reports no active trip, and the trip-ended message hands you
            History with the run in it — no refresh, no lost boarding.
          </Handoff>
        </Sheet>
      ) : null}

      {sheet === 'back' ? (
        <Sheet
          kind="back"
          title="Leave this screen?"
          subtitle={ready ? `Trip #${ready.trip.trip_number} keeps running` : 'Nothing is running'}
          onClose={() => setSheet(null)}
          footer={
            <Pressable
              onPress={onBack}
              testID="ct-back-leave"
              accessibilityRole="button"
              accessibilityLabel="Leave this screen"
              style={({ pressed }) => [styles.solidButton, styles.sheetAction, pressed && styles.pressed]}
            >
              <Text style={styles.solidButtonLabel}>Leave</Text>
            </Pressable>
          }
        >
          <Handoff testID="ct-back-handoff">
            The run does not stop when this screen closes. A boarding is recorded on Trip
            tickets, and ending the run happens here or on the Trip screen — nowhere else.
          </Handoff>
          <Text style={styles.hint}>
            {ready
              ? 'Leaving costs nothing. The trip stays open and every boarding is still counted.'
              : 'With no run open there is nothing to lose.'}
          </Text>
        </Sheet>
      ) : null}
    </SectionChrome>
  );
}

/** One ruled row on the RUNNING card. */
function RunRow({ k, v, last = false }: { k: string; v: string; last?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailKey}>{k}</Text>
      <Text style={[styles.detailValue, styles.tabular]}>{v}</Text>
    </View>
  );
}

/**
 * One boarding row. Not pressable — no navigation, no edit, no delete. The
 * lines merge into one announcement carrying everything needed without sight.
 * Route values are the stored snapshots, never re-resolved from the terminal
 * tables.
 */
function BoardingRow({
  ticket,
  note,
  testID,
}: {
  ticket: TicketRowRecord;
  note: string | null;
  testID: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const readable = readablePassengerType(ticket.passenger_type);
  const route = `${ticket.origin_location_snapshot} → ${ticket.destination_location_snapshot}`;
  const label = `${formatRowStamp(ticket.created_at)} ${route}. ${ticket.passenger_quantity} ${readable} passengers, ${centavos(ticket.total_fare)}${note ? `, ${note}` : ''}.`;
  const discounted = ticket.passenger_type !== 'REGULAR';

  return (
    <View style={styles.tkWrap}>
      <GlassCard
        style={styles.tkCard}
        testID={testID}
        accessible
        accessibilityLabel={label}
      >
        <View style={styles.tkTop}>
          <Text style={[styles.tkTime, styles.tabular]}>{formatRowStamp(ticket.created_at)}</Text>
          <Text style={[styles.tkFare, styles.tabular]}>{centavos(ticket.total_fare)}</Text>
        </View>
        <Text style={styles.tkRoute}>{route}</Text>
        <View style={styles.tkMeta}>
          <View
            style={[styles.cat, discounted ? styles.catDiscount : styles.catRegular]}
          >
            <Text
              style={[
                styles.catLabel,
                discounted ? styles.catDiscountLabel : styles.catRegularLabel,
              ]}
            >
              {readable}
            </Text>
          </View>
          <Text style={styles.tkMetaText}>{`QTY\u00A0${ticket.passenger_quantity}`}</Text>
          {note ? <Text style={styles.tkMetaText}>{note}</Text> : null}
        </View>
      </GlassCard>
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  screen: { flex: 1 },
  column: {
    width: '100%',
    // Home's readable-width token wins over the spec's 600 — same rule the
    // Settings screen applied for this element type.
    maxWidth: 720,
    alignSelf: 'center',
    paddingTop: space(4),
  },
  pressed: { opacity: 0.88 },
  tabular: { fontVariant: ['tabular-nums'] },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginHorizontal: space(5),
    marginTop: space(3),
    padding: space(3),
    borderRadius: radius.medium,
  },
  bannerInfo: { backgroundColor: theme.palette.tertiaryContainer },
  bannerError: { backgroundColor: theme.palette.errorContainer },
  bannerText: { ...type.bodySmall, flex: 1 },
  bannerTextInfo: { color: theme.palette.onTertiaryContainer },
  bannerTextError: { color: theme.palette.onErrorContainer },
  bannerDismiss: { ...type.labelSmall },

  card: {
    marginHorizontal: space(5),
    marginTop: space(5),
    padding: space(5),
  },

  // Whole-screen states
  // The loading skeleton's proportions, straight from the reference: a label,
  // the figure, a rule, then two rows.
  skeleton: {
    borderRadius: radius.small,
    backgroundColor: theme.palette.surfaceContainer,
  },
  skLabel: { height: 13, width: '30%' },
  skBig: { height: 34, width: '56%', marginTop: space(3) },
  skLine: { height: 8, marginTop: space(5) },
  skBlock: { height: 60, marginTop: space(6) },
  skBlock2: { height: 60, marginTop: space(3) },

  errorCard: {
    backgroundColor: theme.palette.error,
    borderWidth: 1,
    borderColor: theme.palette.error,
    ...cardShadowFor(theme),
    // Only the shadow's colour follows the mode — the geometry is the card's.
    shadowColor: theme.glass.shadow,
  },
  errorTitle: { ...type.titleMedium, color: theme.palette.onError },
  errorBody: { ...type.bodySmall, color: theme.palette.onError, marginTop: space(2) },
  retryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space(4),
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: theme.palette.outline,
    backgroundColor: theme.palette.surfaceContainerLowest,
  },
  retryLabel: { ...type.labelLarge, color: theme.palette.onSurface },

  stIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.tertiaryContainer,
  },
  stateTitle: { ...type.titleMedium, color: theme.palette.onSurface },
  stateTitleSpaced: { marginTop: space(4) },
  stateBody: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(2) },

  solidButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(4),
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  solidButtonLabel: { ...type.labelLarge, color: onPrimarySolid },
  sheetAction: { marginTop: space(4) },
  hint: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(3) },

  // The RUNNING card: a solid amber surface, not glass — the reference paints
  // the one card the whole run hangs off in the fare accent.
  runCard: {
    marginHorizontal: space(5),
    marginTop: space(5),
    padding: space(5),
    borderRadius: radius.glass,
    backgroundColor: theme.palette.secondary,
    borderWidth: 1,
    borderColor: 'rgba(61, 46, 0, 0.26)',
    overflow: 'hidden',
    ...cardShadowFor(theme),
    // Only the shadow's colour follows the mode — the geometry is the card's.
    shadowColor: theme.glass.shadow,
  },
  runTop: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space(2),
  },
  stPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    paddingHorizontal: space(2.5),
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: theme.palette.onSecondary,
  },
  stDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.palette.secondary,
  },
  stPillText: { ...type.labelSmall, color: theme.palette.secondary },
  flag: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: theme.palette.secondaryContainer,
  },
  flagText: {
    ...type.labelSmall,
    color: theme.palette.onSecondaryContainer,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  figs: {
    flexDirection: 'row',
    gap: space(4),
    marginTop: space(4),
    alignItems: 'flex-end',
  },
  figCol: { flex: 1, minWidth: 0 },
  figAlignRight: { textAlign: 'right' },
  figLabel: { ...type.labelSmall, color: onAmber.detail },
  figValue: {
    ...type.displaySmall,
    color: onAmber.primary,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },

  mixBar: {
    flexDirection: 'row',
    height: 8,
    marginTop: space(4),
    borderRadius: radius.full,
    backgroundColor: 'rgba(74, 54, 0, 0.16)',
    overflow: 'hidden',
  },
  mixSeg: { height: '100%' },
  mixRegular: { backgroundColor: '#9A3D00' },
  mixStudent: { backgroundColor: '#44636F' },
  mixDisc: { backgroundColor: '#6B4B00' },
  mixLegend: {
    ...type.bodySmall,
    color: onAmber.detail,
    marginTop: space(3),
    flexWrap: 'wrap',
  },
  mixLegendCount: { color: onAmber.primary, fontWeight: '700' },

  runRows: { marginTop: space(4) },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: space(3),
    paddingVertical: space(3),
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(61, 46, 0, 0.26)',
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailKey: { ...type.bodyMedium, color: onAmber.detail, flexShrink: 1 },
  detailValue: {
    ...type.bodyMedium,
    fontWeight: '600',
    color: onAmber.primary,
    textAlign: 'right',
    flexShrink: 1,
  },
  runNote: { ...type.bodySmall, color: onAmber.detail, marginTop: space(3) },

  // The ledger
  secHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(2),
    marginHorizontal: space(5),
    marginTop: space(5),
  },
  secTitle: { ...type.labelSmall, color: theme.palette.onSurfaceVariant },
  secCount: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },

  tkWrap: {
    marginHorizontal: space(5),
    marginTop: space(3),
  },
  tkCard: {
    paddingVertical: space(3),
    paddingHorizontal: space(4),
  },
  tkTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space(3),
  },
  tkTime: { ...type.bodySmall, color: theme.palette.onSurfaceVariant },
  tkFare: { ...type.titleMedium, color: theme.palette.onSurface },
  tkRoute: { ...type.titleMedium, color: theme.palette.onSurface, marginTop: space(1) },
  tkMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space(1),
    marginTop: space(1),
  },
  tkMetaText: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginRight: space(1),
  },
  cat: {
    paddingHorizontal: space(2),
    paddingVertical: 2,
    borderRadius: radius.full,
    marginRight: space(1),
  },
  catRegular: { backgroundColor: theme.palette.primaryContainer },
  catDiscount: { backgroundColor: theme.palette.tertiaryContainer },
  catLabel: { ...type.labelSmall },
  catRegularLabel: { color: theme.palette.onPrimaryContainer },
  catDiscountLabel: { color: theme.palette.onTertiaryContainer },

  // STORAGE
  storageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginTop: space(5),
    marginHorizontal: space(5),
    paddingVertical: space(3),
    paddingHorizontal: space(5),
  },
  storageNote: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, flex: 1 },

  // ACTION BAR
  actionBar: {
    paddingHorizontal: space(5),
    paddingTop: space(3),
  },
  endButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.large,
    backgroundColor: theme.palette.error,
  },
  // The disabled branch drops the fill rather than fading it — opacity blends
  // toward the page and takes the white label under AA with it.
  endButtonDisabled: { backgroundColor: theme.palette.surfaceContainer },
  endLabel: { ...type.labelLarge, color: theme.palette.onError },
  endLabelDisabled: { color: theme.palette.onSurfaceVariant },
  endCount: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    textAlign: 'center',
    marginTop: space(2),
  },

  // SHEET ACTIONS
  sheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space(3),
    marginTop: space(4),
  },
  ghostAction: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space(3),
  },
  ghostActionLabel: { ...type.labelLarge, color: theme.palette.onSurfaceVariant },
  destructiveAction: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space(5),
    borderRadius: radius.large,
    backgroundColor: theme.palette.error,
  },
  destructiveActionDisabled: { backgroundColor: theme.palette.surfaceContainer },
  destructiveLabel: { ...type.labelLarge, color: theme.palette.onError },
  destructiveLabelDisabled: { color: theme.palette.onSurfaceVariant },
});
