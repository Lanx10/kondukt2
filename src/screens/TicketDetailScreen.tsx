import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionChrome } from '../components/SectionChrome';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../icons';
import { cardShadow, onAmber, onPrimarySolid, radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { fetchTripWithTickets, subscribeToTripWithTickets } from '../data/tripTicketsStore';
import { fetchHistorySummary } from '../data/historyStore';
import { tripNumber } from '../data/tripHelpers';
import { distanceLabel } from '../lib/tripScreenState';
import { centavos, formatReceiptStamp } from '../lib/tripTicketsFormat';
import { passengerCountLabel, readablePassengerType } from '../lib/ticketHistoryState';
import type { TicketRowRecord, TripRowRecord } from '../data/schema';

/**
 * The Ticket receipt — a fare's full record, read back from the store.
 *
 * A ticket is immutable. `TicketRowRecord` holds nine fields and the store
 * exposes only `recordTicketRow()`: no UPDATE, no DELETE. This screen writes
 * nothing, edits nothing, cancels nothing — it prints the receipt (identity,
 * the route as it was carried, the money, the figures that reconstruct it),
 * the trip behind the fare as it stands now, and the row in the store's own
 * words. Amber on the receipt means exactly one thing: the fare's trip is
 * running right now.
 *
 * Ported from the `ticket-history-detail.html` prototype: same states, same
 * copy, same layout rhythm (the receipt's margins, the hairline above the
 * figures, the fact rows' 14/600 values and per-row rules, the dashed note's
 * white wash), same one-CTA error recoveries. Surface text uses the glass
 * tokens the reference measures against the tinted panel; amber text uses
 * `onAmber` and nothing else.
 */

export type TicketDetailScreenProps = {
  tripId: number;
  ticketId: number;
  /** The ledger this fare was opened from — "Trip tickets" or "Ticket History". */
  backLabel: string;
  onBack: () => void;
};

type Counts = { fares: number; trips: number };

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing'; counts: Counts }
  | { kind: 'ready'; ticket: TicketRowRecord; trip: TripRowRecord | null; counts: Counts };

/**
 * Every epoch-millis record the store can hold — 8.64e15 is the largest value
 * `Date` can represent, so no future record falls outside the window. The
 * storage footer's counts come from this one whole-store summary.
 */
const WHOLE_STORE = { start: 0, endExclusive: 8_640_000_000_000_000 };

/**
 * "7:45 AM · Wed, Sep 28" — the reference's timestamp shape on this screen:
 * clock first, date holding the meridiem to the time so the meta line reads
 * as one phrase. The shared cached formatter; never one inside render.
 */
const stamp = formatReceiptStamp;

/** The reference's 3-up figures drop to one column below this width. */
const FIG_STACK = 300;

export function TicketDetailScreen({ tripId, ticketId, backLabel, onBack }: TicketDetailScreenProps) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  // Honest loading by construction: `load` starts at loading and only a
  // resolved read moves it — a fetch that answers "no such row" lands on
  // missing (a stale link), not on an error it did not cause.
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // The reference measures its scroll column, not the card: the 3-up figures
  // stack only when the whole column falls under 300.
  const [columnWidth, setColumnWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      Promise.all([fetchTripWithTickets(tripId), fetchHistorySummary(WHOLE_STORE)])
        .then(([read, summary]) => {
          if (cancelled) return;
          const counts = { fares: summary.ticketCount, trips: summary.tripCount };
          const ticket = read.tickets.find((row) => row.id === ticketId);
          if (!ticket) {
            setLoad({ kind: 'missing', counts });
            return;
          }
          setLoad({ kind: 'ready', ticket, trip: read.trip, counts });
        })
        .catch(() => {
          if (!cancelled) setLoad({ kind: 'error' });
        });
    void run();
    // Live: a write anywhere repaints this receipt through the store's own
    // notification — no polling, no refresh control.
    const unsubscribe = subscribeToTripWithTickets(tripId, () => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tripId, ticketId]);

  const subtitle =
    load.kind === 'ready'
      ? stamp(load.ticket.created_at)
      : load.kind === 'missing'
        ? 'No ticket with this record'
        : load.kind === 'error'
          ? 'Records unavailable'
          : 'Reading local records…';

  return (
    <SectionChrome
      // The reference drops the number off the title until a record is
      // actually on screen — an id the store has not confirmed is not identity.
      title={load.kind === 'ready' ? `Ticket #${load.ticket.id}` : 'Ticket'}
      subtitle={subtitle}
      backLabel={backLabel}
      titleAccessibilityLabel={
        load.kind === 'ready' ? `Ticket number ${load.ticket.id}` : 'Ticket'
      }
      titleMinHeight={56}
      onBack={onBack}
      insets={insets}
      testID="thd-chrome"
      backTestID="thd-back"
      subtitleTestID="thd-subtitle"
    >
      <ScrollView
        // The reference measures its scroll column: the 3-up figures stack
        // only when the whole column falls under 300.
        onLayout={(e) => setColumnWidth(e.nativeEvent.layout.width)}
        contentContainerStyle={[
          styles.column,
          { paddingBottom: insets.bottom + space(9) },
        ]}
        showsVerticalScrollIndicator={false}
      >
          {load.kind === 'loading' ? <LoadingState /> : null}

          {load.kind === 'error' ? (
            <StateCard
              testID="thd-error"
              tone="error"
              title="Records could not be read"
              body="This ticket did not answer on this device, so no figure on this screen can be shown. Nothing was lost — the row is still on this device."
              backLabel={`Back to ${backLabel}`}
              onBack={onBack}
              backTestID="thd-error-back"
            />
          ) : null}

          {load.kind === 'missing' ? (
            <StateCard
              testID="thd-notfound"
              tone="plain"
              title="Ticket not found"
              body={`No ticket with this record exists on this device. Its link was stale. The ${load.counts.fares} ${load.counts.fares === 1 ? 'fare' : 'fares'} already saved here are untouched.`}
              backLabel={`Back to ${backLabel}`}
              onBack={onBack}
              backTestID="thd-notfound-back"
            />
          ) : null}

          {load.kind === 'ready' ? (
            <>
              <ReceiptSection
                ticket={load.ticket}
                trip={load.trip}
                stackFigures={columnWidth > 0 && columnWidth < FIG_STACK}
              />

              {/* Printed separately from the receipt's snapshot: the two can
                  disagree once the road is edited, and the label says which is
                  which. */}
              <View style={styles.block} testID="ticket-journey">
                <Text
                  style={styles.sectionTitle}
                  accessibilityRole="header"
                  testID="thd-journey-head"
                >
                  THE TRIP IT WAS TAKEN ON
                </Text>
                <GlassCard style={styles.factCard}>
                  {load.trip ? (
                    <>
                      <FactRow label="Trip" value={`#${tripNumber(load.trip)}`} />
                      <FactRow
                        label="Trip route now"
                        value={`${load.trip.origin_location_snapshot} → ${load.trip.destination_location_snapshot}`}
                      />
                      <FactRow
                        label="Trip distance"
                        value={distanceLabel(load.trip.distance_km_milli)}
                      />
                      <FactRow label="Started" value={stamp(load.trip.started_at)} />
                      <FactRow
                        label="Trip status"
                        value={load.trip.status === 'ACTIVE' ? 'Running' : 'Completed'}
                        divider={false}
                      />
                    </>
                  ) : (
                    <Text style={styles.cardNote}>
                      The trip behind this fare is not on this device. The ticket&apos;s own row
                      above is still complete.
                    </Text>
                  )}
                </GlassCard>
              </View>

              <View style={styles.block} testID="ticket-record">
                <Text
                  style={styles.sectionTitle}
                  accessibilityRole="header"
                  testID="thd-record-head"
                >
                  THE RECORD
                </Text>
                <GlassCard style={styles.factCard}>
                  <FactRow label="Ticket number" value={`#${load.ticket.id}`} />
                  <FactRow label="Recorded" value={stamp(load.ticket.created_at)} />
                  <FactRow
                    label="Passenger type"
                    value={readablePassengerType(load.ticket.passenger_type)}
                  />
                  <FactRow
                    label="Quantity"
                    value={passengerCountLabel(load.ticket.passenger_quantity)}
                  />
                  <FactRow label="Fare each" value={centavos(load.ticket.final_fare_per_passenger)} />
                  <FactRow label="Line total" value={centavos(load.ticket.total_fare)} divider={false} />
                </GlassCard>

                {/* The dashed note: the one container in the system that means
                    annotation rather than record. */}
                <View
                  style={styles.note}
                  testID="thd-readonly-note"
                  accessible
                  accessibilityLabel={`Read only, always. ${READ_ONLY_COPY}`}
                >
                  <Text style={styles.noteTitle}>READ ONLY, ALWAYS</Text>
                  <Text style={styles.noteBody}>{READ_ONLY_COPY}</Text>
                </View>
              </View>

              <StorageFooter state="ready" counts={load.counts} />
            </>
          ) : null}

          {load.kind === 'missing' ? <StorageFooter state="ready" counts={load.counts} /> : null}
          {load.kind === 'error' ? <StorageFooter state="error" /> : null}
          {load.kind === 'loading' ? <StorageFooter state="loading" /> : null}
      </ScrollView>
    </SectionChrome>
  );
}

/**
 * The one card, and the only amber surface: amber iff the fare's trip runs.
 *
 * The margins below are the reference's own rhythm — route 12 under the head,
 * meta 4 under the route, lead 14, the hairline 16 above the figures with the
 * figures 14 below it, the note 12 — so the card's internal beats are copied,
 * not re-derived from one uniform gap.
 */
function ReceiptSection({
  ticket,
  trip,
  stackFigures,
}: {
  ticket: TicketRowRecord;
  trip: TripRowRecord | null;
  stackFigures: boolean;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const live = trip?.status === 'ACTIVE';
  const distance = trip ? distanceLabel(trip.distance_km_milli) : 'Distance not recorded';
  // The two ink sets. On amber: the `onAmber` ramp, the only text colours
  // permitted on #FFB300. On glass: the reference's glass-on pair, measured
  // against the tinted panel rather than the page.
  const ink = live
    ? {
        eyebrow: AMBER_INK.detail,
        route: AMBER_INK.primary,
        meta: AMBER_INK.muted,
        soft: AMBER_INK.detail,
      }
    : {
        eyebrow: { color: theme.glass.onGlassVariant },
        route: { color: theme.glass.onGlass },
        meta: { color: theme.glass.onGlassVariant },
        soft: { color: theme.glass.onGlassVariant },
      };

  const body = (
    <>
      <View style={styles.eyebrowRow}>
        <Text style={[styles.eyebrow, ink.eyebrow]}>
          {live ? 'FARE ON A RUNNING TRIP' : 'FARE ON A CLOSED TRIP'}
        </Text>
        <View style={[styles.ticketPill, live ? styles.ticketPillAmber : styles.ticketPillClosed]}>
          <Text style={[styles.ticketPillText, live ? styles.ticketPillTextAmber : null]}>
            TICKET #{ticket.id}
          </Text>
        </View>
      </View>

      <View
        style={styles.receiptRoute}
        accessible
        accessibilityLabel={`Route. ${ticket.origin_location_snapshot} to ${ticket.destination_location_snapshot}`}
      >
        <Text style={[styles.routeText, ink.route]}>{ticket.origin_location_snapshot}</Text>
        <Icon
          name="arrowRight"
          size={18}
          color={live ? onAmber.faint : theme.glass.onGlassVariant}
        />
        <Text style={[styles.routeText, ink.route]}>{ticket.destination_location_snapshot}</Text>
      </View>
      <Text style={[styles.receiptMeta, ink.meta]}>
        {distance} · taken {stamp(ticket.created_at)}
      </Text>

      <Text
        style={[styles.leadFigure, ink.route]}
        accessibilityLabel={`${centavos(ticket.total_fare)} collected on this fare`}
      >
        {centavos(ticket.total_fare)}
      </Text>
      <Text style={[styles.leadCaption, ink.soft]}>COLLECTED ON THIS FARE</Text>

      {/* The reference's hairline sits ABOVE the figures — the rule that closes
          the lead figure, not the one that introduces the note. On amber it is
          a dark ink of the fill itself, never the neutral that reads as dirt. */}
      <View style={[styles.heroRule, live ? styles.heroRuleAmber : styles.heroRuleClosed]} />

      <View style={[styles.figures, stackFigures && styles.figuresStacked]}>
        <Figure label="PER PASSENGER" value={centavos(ticket.final_fare_per_passenger)} amber={!!live} />
        <Figure label="PASSENGERS" value={String(ticket.passenger_quantity)} amber={!!live} />
        <Figure label="FARE TYPE" value={readablePassengerType(ticket.passenger_type)} amber={!!live} />
      </View>

      {/* The multiplication is printed above the prose: a note about a peso
          the reader cannot reconstruct is a note about a different number. */}
      <View
        style={[styles.note, styles.noteInReceipt]}
        testID="thd-fare-note"
      >
        <Text style={[styles.noteTitle, live ? styles.amberNoteTitle : null]}>WHY THIS AMOUNT</Text>
        <Text
          style={[styles.heroMath, live ? styles.amberMath : null]}
          accessible
          accessibilityLabel={`${centavos(ticket.final_fare_per_passenger)} times ${passengerCountLabel(ticket.passenger_quantity)} equals ${centavos(ticket.total_fare)}`}
        >
          {centavos(ticket.final_fare_per_passenger)} × {passengerCountLabel(ticket.passenger_quantity)} ={' '}
          {centavos(ticket.total_fare)}
        </Text>
        <Text style={[styles.noteBody, live ? styles.amberNoteBody : null]}>
          {`This ticket recorded ${centavos(ticket.final_fare_per_passenger)} per passenger. The leg distance is not stored with the ticket, so the fare is read from the amount recorded on it rather than re-derived from a route that may have changed.`}
        </Text>
      </View>
    </>
  );

  return (
    <View testID="ticket-receipt" style={styles.block}>
      {live ? (
        // Solid amber, no rim: the one amber card never samples the page
        // behind it — but it keeps the glass shape and depth.
        <View testID="thd-card-running" style={[styles.receipt, styles.receiptAmber]}>
          {body}
        </View>
      ) : (
        <GlassCard testID="thd-card-completed" style={styles.receipt}>
          {body}
        </GlassCard>
      )}
    </View>
  );
}

function Figure({ label, value, amber }: { label: string; value: string; amber: boolean }) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureValue, amber ? AMBER_INK.primary : null]}>{value}</Text>
      <Text style={[styles.figureLabel, amber ? AMBER_INK.detail : null]}>{label}</Text>
    </View>
  );
}

/**
 * One fact pair, in the reference's own measure: key never wraps, value takes
 * the slack at 14/600 and can break, and every row carries the hairline but
 * the last — the divider that makes two lists read as records, not prose.
 */
function FactRow({ label, value, divider = true }: { label: string; value: string; divider?: boolean }) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={[styles.factRow, divider && styles.factRowDivider]}>
      <Text style={styles.factKey}>{label}</Text>
      <Text style={[styles.factValue, styles.tabular]}>{value}</Text>
    </View>
  );
}

function StateCard({
  testID,
  tone,
  title,
  body,
  backLabel,
  onBack,
  backTestID,
}: {
  testID: string;
  tone: 'error' | 'plain';
  title: string;
  body: string;
  backLabel: string;
  onBack: () => void;
  backTestID: string;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const error = tone === 'error';
  const content = (
    <>
      <Text style={[styles.stateTitle, error && styles.stateTitleError]}>{title}</Text>
      <Text style={[styles.stateBody]}>{body}</Text>
      {/* The single recovery, in both branches — the primarySolid fill, a
          pill exactly as the reference draws it. */}
      <Pressable
        onPress={onBack}
        testID={backTestID}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        style={({ pressed }) => [styles.solidButton, pressed && styles.pressed]}
      >
        <Icon name="history" size={18} color={onPrimarySolid} />
        <Text style={styles.solidButtonLabel}>{backLabel}</Text>
      </Pressable>
    </>
  );

  if (error) {
    // The error variant swaps in the errorContainer surface and drops the
    // glass rim entirely — flat, red-titled, no highlight pretending the
    // panel is fine.
    return (
      <View
        testID={testID}
        style={styles.stateCardError}
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`${title}. ${body}`}
      >
        {content}
      </View>
    );
  }
  // The plain state sits where the receipt sits, so it is the shared glass
  // card — same material, same rim, different words.
  return (
    <GlassCard
      testID={testID}
      style={styles.stateCard}
      accessible
      accessibilityLabel={`${title}. ${body}`}
    >
      {content}
    </GlassCard>
  );
}

/** Skeleton inside a glass card — the shape of the receipt is already known. */
function LoadingState() {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.block}>
      <GlassCard
        testID="thd-card-loading"
        style={styles.receipt}
        accessible
        accessibilityLabel="Reading local records"
      >
        <View style={[styles.skeleton, styles.skeletonTitle]} />
        <View style={[styles.skeleton, styles.skeletonRoute]} />
        <View style={[styles.skeleton, styles.skeletonMeta]} />
        <View style={[styles.skeleton, styles.skeletonFigure]} />
      </GlassCard>
    </View>
  );
}

function StorageFooter({ state, counts }: { state: 'ready' | 'loading' | 'error'; counts?: Counts }) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const text =
    state === 'ready' && counts
      ? `One of ${counts.fares} fares recorded on this device, in a store of ${counts.trips} trips. Nothing is sent anywhere.`
      : state === 'loading'
        ? 'Reading the local store…'
        : 'The local store did not answer. No figure on this screen is computed.';
  return (
    <GlassCard
      testID="storage-footer"
      style={styles.footer}
      accessible
      accessibilityLabel={`Local storage note. ${text}`}
    >
      <Icon name="database" size={18} color={theme.glass.accentTertiary} />
      {/* The counts are emphasised exactly as the reference emphasises them —
          bold ink on the two numbers the privacy line is actually about. */}
      <Text style={styles.footerText}>
        {state === 'ready' && counts ? (
          <>
            One of <Text style={styles.footerStrong}>{counts.fares}</Text> fares recorded on this
            device, in a store of <Text style={styles.footerStrong}>{counts.trips}</Text> trips.
            Nothing is sent anywhere.
          </>
        ) : (
          text
        )}
      </Text>
    </GlassCard>
  );
}

/** The amber ink ramp — the only text colours permitted on #FFB300. */
const AMBER_INK = {
  detail: { color: onAmber.detail },
  primary: { color: onAmber.primary },
  muted: { color: onAmber.muted },
  faint: { color: onAmber.faint },
} as const;

const READ_ONLY_COPY =
  'A fare is written once, at the moment it is taken, and this store keeps no way to change or cancel it afterwards. So nothing on the recorded row is editable here.';

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  column: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    // The reference's `.readable`: 20px in from both edges, 20 under the
    // chrome, 20 between every section. This column was 16/8 — the only screen
    // whose cards did not line up with the rest of the app.
    paddingHorizontal: space(5),
    paddingTop: space(5),
    gap: space(5),
  },
  block: { gap: space(3) },
  pressed: { opacity: 0.88 },

  sectionTitle: { ...type.labelSmall, color: theme.glass.onGlassVariant },
  cardNote: { ...type.bodySmall, color: theme.glass.onGlassVariant, padding: space(3) },

  // ── Receipt ──────────────────────────────────────────────────────────────
  // No uniform gap: every child carries the reference's own margin so the
  // card's internal beats are copied verbatim.
  receipt: { padding: space(5), gap: 0 },
  receiptAmber: {
    backgroundColor: theme.palette.secondary,
    // No border, no rim: the amber card is a flat solid, never glass — but it
    // keeps the 28px shape and the panel depth of the card it replaces.
    borderWidth: 0,
    borderRadius: radius.glass,
    ...cardShadow,
    // Only the shadow's colour follows the mode — the geometry is the card's.
    shadowColor: theme.glass.shadow,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    flexWrap: 'wrap',
  },
  eyebrow: { ...type.labelSmall, color: theme.glass.onGlassVariant },
  ticketPill: {
    height: 24,
    paddingHorizontal: space(2.5),
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  // On amber the pill inverts: the fill is the amber's own on-colour and the
  // text is the amber itself — a dark chip punched out of the card, exactly
  // as the reference draws it.
  ticketPillAmber: { backgroundColor: theme.palette.onSecondary },
  ticketPillClosed: { backgroundColor: theme.palette.secondaryContainer },
  ticketPillText: { ...type.labelSmall, color: theme.palette.onSecondaryContainer },
  ticketPillTextAmber: { color: theme.palette.secondary },

  receiptRoute: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space(2),
    marginTop: space(3),
  },
  routeText: { ...type.headlineSmall, color: theme.glass.onGlass },
  receiptMeta: {
    ...type.bodySmall,
    color: theme.glass.onGlassVariant,
    fontVariant: ['tabular-nums'],
    marginTop: space(1),
  },

  leadFigure: {
    ...type.displaySmall,
    color: theme.glass.onGlass,
    fontVariant: ['tabular-nums'],
    marginTop: space(3.5),
  },
  leadCaption: { ...type.labelSmall, color: theme.glass.onGlassVariant, marginTop: space(0.5) },

  figures: { flexDirection: 'row', gap: space(3), marginTop: space(3.5) },
  // Below the reference's 300 the three figures drop to one column rather
  // than crush into unreadable fractions of the row.
  figuresStacked: { flexDirection: 'column' },
  figure: { flex: 1, gap: 2 },
  figureValue: { ...type.titleMedium, color: theme.glass.onGlass, fontVariant: ['tabular-nums'] },
  figureLabel: { ...type.labelSmall, color: theme.glass.onGlassVariant },

  // The structural hairline, above the figures: a warm ink of the fill on
  // amber, the outline on glass — never the neutral that reads as dirt.
  heroRule: { height: 1, marginTop: space(4) },
  heroRuleClosed: { backgroundColor: theme.palette.outline },
  heroRuleAmber: { backgroundColor: 'rgba(61, 46, 0, 0.7)' },

  // ── The dashed note (both of them) ───────────────────────────────────────
  // The reference's handoff: white wash over whatever carries it, 16 radius,
  // the outline's dashes. Title 4 below-or-after, math 8 above the prose.
  note: {
    paddingVertical: 14,
    paddingHorizontal: space(5),
    borderRadius: radius.large,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.palette.outline,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.5)',
    gap: 0,
  },
  noteInReceipt: { marginTop: space(3) },
  noteTitle: { ...type.labelSmall, color: theme.glass.onGlass, marginBottom: 4 },
  heroMath: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    lineHeight: 24,
    color: theme.glass.onGlass,
    fontVariant: ['tabular-nums'],
    marginBottom: space(2),
  },
  noteBody: { ...type.bodySmall, color: theme.glass.onGlassVariant },

  amberNoteTitle: { color: onAmber.detail },
  amberMath: { color: onAmber.primary },
  amberNoteBody: { color: onAmber.muted },

  // ── Fact lists ───────────────────────────────────────────────────────────
  factCard: { paddingVertical: space(1.5), paddingHorizontal: space(5) },
  factRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space(4),
    paddingVertical: 11,
  },
  factRowDivider: { borderBottomWidth: 1, borderBottomColor: theme.palette.outline },
  factKey: {
    ...type.bodyMedium,
    color: theme.glass.onGlassVariant,
    flexShrink: 0,
  },
  factValue: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    lineHeight: 21,
    color: theme.glass.onGlass,
    flex: 1,
    textAlign: 'right',
  },
  tabular: { fontVariant: ['tabular-nums'] },

  // ── States ───────────────────────────────────────────────────────────────
  stateCard: { padding: space(5), gap: space(2) },
  stateCardError: {
    padding: space(5),
    gap: space(2),
    borderRadius: radius.glass,
    backgroundColor: theme.palette.errorContainer,
  },
  stateTitle: { ...type.headlineSmall, color: theme.glass.onGlass },
  stateTitleError: { color: theme.palette.error },
  stateBody: { ...type.bodyMedium, color: theme.glass.onGlassVariant },

  solidButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    paddingHorizontal: space(5),
    // A pill, exactly as the reference draws the recovery — not a rounded
    // rectangle borrowing its corners.
    borderRadius: radius.full,
    backgroundColor: theme.palette.primarySolid,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  solidButtonLabel: { ...type.labelLarge, color: onPrimarySolid },

  // The reference's four skeleton bars — the receipt's own proportions.
  // ponytail: the shimmer loop is skipped (static bars, same shapes); add an
  // Animated opacity sweep if the wait ever reads as a hang.
  skeleton: { borderRadius: radius.small, backgroundColor: theme.palette.surfaceContainer },
  skeletonTitle: { height: 11, width: '34%', borderRadius: 6 },
  skeletonRoute: { height: 22, width: '66%', marginTop: 14 },
  skeletonMeta: { height: 34, width: '48%', marginTop: space(5) },
  skeletonFigure: { height: 44, width: '100%', borderRadius: radius.full, marginTop: space(5) },

  // ── Footer ───────────────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    paddingVertical: space(4),
    paddingHorizontal: space(5),
  },
  footerText: {
    ...type.bodySmall,
    color: theme.glass.onGlassVariant,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  footerStrong: { fontFamily: 'Poppins_700Bold', color: theme.glass.onGlass },
});
