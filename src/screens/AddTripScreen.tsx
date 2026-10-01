import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { useUpdateGuard } from '../lib/updateGuard';
import { SectionChrome } from '../components/SectionChrome';
import { GlassCard } from '../components/GlassCard';
import { DetailCard, DetailRow, Handoff, Sheet } from '../components/BottomSheet';
import { Icon } from '../icons';
import { palette, radius, space, type } from '../theme';
import {
  fetchActiveTerminals,
  fetchAllMunicipalities,
  fetchNextTripNumber,
  fetchTripBoard,
  startTrip,
  subscribeToTrips,
} from '../data/tripTicketsStore';
import { fetchFareConfiguration } from '../data/fareStore';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import {
  estimateNote,
  filterTerminals,
  measureTrip,
  type TripMeasure,
} from '../lib/addTripState';
import { formatKm, formatRate, formatPeso, toFareRules, type FareRules } from '../lib/addTicketFare';
import { formatTime } from '../lib/format';
import { distanceKm } from '../lib/tripTicketsFormat';

export type AddTripScreenProps = {
  onBack: () => void;
  /** Where the conductor lands when the confirmation sheet is dismissed. */
  onStarted: () => void;
  /** The confirmation sheet's one CTA: straight to the first boarding. */
  onAddFirstBoarding: () => void;
  /** Fare settings, reachable from the rules sheet on a device with no rates. */
  onOpenFareSettings: () => void;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      terminals: TerminalRowRecord[];
      municipalities: MunicipalityRowRecord[];
      hasActiveTrip: boolean;
      rules: FareRules | null;
      nextNumber: string;
    };

/** The reference's five overlays, one at a time. */
type SheetKind = 'origin' | 'destination' | 'rules' | 'started' | 'back';

type StartedTrip = {
  number: string;
  from: string;
  to: string;
  usesSctex: boolean;
  distMilli: number;
  billableMilli: number;
  rateCentavos: number;
  startedAt: number;
};

const ACTIVE_TRIP_REASON = 'A trip is already running. End it before starting another.';
const NO_FARES_REASON = 'No fare rules are set, so this trip cannot be started.';

/**
 * The Add-trip screen, as add-trip.html draws it: a chrome that carries the
 * trip number this press will issue and the road, three cards in decision
 * order (ROUTE, ROAD, WHAT THIS TRIP WILL BILL), one commit with its reason
 * above it, and the reference's five sheets. White cards are GlassCard; the
 * sheets stay opaque — a translucent fill over a scrim shows the form through
 * the sheet and loses the boundary the scrim exists to draw.
 */
export function AddTripScreen({
  onBack,
  onStarted,
  onAddFirstBoarding,
  onOpenFareSettings,
}: AddTripScreenProps) {
  const insets = useSafeAreaInsets();
  // While a route is being chosen, the update system must not pop its
  // "Update available" sheet or restart the app over this form.
  useUpdateGuard('add-trip');

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [retryToken, setRetryToken] = useState(0);
  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  // Selections. Everything else — distance, validity, the estimate — derives
  // from these at the point of use; no copies of computed values live in state.
  const [origin, setOrigin] = useState<TerminalRowRecord | null>(null);
  const [destination, setDestination] = useState<TerminalRowRecord | null>(null);
  const [usesSctex, setUsesSctex] = useState(false);
  const [starting, setStarting] = useState(false);
  // Kept separate from the route refusal: a refusal means the form is not
  // committable; an error means the write failed. Merging them would make the
  // retry on one read like a fix for the other.
  const [writeError, setWriteError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [query, setQuery] = useState('');
  const [startedTrip, setStartedTrip] = useState<StartedTrip | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      Promise.all([
        fetchActiveTerminals(),
        fetchAllMunicipalities(),
        fetchTripBoard(),
        fetchFareConfiguration(),
        fetchNextTripNumber(),
      ])
        .then(([terminals, municipalities, board, fares, nextNumber]) => {
          if (cancelled) return;
          setLoad({
            kind: 'ready',
            // The route sheet offers terminals only — barangays are boardings
            // on a ticket, never an end of a route.
            terminals: terminals.filter((terminal) => terminal.kind === 'TERMINAL'),
            municipalities,
            // If a trip began while this screen was open, the option to start
            // disappears without a refresh — the store repaints.
            hasActiveTrip: board.active !== null,
            // The fare row is created with the schema and filled by Fare
            // settings; a device that never opened them has no rate, which is
            // the reference's `nofares` branch rather than an error.
            rules: fares.fare ? toFareRules(fares.fare) : null,
            nextNumber,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setLoad({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'The terminal configuration could not be read.',
          });
        });
    run();
    const unsubscribe = subscribeToTrips(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [retryToken]);

  const ready = load.kind === 'ready' ? load : null;
  const terminals = ready?.terminals ?? [];
  const municipalities = ready?.municipalities ?? [];
  const rules = ready?.rules ?? null;
  const hasActiveTrip = ready?.hasActiveTrip ?? false;
  const nextNumber = ready?.nextNumber ?? '';
  const roadLabel = usesSctex ? 'SCTEX' : 'Ordinary';

  const view: 'loading' | 'error' | 'noterminals' | 'nofares' | 'ready' =
    load.kind === 'loading'
      ? 'loading'
      : load.kind === 'error'
        ? 'error'
        : terminals.length === 0
          ? 'noterminals'
          : rules === null
            ? 'nofares'
            : 'ready';

  /** `name · municipality`, the reference's field value. */
  const stopLabel = (stop: TerminalRowRecord | null): string | null => {
    if (!stop) return null;
    const muni =
      stop.municipality_id != null
        ? municipalities.find((row) => row.id === stop.municipality_id)?.name ?? null
        : null;
    return muni ? `${stop.name} · ${muni}` : stop.name;
  };
  const originLabel = stopLabel(origin);
  const destinationLabel = stopLabel(destination);

  // The measure only ever runs against a configuration that exists — no rate
  // means no distance worth quoting, exactly as the reference's `measure()`.
  const m: TripMeasure | null = rules
    ? measureTrip({ origin, destination, usesSctex, rules })
    : null;

  // The refusal under the card needs both ends chosen: an empty form is not
  // broken, and the commit below already says what is missing.
  const legWarn = origin && destination && m && !m.ok ? m.reason : null;
  const legDist = m?.ok
    ? formatKm(m.distMilli)
    : !origin || !destination
      ? 'Distance is set once both ends are chosen'
      : 'Distance cannot be worked out';

  // The one reason the commit carries, in the reference's order: a running
  // trip, a device with no rates, then the route's own refusal.
  let blockReason: string | null = null;
  if (view === 'ready' || view === 'nofares') {
    if (startedTrip) {
      blockReason = `Trip #${startedTrip.number} is running. It ends on the Dashboard, where the next trip is started.`;
    } else if (hasActiveTrip) {
      blockReason = ACTIVE_TRIP_REASON;
    } else if (view === 'nofares') {
      blockReason = NO_FARES_REASON;
    } else if (m && !m.ok) {
      blockReason = m.reason;
    } else if (!m) {
      blockReason = 'Choose an origin and a destination.';
    }
  }
  const canStart = blockReason === null && !starting;

  // The chrome subtitle: the number, the road, and the billable figure the
  // road switch actually moves — the conductor sees what the choice cost
  // without scrolling to look for it.
  const subtitle =
    view === 'loading'
      ? 'Reading local records…'
      : view === 'error'
        ? 'Records unavailable'
        : view === 'noterminals'
          ? 'No terminals on this device'
          : startedTrip
            ? `Trip #${startedTrip.number} · ${roadLabel}`
            : view === 'nofares'
              ? `Trip #${nextNumber} · ${roadLabel} · no rate`
              : m && m.ok
                ? `Trip #${nextNumber} · ${roadLabel} · ${formatKm(m.billableMilli)}`
                : `Trip #${nextNumber} · ${roadLabel}`;

  const storageNote = startedTrip
    ? 'One row stored. No fare is written at this step — the trip is the only thing that exists until a boarding is added to it.'
    : 'Starting a trip stores where it leaves from, where it is going, when it started, the route distance in km, and that it is running. No passenger and no fare yet — those are added to the trip afterwards.';

  const clear = () => {
    setOrigin(null);
    setDestination(null);
    setWriteError(null);
  };

  const swap = () => {
    if (!origin || !destination) return;
    setOrigin(destination);
    setDestination(origin);
    setWriteError(null);
  };

  const onStart = () => {
    if (!canStart || !origin || !destination || !m) return;
    setStarting(true);
    setWriteError(null);
    // Snapshot at the press, not at screen construction — one reading, so the
    // sheet and the store agree on when the trip began.
    const pressedAt = new Date().getTime();
    void startTrip({
      originTerminalId: origin.id,
      destinationTerminalId: destination.id,
      usesSctex,
      startedAt: pressedAt,
    }).then((result) => {
      setStarting(false);
      if (result.kind === 'started') {
        setStartedTrip({
          number: result.tripNumber,
          from: originLabel ?? origin.name,
          to: destinationLabel ?? destination.name,
          usesSctex,
          distMilli: m.distMilli,
          billableMilli: m.billableMilli,
          rateCentavos: m.rateCentavos,
          startedAt: pressedAt,
        });
        setSheet('started');
        return;
      }
      setWriteError(result.kind === 'invalid' ? result.reason : result.message);
    });
  };

  const closeSheet = () => {
    setSheet(null);
    setQuery('');
  };

  const working = view === 'ready' || view === 'nofares';

  return (
    <SectionChrome
      title="Add trip"
      subtitle={subtitle}
      titleMinHeight={56}
      onBack={() => setSheet('back')}
      insets={insets}
      testID="at-chrome"
      backTestID="at-back"
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.column, { paddingBottom: insets.bottom + space(6) }]}
        showsVerticalScrollIndicator={false}
      >
        {view === 'loading' ? (
          <GlassCard
            style={styles.card}
            testID="at-loading"
            accessible
            accessibilityLabel="Reading local records."
            accessibilityLiveRegion="polite"
          >
            <View style={[styles.skeleton, styles.skeletonTitle]} />
            <View style={[styles.skeleton, styles.skeletonRow, { marginTop: space(3) }]} />
            <View style={[styles.skeleton, styles.skeletonLabel, { marginTop: space(5) }]} />
            <View style={[styles.skeleton, styles.skeletonRow, { marginTop: space(3) }]} />
            <View style={[styles.skeleton, styles.skeletonBlock, { marginTop: space(6) }]} />
          </GlassCard>
        ) : null}

        {view === 'error' ? (
          <GlassCard style={[styles.card, styles.errorCard]} testID="at-error">
            <Text style={styles.stateTitle} accessibilityRole="header">
              Local records unavailable
            </Text>
            <Text style={styles.stateBodyError}>
              The trips table could not be read, so there is no number to give this trip and nothing
              safe to write.
            </Text>
            <Text style={styles.stateBodyError}>
              The app has no network path for this screen. Retry, and if it keeps failing the device
              is the thing to check.
            </Text>
            <Pressable
              onPress={retry}
              testID="at-retry"
              accessibilityRole="button"
              accessibilityLabel="Retry reading local records"
              style={({ pressed }) => [styles.ghostButton, styles.pickerAction, pressed && styles.pressed]}
            >
              <Icon name="check" size={18} color={palette.onSurface} />
              <Text style={styles.ghostButtonLabel}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        {view === 'noterminals' ? (
          <GlassCard style={styles.card} testID="at-noterminals">
            <Text style={styles.stateTitle} accessibilityRole="header">
              No terminals on this device
            </Text>
            <Text style={styles.stateBody}>
              A trip is a difference between two KM markers, so a device with no terminals cannot
              record one.
            </Text>
            <Text style={styles.stateBody}>
              In the app this is Settings → Terminals, which writes the name and the KM marker
              together.
            </Text>
            <Handoff testID="at-noterminals-handoff">
              Terminals live in Settings. There is no way to add one from this screen, and no way to
              add a trip without two.
            </Handoff>
          </GlassCard>
        ) : null}

        {/* 1. The three inputs, in decision order. Each field opens its own
            sheet of terminals, so no control here can be typed into wrongly. */}
        {working ? (
          <GlassCard style={styles.card} testID="at-route-card">
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel} accessibilityRole="header">
                ROUTE
              </Text>
              <Pressable
                onPress={clear}
                disabled={!origin && !destination}
                testID="at-clear"
                accessibilityRole="button"
                accessibilityLabel="Clear origin and destination"
                accessibilityState={{ disabled: !origin && !destination }}
                style={({ pressed }) => [
                  styles.textAction,
                  !origin && !destination && styles.textActionDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.textActionLabel}>Clear</Text>
              </Pressable>
            </View>

            <TerminalField
              testID="at-origin"
              label="ORIGIN"
              placeholder="Choose where the bus leaves"
              value={originLabel}
              onPress={() => setSheet('origin')}
            />

            <View style={styles.leg}>
              <View
                style={styles.legLine}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
              <Pressable
                onPress={swap}
                disabled={!origin || !destination}
                testID="at-swap"
                accessibilityRole="button"
                accessibilityLabel="Swap origin and destination"
                accessibilityState={{ disabled: !origin || !destination }}
                style={({ pressed }) => [
                  styles.swapButton,
                  (!origin || !destination) && styles.swapDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Icon name="arrowRight" size={20} color={palette.onSurface} />
              </Pressable>
              <View
                style={styles.legLine}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </View>
            <Text style={styles.legDist}>{legDist}</Text>

            <TerminalField
              testID="at-destination"
              label="DESTINATION"
              placeholder="Choose where the bus is going"
              value={destinationLabel}
              onPress={() => setSheet('destination')}
            />
          </GlassCard>
        ) : null}
        {legWarn ? (
          <Text style={styles.legWarnBelow} accessibilityLiveRegion="polite">
            {legWarn}
          </Text>
        ) : null}

        {/* 2. Which road. The rate it applies is named where the road is
             chosen, because one tap reprices every boarding the trip will take. */}
        {working ? (
          <GlassCard style={styles.card} testID="at-road-card">
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel} accessibilityRole="header">
                ROAD
              </Text>
            </View>
            <View style={styles.roadRow}>
              <RoadButton
                testID="at-road-ordinary"
                title="Ordinary"
                note="National road"
                pressed={!usesSctex}
                onPress={() => {
                  setUsesSctex(false);
                  setWriteError(null);
                }}
              />
              <RoadButton
                testID="at-road-sctex"
                title="SCTEX"
                note="Subic–Clark–Tarlac"
                pressed={usesSctex}
                onPress={() => {
                  setUsesSctex(true);
                  setWriteError(null);
                }}
              />
            </View>
            {usesSctex && rules ? (
              <View style={styles.roadNote}>
                <Text style={styles.roadNoteText}>
                  This trip is priced at the expressway rate of {formatRate(rules.expressRatePerKmCentavos)}{' '}
                  per km instead of {formatRate(rules.ratePerKmCentavos)}. Both come from one road
                  setting on the trip, stored with it so every boarding prices off the road chosen here.
                </Text>
              </View>
            ) : null}
          </GlassCard>
        ) : null}

        {/* 3. What the trip will bill, and no total: there is nobody on the
             bus yet, so these three numbers are the whole fare model. */}
        {view === 'ready' && rules && m ? (
          <GlassCard style={styles.card} testID="at-est-card">
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel} accessibilityRole="header">
                WHAT THIS TRIP WILL BILL
              </Text>
              <Pressable
                onPress={() => setSheet('rules')}
                testID="at-rules"
                accessibilityRole="button"
                accessibilityLabel="Open the fare rules this estimate is read against"
                style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
              >
                <Text style={styles.textActionLabel}>Rules</Text>
              </Pressable>
            </View>
            <EstRow k="Route distance" v={m.ok ? formatKm(m.distMilli) : '—'} />
            <EstRow k="Billable distance" v={m.ok ? formatKm(m.billableMilli) : '—'} />
            <EstRow
              k="Rate per km"
              v={m.ok ? `${formatRate(m.rateCentavos)} per km` : '—'}
              last
            />
            {m.ok ? <Text style={styles.hint}>{estimateNote({ measure: m, rules })}</Text> : null}
          </GlassCard>
        ) : null}

        {/* No fare rules: under the form, never in place of it — a route can
            still be chosen on a device with no rates. */}
        {view === 'nofares' ? (
          <GlassCard style={styles.card} testID="at-nofares">
            <Text style={styles.stateTitle} accessibilityRole="header">
              No fare rules set
            </Text>
            <Text style={styles.stateBody}>
              Fare settings are created empty, so a device that has never opened them has no rate
              and no minimum. A trip is still worth recording — the route does not depend on a peso
              — but nothing can be billed against it yet.
            </Text>
            <Pressable
              onPress={() => setSheet('rules')}
              testID="at-nofares-rules"
              accessibilityRole="button"
              accessibilityLabel="See what a rate would be used for"
              style={({ pressed }) => [styles.ghostButton, styles.pickerAction, pressed && styles.pressed]}
            >
              <Icon name="fare" size={18} color={palette.onSurface} />
              <Text style={styles.ghostButtonLabel}>See what a rate would be used for</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        {/* 4. The one commit, and the only control on this screen that leaves
            it. The reason sits above the button; the disabled branch drops the
            fill rather than fading it, so a dead CTA never reads as live. */}
        {working ? (
          <View style={styles.commitGroup}>
            {blockReason ? (
              <Text style={styles.blockReason} accessibilityLiveRegion="polite">
                {blockReason}
              </Text>
            ) : null}
            {writeError ? (
              <Text style={styles.writeError} accessibilityLiveRegion="assertive">
                {writeError}
              </Text>
            ) : null}
            <Pressable
              onPress={onStart}
              disabled={!canStart}
              testID="at-start"
              accessibilityRole="button"
              accessibilityLabel={[starting ? 'Starting the trip' : 'Start trip', blockReason]
                .filter(Boolean)
                .join('. ')}
              accessibilityState={{ disabled: !canStart, busy: starting }}
              style={({ pressed }) => [
                styles.solidButton,
                !canStart && styles.solidButtonDisabled,
                pressed && canStart && styles.pressed,
              ]}
            >
              <Text style={[styles.solidButtonLabel, !canStart && styles.solidButtonLabelDisabled]}>
                {starting
                  ? 'Starting…'
                  : startedTrip
                    ? `Trip #${startedTrip.number} running`
                    : 'Start trip'}
              </Text>
            </Pressable>
            {startedTrip ? (
              <Text style={styles.hint}>
                {`Trip #${startedTrip.number} is stored with its two ends, its start time and its route distance. Fares are priced per boarding, on the trip, later.`}
              </Text>
            ) : null}
          </View>
        ) : null}

        <GlassCard style={styles.storageCard} testID="storage-footer">
          <Icon name="database" size={18} color={palette.onSurfaceVariant} />
          <Text style={styles.storageNote}>{storageNote}</Text>
        </GlassCard>
      </ScrollView>

      {/* ── the five sheets ─────────────────────────────────────────────── */}
      {sheet === 'origin' || sheet === 'destination' ? (
        <PickerSheet
          side={sheet}
          terminals={terminals}
          municipalities={municipalities}
          query={query}
          setQuery={setQuery}
          selected={sheet === 'origin' ? origin : destination}
          other={sheet === 'origin' ? destination : origin}
          onClose={closeSheet}
          onPick={(terminal) => {
            if (sheet === 'origin') setOrigin(terminal);
            else setDestination(terminal);
            setWriteError(null);
            closeSheet();
          }}
        />
      ) : null}

      {sheet === 'rules' ? (
        <Sheet
          kind="rules"
          title="Fare rules"
          subtitle="The rates and floors this trip is read against"
          onClose={closeSheet}
        >
          <DetailCard>
            <DetailRow label="Rate per km" value={rules ? formatRate(rules.ratePerKmCentavos) : '—'} />
            <DetailRow
              label="SCTEX rate per km"
              value={rules ? formatRate(rules.expressRatePerKmCentavos) : '—'}
            />
            <DetailRow
              label="Minimum distance"
              value={rules ? formatKm(rules.minimumDistanceMilli) : '—'}
            />
            <DetailRow label="Minimum fare" value={rules ? formatPeso(rules.minimumFareCentavos) : '—'} />
            <DetailRow
              label="Special rate per km"
              value={rules ? formatRate(rules.specialRatePerKmCentavos) : '—'}
            />
          </DetailCard>
          <Text style={styles.hint}>
            These are read from the fare settings table, which is created empty and filled by Fare
            settings. A trip stores none of them: it stores the route distance it was started with
            and no road, and every boarding on it is priced from the values above at the moment it
            is added.
          </Text>
          <Text style={styles.hint}>
            A boarding takes the rate for its road, multiplies it by the billable distance, rounds
            down, and compares the result with the minimum fare. The floor comes last, so a short
            trip is never billed below {rules ? formatPeso(rules.minimumFareCentavos) : 'the minimum fare'}.
          </Text>
          <Text style={styles.hint}>
            The minimum distance is applied to the route distance first, and the half kilometre a
            toll road bills is added after it, not before: that half kilometre is distance a driver
            is billed for and not distance they drive, so it cannot be part of what the floor is
            measured against.
          </Text>
          <Text style={styles.hint}>
            The Deluxe rate and both discount fields are set in Fare settings and are not read by
            this screen: Deluxe is a service level, not something a conductor decides at a roadside
            stop, and the discounts are already folded into the special rate as it is stored.
          </Text>
          <Handoff>Fare settings, where all ten of these are edited</Handoff>
          {!rules ? (
            <Pressable
              onPress={() => {
                closeSheet();
                onOpenFareSettings();
              }}
              accessibilityRole="button"
              accessibilityLabel="Set up fare rules"
              style={({ pressed }) => [styles.solidButton, styles.sheetAction, pressed && styles.pressed]}
            >
              <Text style={styles.solidButtonLabel}>Set up fare rules</Text>
            </Pressable>
          ) : null}
        </Sheet>
      ) : null}

      {/* A sheet rather than a toast: the trip number is a reference the
          conductor may have to read out, and a toast is gone in two seconds. */}
      {sheet === 'started' && startedTrip ? (
        <Sheet
          kind="started"
          title={`Trip #${startedTrip.number} is running`}
          subtitle={`${startedTrip.from} → ${startedTrip.to}`}
          onClose={() => {
            closeSheet();
            onStarted();
          }}
          footer={
            <Pressable
              onPress={onAddFirstBoarding}
              testID="at-started-add"
              accessibilityRole="button"
              accessibilityLabel="Add the first boarding"
              style={({ pressed }) => [styles.solidButton, styles.sheetAction, pressed && styles.pressed]}
            >
              <Text style={styles.solidButtonLabel}>Add the first boarding</Text>
            </Pressable>
          }
        >
          <DetailCard>
            <DetailRow label="Trip" value={`#${startedTrip.number}`} />
            <DetailRow label="Leaves from" value={startedTrip.from} />
            <DetailRow label="Going to" value={startedTrip.to} />
            <DetailRow label="Road" value={startedTrip.usesSctex ? 'SCTEX' : 'Ordinary'} />
            <DetailRow label="Route distance" value={formatKm(startedTrip.distMilli)} />
            <DetailRow label="Billable distance" value={formatKm(startedTrip.billableMilli)} />
            <DetailRow label="Rate per km" value={formatRate(startedTrip.rateCentavos)} />
            <DetailRow label="Started" value={formatTime(new Date(startedTrip.startedAt))} />
          </DetailCard>
          <Text style={styles.hint}>
            The trip keeps the route distance it was started with, but neither the billable distance
            nor the rate. Those two are shown so the road choice can be checked; the boarding screen
            recomputes them from the same values.
          </Text>
          <Handoff>
            {`The Dashboard shows the running trip and is where the next one is started — not this screen, which will offer Trip #${startedTrip.number} again until this one ends.`}
          </Handoff>
        </Sheet>
      ) : null}

      {sheet === 'back' ? (
        <Sheet
          kind="back"
          title={startedTrip ? 'Leave while this trip runs?' : 'Leave this screen?'}
          subtitle={startedTrip ? `Trip #${startedTrip.number} keeps running` : 'Nothing has been stored yet'}
          onClose={closeSheet}
          footer={
            <Pressable
              onPress={onBack}
              testID="at-back-leave"
              accessibilityRole="button"
              accessibilityLabel="Leave this screen"
              style={({ pressed }) => [styles.solidButton, styles.sheetAction, pressed && styles.pressed]}
            >
              <Text style={styles.solidButtonLabel}>Leave</Text>
            </Pressable>
          }
        >
          <Handoff>
            A trip is started from the Dashboard, which is also where a running trip ends. A trip
            cannot be started from anywhere else in the app, so this screen is a detail of the
            Dashboard rather than a page of its own.
          </Handoff>
          <Text style={styles.hint}>
            {startedTrip
              ? 'The trip stays open on the Dashboard. Adding a boarding is the only thing that changes it.'
              : 'Choosing a route and leaving costs nothing. The commit is the only write on this screen.'}
          </Text>
        </Sheet>
      ) : null}
    </SectionChrome>
  );
}

/**
 * One field: a pressable row that opens a sheet of terminals. Only one sheet
 * is open at a time, so the same list markup cannot set the wrong end.
 */
function TerminalField({
  testID,
  label,
  placeholder,
  value,
  onPress,
}: {
  testID: string;
  label: string;
  placeholder: string;
  value: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${value ?? 'Not chosen'}. Opens the terminal list.`}
      style={({ pressed }) => [styles.field, pressed && styles.pressed]}
    >
      <View style={styles.fieldIcon}>
        <Icon name="terminal" size={20} color={palette.onTertiaryContainer} />
      </View>
      <View style={styles.fieldBody}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text
          style={[styles.fieldValue, !value && styles.fieldPlaceholder]}
          numberOfLines={1}
        >
          {value ?? placeholder}
        </Text>
      </View>
      <Icon name="chevron" size={18} color={palette.onSurfaceVariant} />
    </Pressable>
  );
}

/** One road of the two. Chosen = solid: a selected control inverts to the
 *  brand fill, so one orange means one thing on this screen. */
function RoadButton({
  testID,
  title,
  note,
  pressed,
  onPress,
}: {
  testID: string;
  title: string;
  note: string;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${note}`}
      accessibilityState={{ selected: pressed }}
      style={({ pressed: isPressed }) => [
        styles.roadButton,
        pressed && styles.roadButtonActive,
        isPressed && styles.pressed,
      ]}
    >
      <Text style={[styles.roadTitle, pressed && styles.roadTitleActive]}>{title}</Text>
      <Text style={[styles.roadSub, pressed && styles.roadSubActive]}>{note}</Text>
    </Pressable>
  );
}

/** One estimate line: label at the left, the tabular figure at the right. */
function EstRow({ k, v, last = false }: { k: string; v: string; last?: boolean }) {
  return (
    <View style={[styles.estRow, last && styles.estRowLast]}>
      <Text style={styles.estKey}>{k}</Text>
      <Text style={styles.estVal}>{v}</Text>
    </View>
  );
}

/**
 * The terminal sheet, shared by both ends: the distance is quoted against the
 * OTHER end, because that is the only number a conductor choosing a terminal is
 * actually shopping on. The chosen row inverts to the brand fill.
 */
function PickerSheet({
  side,
  terminals,
  municipalities,
  query,
  setQuery,
  selected,
  other,
  onClose,
  onPick,
}: {
  side: 'origin' | 'destination';
  terminals: TerminalRowRecord[];
  municipalities: MunicipalityRowRecord[];
  query: string;
  setQuery: (value: string) => void;
  selected: TerminalRowRecord | null;
  other: TerminalRowRecord | null;
  onClose: () => void;
  onPick: (terminal: TerminalRowRecord) => void;
}) {
  const results = filterTerminals(terminals, query);
  const muniName = (stop: TerminalRowRecord) =>
    stop.municipality_id != null
      ? municipalities.find((row) => row.id === stop.municipality_id)?.name ?? null
      : null;

  return (
    <Sheet
      kind={side}
      title={side === 'origin' ? 'Where does the bus leave?' : 'Where is the bus going?'}
      subtitle={`${terminals.length} terminals on this device`}
      onClose={onClose}
      fill
    >
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search terminal names"
        placeholderTextColor={palette.outline}
        accessibilityLabel={`Search ${side} terminals`}
        style={styles.pickerSearch}
      />
      {results.length === 0 ? (
        <Text style={styles.pickerEmpty} accessibilityLiveRegion="polite">
          No terminal matches “{query}”. Try a different name.
        </Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(terminal) => String(terminal.id)}
          style={styles.pickerList}
          // A row taps through on the first touch with the keyboard open —
          // the same rule the full-screen picker uses.
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={
            <Text style={styles.pickerMore}>
              A terminal with no KM marker cannot be used as either end of a route.
            </Text>
          }
          // Virtualized: a long terminal list must not render whole.
          renderItem={({ item }) => {
            const isSelected = selected?.id === item.id;
            const muni = muniName(item);
            const away =
              other && other.km_marker >= 0 && item.km_marker >= 0
                ? ` · ${distanceKm(Math.abs(item.km_marker - other.km_marker))} away`
                : '';
            const sub = `${muni ? `${muni} · ` : ''}${distanceKm(item.km_marker)}${away}`;
            return (
              <Pressable
                onPress={() => onPick(item)}
                testID={`at-stop-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${sub}${isSelected ? ', selected' : ''}`}
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => [
                  styles.pickerRow,
                  isSelected && styles.pickerRowSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.pickerIcon}>
                  <Icon name="terminal" size={18} color={palette.onTertiaryContainer} />
                </View>
                <View style={styles.pickerRowBody}>
                  <Text
                    style={[styles.pickerRowName, isSelected && styles.pickerRowTextSelected]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text
                    style={[styles.pickerRowSub, isSelected && styles.pickerRowTextSelected]}
                    numberOfLines={1}
                  >
                    {sub}
                  </Text>
                </View>
                {isSelected ? <Icon name="check" size={18} color={palette.onPrimary} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  pressed: { opacity: 0.88 },

  card: {
    marginHorizontal: space(5),
    marginTop: space(5),
    padding: space(5),
  },
  // Every card on this screen has a header, so the 10px lands once, under the
  // head, and the card's own 20px padding is not doubled by a top margin.
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(2),
    marginBottom: space(3),
  },
  sectionLabel: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
    flexShrink: 1,
  },
  textAction: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(1),
  },
  textActionDisabled: { opacity: 0.4 },
  textActionLabel: {
    ...type.labelSmall,
    color: palette.primarySolid,
  },

  // ROUTE
  field: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(3),
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: palette.outlineVariant,
    backgroundColor: palette.surfaceContainerLowest,
  },
  fieldIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.small,
    backgroundColor: palette.tertiaryContainer,
  },
  fieldBody: { flex: 1, minWidth: 0 },
  fieldLabel: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
  },
  fieldValue: {
    ...type.titleMedium,
    color: palette.onSurface,
  },
  fieldPlaceholder: {
    ...type.bodyMedium,
    fontWeight: '500',
    color: palette.onSurfaceVariant,
  },
  // The leg is a rule broken by the swap control, with the distance sitting
  // under it: the distance is what joins the two fields.
  leg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginVertical: space(3),
  },
  legLine: {
    flex: 1,
    height: 1,
    backgroundColor: palette.outline,
  },
  swapButton: {
    width: 44,
    height: 44,
    flex: 1,
    maxWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surfaceContainerLowest,
  },
  swapDisabled: { opacity: 0.55 },
  legDist: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginBottom: space(3),
  },
  // The reference hangs the refusal under the card, not inside it: the card
  // holds the two choices, the sentence below explains why they do not price.
  legWarnBelow: {
    ...type.bodySmall,
    color: palette.error,
    marginHorizontal: space(5),
    marginTop: space(2),
  },

  // ROAD
  roadRow: {
    flexDirection: 'row',
    gap: space(2),
  },
  roadButton: {
    flex: 1,
    minHeight: 61,
    justifyContent: 'center',
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: palette.outlineVariant,
    backgroundColor: palette.surfaceContainerLowest,
  },
  // Clicked = solid: the chosen road inverts to the brand fill.
  roadButtonActive: {
    backgroundColor: palette.primarySolid,
    borderColor: palette.primarySolid,
    borderWidth: 2,
  },
  roadTitle: {
    ...type.titleMedium,
    color: palette.onSurface,
  },
  roadTitleActive: { color: palette.onPrimary },
  roadSub: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: 2,
  },
  roadSubActive: { color: palette.onPrimary },
  // The consequence of the road, in pesos, right where the road is chosen.
  roadNote: {
    marginTop: space(3),
    padding: space(3),
    borderRadius: radius.medium,
    backgroundColor: palette.secondary,
  },
  roadNoteText: {
    ...type.bodySmall,
    color: palette.onSecondary,
  },

  // ESTIMATE
  estRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(3),
    paddingVertical: space(3),
    borderBottomWidth: 1,
    borderBottomColor: palette.outline,
  },
  estRowLast: { borderBottomWidth: 0 },
  estKey: {
    ...type.bodyMedium,
    color: palette.onSurfaceVariant,
    flexShrink: 1,
  },
  estVal: {
    ...type.bodyMedium,
    fontWeight: '600',
    color: palette.onSurface,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  hint: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: space(3),
  },

  // COMMIT
  commitGroup: {
    marginHorizontal: space(5),
    marginTop: space(5),
  },
  // The reference paints the reason in the neutral ramp: it is a refusal, not
  // an error — the write never failed.
  blockReason: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginBottom: space(3),
  },
  writeError: {
    ...type.bodySmall,
    color: palette.error,
    marginTop: space(2),
    marginBottom: space(3),
  },
  solidButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(4),
    borderRadius: radius.large,
    backgroundColor: palette.primarySolid,
  },
  // Dropping the fill, not fading it: opacity blends toward the page and takes
  // the white label under AA with it. A grey button is not a primary.
  solidButtonDisabled: {
    backgroundColor: palette.surfaceContainer,
  },
  solidButtonLabel: {
    ...type.labelLarge,
    color: '#FFFFFF',
  },
  solidButtonLabelDisabled: {
    color: palette.onSurfaceVariant,
  },
  sheetAction: {
    marginTop: space(4),
  },
  ghostButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space(3),
    paddingHorizontal: space(4),
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  pickerAction: {
    flexDirection: 'row',
    gap: space(2),
  },
  ghostButtonLabel: {
    ...type.labelLarge,
    color: palette.onSurface,
  },

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
  storageNote: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    flex: 1,
  },

  // Whole-screen states
  stateTitle: {
    ...type.titleMedium,
    color: palette.onSurface,
  },
  stateBody: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: space(2),
  },
  stateBodyError: {
    ...type.bodySmall,
    color: palette.onErrorContainer,
    marginTop: space(2),
  },
  errorCard: {
    backgroundColor: palette.errorContainer,
    borderWidth: 1,
    borderColor: palette.error,
  },
  skeleton: {
    borderRadius: radius.small,
    backgroundColor: palette.surfaceContainer,
  },
  skeletonTitle: { height: 16, width: '34%' },
  skeletonRow: { height: 56 },
  skeletonLabel: { height: 16, width: '22%' },
  skeletonBlock: { height: 96 },

  // Terminal sheet
  pickerSearch: {
    minHeight: 44,
    paddingHorizontal: space(3),
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: palette.outlineVariant,
    color: palette.onSurface,
    ...type.bodyMedium,
  },
  pickerList: {
    // NOT `flex: 1`: basis 0 inside the fill body measures the list at zero on
    // Android and the rows never appear. `flexShrink: 1` with the default
    // auto basis lets a short list hug its rows and a long one take the
    // sheet's `maxHeight` clamp, where it scrolls.
    flexShrink: 1,
    marginTop: space(2),
  },
  pickerEmpty: {
    ...type.bodyMedium,
    color: palette.onSurfaceVariant,
    marginTop: space(4),
    textAlign: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    minHeight: 56,
    marginTop: space(2),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: palette.outlineVariant,
    backgroundColor: palette.surfaceContainerLowest,
  },
  // Chosen = solid, the same rule the road buttons follow.
  pickerRowSelected: {
    backgroundColor: palette.primarySolid,
    borderColor: palette.primarySolid,
    borderWidth: 2,
  },
  pickerIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.small,
    backgroundColor: palette.tertiaryContainer,
  },
  pickerRowBody: { flex: 1, minWidth: 0 },
  pickerRowName: {
    ...type.bodyMedium,
    fontWeight: '600',
    color: palette.onSurface,
  },
  pickerRowSub: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: 2,
  },
  pickerRowTextSelected: {
    color: palette.onPrimary,
  },
  pickerMore: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: space(3),
    marginBottom: space(2),
  },
});
