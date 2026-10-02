import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DetailCard, DetailRow, Handoff, Sheet } from '../components/BottomSheet';
import { GlassCard } from '../components/GlassCard';
import { SectionChrome } from '../components/SectionChrome';
import { Icon } from '../icons';
import { cardShadow, onAmber, onPrimarySolid, radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import {
  fetchAvailableTrips,
  fetchTripTickets,
  subscribeToPassengerData,
  type PassengerTicketRow,
  type PassengerTripRecord,
} from '../data/passengerStore';
import type { TripRowRecord } from '../data/schema';
import { tripNumber, tripRoute } from '../data/tripHelpers';
import {
  aggregateByMunicipality,
  distinctMunicipalities,
  filterRowsBySearch,
  mixEntries,
  mixLabel,
  municipalityOf,
  municipalityRowKey,
  orderAvailableTrips,
  PASSENGER_FILTERS,
  passengerSummary,
  resolveSelectedTrip,
  toSqlFilter,
  type LoadState,
  type MunicipalityPassengerRow,
  type PassengerFilter,
} from '../lib/passengerState';
import { plural } from '../lib/currentTripState';
import { formatKm } from '../lib/addTicketFare';
import { formatMediumDate } from '../lib/tripScreenFormat';
import { formatRowStamp } from '../lib/tripTicketsFormat';

export type PassengerScreenProps = {
  onBack: () => void;
  /** The no-trips state's exit — Trip management. */
  onOpenTrips: () => void;
};

/** The ledger renders the 12 largest groups and says what it is not showing. */
const PAIR_LIMIT = 12;
/** The picker lists 8 trips and hands the rest to Trip management. */
const PICKER_LIMIT = 8;
/** The shipped EMPTY_VALUE, verbatim: a missing distance says so. */
const NO_DISTANCE = 'Distance not recorded';

type SheetKind = 'pick' | 'pair' | 'all' | 'back' | null;
type RankedRow = { row: MunicipalityPassengerRow; rank: number };

/**
 * The elapsed line, at minute resolution: "45 minutes on the road" while the
 * trip runs, "… on the road" once it ends. The only figure on this screen
 * that moves by itself; the repaint stands down while a sheet is open or the
 * search has focus.
 */
function roadElapsed(startedAt: number, endedAt: number | null, now: number) {
  const minutes = Math.max(0, Math.round(((endedAt ?? now) - startedAt) / 60000));
  return `${plural(minutes, 'minute', 'minutes')} ${endedAt !== null ? 'on the road' : 'so far'}`;
}

/**
 * The Passenger screen.
 *
 * One card for the selected trip — identity, terminals, meta, the passenger
 * count as the lead figure, the three figures the fold derives, and the one
 * control that changes the scope. Amber only while the selected trip is
 * ACTIVE (the app-wide invariant); glass when completed. Anonymous by
 * construction: a "passenger" is a quantity, and the finest identity here is
 * a municipality pair.
 *
 * One read, unfiltered: the five chips filter client-side, so a chip tap
 * never re-reads the store and the card keeps the trip's own totals.
 */
export function PassengerScreen({ onBack, onOpenTrips }: PassengerScreenProps) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [retryToken, setRetryToken] = useState(0);
  const retry = useCallback(() => {
    setLoad({ kind: 'loading' });
    setRetryToken((token) => token + 1);
  }, []);

  const [availableTrips, setAvailableTrips] = useState<PassengerTripRecord[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [tickets, setTickets] = useState<PassengerTicketRow[]>([]);
  const [filter, setFilter] = useState<PassengerFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocus, setSearchFocus] = useState(false);
  const searchFocused = useRef(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [pair, setPair] = useState<RankedRow | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // One effect, one subscription: trips and the selected trip's tickets ride
  // the same store notification, so a fare recorded anywhere repaints the
  // picker, the card and the ledger together. `ready` is set only after the
  // tickets answer, so the first paint is the reference's skeleton — never a
  // card of zeroes.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      fetchAvailableTrips()
        .then((board) => {
          if (cancelled) return;
          const ordered = orderAvailableTrips(board.active, board.completed);
          setAvailableTrips(ordered);
          if (ordered.length === 0) {
            setTickets([]);
            setLoad({ kind: 'empty', message: 'No trips recorded on this device yet.' });
            return;
          }
          const selected = resolveSelectedTrip(ordered, selectedTripId);
          return fetchTripTickets(selected?.id ?? 0, null)
            .then((rows) => {
              if (cancelled) return;
              setTickets(rows);
              setLoad({ kind: 'ready' });
            })
            .catch((error: unknown) => {
              if (!cancelled)
                setLoad({
                  kind: 'error',
                  message:
                    error instanceof Error
                      ? error.message
                      : 'The ticket records on this device could not be read.',
                });
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
    };
    run();
    const unsubscribe = subscribeToPassengerData(() => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [selectedTripId, retryToken]);

  // One paint a minute for the card's elapsed figure. It stands down while a
  // sheet is open or the search has focus, so a tick can never yank a
  // half-typed search out from under a thumb.
  const sheetOpen = sheet !== null;
  useEffect(() => {
    if (sheetOpen) return;
    const id = setInterval(() => {
      if (!searchFocused.current) setNow(Date.now());
    }, 60_000);
    return () => clearInterval(id);
  }, [sheetOpen]);

  const selectedTrip = useMemo(
    () => resolveSelectedTrip(availableTrips, selectedTripId),
    [availableTrips, selectedTripId],
  );

  // Two aggregates from the same fold: the card's own totals read the whole
  // trip; the ledger's bars read the chip-scoped rows. The denominator is the
  // scoped total and never the search result.
  const allAgg = useMemo(() => aggregateByMunicipality(tickets), [tickets]);
  const scopedTickets = useMemo(() => {
    const sql = toSqlFilter(filter);
    return sql === null ? tickets : tickets.filter((row) => row.passenger_type === sql);
  }, [tickets, filter]);
  const scopedAgg = useMemo(() => aggregateByMunicipality(scopedTickets), [scopedTickets]);

  const denom = scopedAgg.totalPassengers;
  const tripGroups = allAgg.rows.length;
  const total = allAgg.totalPassengers;
  const places = useMemo(() => distinctMunicipalities(allAgg.rows), [allAgg]);

  // Rank is stamped on the full ranked list, before the search, so a search
  // can never renumber the rows it leaves on screen.
  const ranked = useMemo<RankedRow[]>(() => {
    const rankOf = new Map<MunicipalityPassengerRow, number>();
    scopedAgg.rows.forEach((row, index) => rankOf.set(row, index + 1));
    return filterRowsBySearch(scopedAgg.rows, searchQuery).map((row) => ({
      row,
      rank: rankOf.get(row) ?? 0,
    }));
  }, [scopedAgg, searchQuery]);

  const shown = ranked.slice(0, PAIR_LIMIT);
  const capped = ranked.length > PAIR_LIMIT;
  const hasQuery = searchQuery.trim() !== '';
  const summary = passengerSummary({
    filter,
    denom,
    filtered: ranked.length,
    tripGroups,
    hasQuery,
  });

  const subtitle =
    load.kind === 'loading'
      ? 'Reading local records…'
      : load.kind === 'error'
        ? 'Records unavailable'
        : load.kind === 'empty' || !selectedTrip
          ? 'No trips on this device'
          : `Trip #${tripNumber(selectedTrip)} · ${plural(total, 'passenger', 'passengers')}`;

  // The privacy note, last, in the reference's four branches.
  const storageNote: ReactNode =
    load.kind === 'loading' ? (
      'Reading the local store…'
    ) : load.kind === 'error' ? (
      'The local store did not answer. No figure on this screen is computed.'
    ) : load.kind === 'empty' || !selectedTrip ? (
      'Nothing is stored on this device yet. No network is used at any point.'
    ) : (
      <>
        <Text style={styles.storageStrong}>No names.</Text>
        {' A passenger is a quantity, and the finest thing this app stores about one is the pair of places they travelled between. '}
        {tickets.length > 0
          ? `This trip’s ${total} were counted from ${plural(tickets.length, 'fare', 'fares')}, `
          : 'Everything here is '}
        all kept on this device — no network is used.
      </>
    );

  const closeSheet = () => {
    setSheet(null);
    setPair(null);
  };

  /** The back pill opens the reference's backHome sheet, not a silent exit. */
  const backToHome = () => setSheet('back');

  const pairMix = pair ? mixEntries(pair.row.byType) : [];

  const overlays = (
    <>
      {/* 1. The trip picker — the card's own control, capped at 8. */}
      {sheet === 'pick' ? (
        <Sheet
          kind="pick"
          title="Switch trip"
          subtitle={`${plural(availableTrips.length, 'trip', 'trips')} on this device`}
          onClose={closeSheet}
        >
          {availableTrips.slice(0, PICKER_LIMIT).map((trip) => {
            const current = selectedTrip?.id === trip.id;
            const live = trip.status === 'ACTIVE';
            return (
              <Pressable
                key={trip.id}
                onPress={() => {
                  setSelectedTripId(trip.id);
                  closeSheet();
                }}
                testID={`ps-pick-${trip.id}`}
                accessibilityRole="button"
                accessibilityLabel={
                  `${tripRoute(trip)}. Trip number ${tripNumber(trip)}, ` +
                  `${formatMediumDate(trip.started_at)}, ${live ? 'running now' : 'ended'}.` +
                  `${current ? ' Currently selected.' : ''}`
                }
                accessibilityState={{ selected: current }}
                style={({ pressed }) => [
                  styles.pickRow,
                  current && styles.pickRowCurrent,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.pickBody}>
                  <Text
                    style={[styles.pickName, current && styles.pickNameCurrent]}
                    numberOfLines={2}
                  >
                    {tripRoute(trip)}
                  </Text>
                  <Text style={[styles.pickSub, current && styles.pickSubCurrent]}>
                    {`#${tripNumber(trip)} · ${formatMediumDate(trip.started_at)} · ${
                      live
                        ? 'running now'
                        : `ended ${formatRowStamp(trip.ended_at ?? trip.started_at)}`
                    }`}
                  </Text>
                </View>
                {live ? (
                  <View style={styles.pillRunning}>
                    <Text style={styles.pillRunningText}>RUNNING</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {availableTrips.length > PICKER_LIMIT ? (
            <View style={styles.pickMore}>
              <Text style={styles.pickMoreText}>
                {`${availableTrips.length - PICKER_LIMIT} more ${
                  availableTrips.length - PICKER_LIMIT === 1 ? 'trip is' : 'trips are'
                } not listed here. A 45-day store runs to over a hundred, and scrolling them inside a trip screen is the wrong place for them — the full list opens Trip management, which is where they can be searched and filtered.`}
              </Text>
            </View>
          ) : null}
          <Handoff testID="ps-pick-handoff">
            In the app this opens Trip management, the full trip list with its search and its
            filters.
          </Handoff>
        </Sheet>
      ) : null}

      {/* 2. The group sheet — raw stored strings beside the derived
          municipalities, so the parser conflict is visible. */}
      {sheet === 'pair' && pair && selectedTrip ? (
        <Sheet
          kind="pair"
          title={`${pair.row.originMunicipality} → ${pair.row.destinationMunicipality}`}
          subtitle={`Group ${pair.rank} of ${scopedAgg.rows.length} on trip #${tripNumber(selectedTrip)}`}
          onClose={closeSheet}
        >
          <DetailRow label="Passengers" value={String(pair.row.passengerCount)} />
          <DetailRow
            label="Share in scope"
            value={`${denom > 0 ? Math.round((pair.row.passengerCount / denom) * 100) : 0}% of ${denom}`}
          />
          <DetailRow label="Fares in this group" value={String(pair.row.fares ?? 0)} />
          {pair.row.firstBoardedAt != null ? (
            <DetailRow
              label="First boarded"
              value={`${formatRowStamp(pair.row.firstBoardedAt)} · ${formatMediumDate(pair.row.firstBoardedAt)}`}
            />
          ) : null}
          {pair.row.lastBoardedAt != null ? (
            <DetailRow
              label="Last boarded"
              value={`${formatRowStamp(pair.row.lastBoardedAt)} · ${formatMediumDate(pair.row.lastBoardedAt)}`}
            />
          ) : null}
          {pairMix.length > 0 ? (
            <DetailCard>
              {pairMix.map((entry) => (
                <DetailRow
                  key={entry.label}
                  label={entry.label}
                  value={`${entry.qty} · ${entry.pct}%`}
                />
              ))}
            </DetailCard>
          ) : null}
          <DetailRow
            label="Boarding point, as stored"
            value={pair.row.originSnapshot ?? 'Not recorded'}
          />
          <DetailRow
            label="Boarding municipality used"
            value={municipalityOf(pair.row.originSnapshot)}
          />
          <DetailRow
            label="Drop-off point, as stored"
            value={pair.row.destinationSnapshot ?? 'Not recorded'}
          />
          <DetailRow
            label="Drop-off municipality used"
            value={municipalityOf(pair.row.destinationSnapshot)}
          />
          <DetailRow label="Trip terminals" value={tripRoute(selectedTrip)} />
          <Handoff testID="ps-pair-handoff">
            In the app this opens nothing — reading a group does not navigate anywhere.
          </Handoff>
        </Sheet>
      ) : null}

      {/* 3. All boarding groups — the cap's way out, a reading list only. */}
      {sheet === 'all' && selectedTrip ? (
        <Sheet
          kind="all"
          title="All boarding groups"
          subtitle={`Trip #${tripNumber(selectedTrip)} · ${plural(tripGroups, 'group', 'groups')} on this trip`}
          onClose={closeSheet}
        >
          <DetailCard>
            {scopedAgg.rows.map((row, index) => (
              <DetailRow
                key={municipalityRowKey(row)}
                label={`${index + 1}. ${row.originMunicipality} → ${row.destinationMunicipality}`}
                value={`${row.passengerCount} · ${
                  denom > 0 ? Math.round((row.passengerCount / denom) * 100) : 0
                }%`}
              />
            ))}
          </DetailCard>
          <DetailRow
            label="Distinct boarding municipalities"
            value={String(places)}
          />
          <DetailRow label="Fares on this trip" value={String(tickets.length)} />
          <DetailRow label="Passengers on this trip" value={String(total)} />
          <Handoff testID="ps-all-handoff">
            In the app this opens nothing on this screen — the cap is a reading limit, not a
            place.
          </Handoff>
        </Sheet>
      ) : null}

      {/* 4. Back — the reference states where the back pill goes before it
          goes there. */}
      {sheet === 'back' ? (
        <Sheet
          kind="back"
          title="Back to Home"
          subtitle="The root screen"
          onClose={closeSheet}
          footer={
            <Pressable
              onPress={onBack}
              testID="ps-back-home"
              accessibilityRole="button"
              accessibilityLabel="Go back to Home"
              style={({ pressed }) => [styles.solidButton, pressed && styles.pressed]}
            >
              <Text style={styles.solidButtonLabel}>Go Home</Text>
            </Pressable>
          }
        >
          <DetailRow label="Trips on file" value={String(availableTrips.length)} />
          <DetailRow
            label="Running now"
            value={
              selectedTrip?.status === 'ACTIVE' ? `Trip #${tripNumber(selectedTrip)}` : 'None'
            }
          />
          <DetailRow label="Passengers on this trip" value={String(total)} />
          <Handoff testID="ps-back-handoff">
            In the app this opens Home, the brand header and the quick actions.
          </Handoff>
        </Sheet>
      ) : null}
    </>
  );

  // ── Loading ───────────────────────────────────────────────────────────
  if (load.kind === 'loading') {
    return (
      <Chrome subtitle={subtitle} onBack={backToHome} insets={insets}>
        <View style={styles.column}>
          <GlassCard
            style={styles.card}
            testID="ps-loading"
            accessible
            accessibilityLabel="Reading the local store."
            accessibilityLiveRegion="polite"
          >
            <View style={[styles.sk, styles.skLabel]} />
            <View style={[styles.sk, styles.skBig]} />
            <View style={[styles.sk, styles.skLead]} />
            <View style={[styles.sk, styles.skButton]} />
          </GlassCard>
          <StorageFooter note={storageNote} />
        </View>
        {overlays}
      </Chrome>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────
  if (load.kind === 'error') {
    return (
      <Chrome subtitle={subtitle} onBack={backToHome} insets={insets}>
        <View style={styles.column}>
          <View
            style={[styles.stateCard, styles.errorCard]}
            testID="ps-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            <Text style={[styles.stateHeading, styles.errorHeading]} accessibilityRole="header">
              Passenger records could not be read
            </Text>
            <Text style={[styles.stateBody, styles.errorBody]}>
              The trip and the fares on it did not answer on this device, so no count, no group
              and no share can be shown. Nothing was lost — the records are still here, and
              Retry reads them again.
            </Text>
            <Pressable
              onPress={retry}
              testID="ps-retry"
              accessibilityRole="button"
              accessibilityLabel="Retry reading passenger records"
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            >
              <Icon name="history" size={18} color={onPrimarySolid} />
              <Text style={styles.primaryBtnLabel}>Retry</Text>
            </Pressable>
          </View>
          <StorageFooter note={storageNote} />
        </View>
        {overlays}
      </Chrome>
    );
  }

  // ── No trips on this device ───────────────────────────────────────────
  if (load.kind === 'empty' || availableTrips.length === 0) {
    return (
      <Chrome subtitle={subtitle} onBack={backToHome} insets={insets}>
        <View style={styles.column}>
          <View style={styles.stateCard} testID="ps-notrips">
            <Text style={styles.stateHeading} accessibilityRole="header">
              No trips on this device
            </Text>
            <Text style={styles.stateBody}>
              Passengers are counted per trip, and there is no trip here yet. Start one, or open
              a trip you have already run, and everyone you carried will be here — grouped by
              the two places they travelled between.
            </Text>
            <Pressable
              onPress={onOpenTrips}
              testID="ps-go-trips"
              accessibilityRole="button"
              accessibilityLabel="Go to trip management"
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            >
              <Icon name="bus" size={18} color={onPrimarySolid} />
              <Text style={styles.primaryBtnLabel}>Go to trips</Text>
            </Pressable>
          </View>
          <StorageFooter note={storageNote} />
        </View>
        {overlays}
      </Chrome>
    );
  }

  // ── Ready ─────────────────────────────────────────────────────────────
  const header = (
    <>
      {/* 1. The trip and its riders, in one card. */}
      {selectedTrip ? (
        <TripCard
          trip={selectedTrip}
          total={total}
          fares={tickets.length}
          groups={tripGroups}
          places={places}
          now={now}
          onSwitch={() => setSheet('pick')}
        />
      ) : null}

      {/* 2. Filter, search, and the sentence that closes the ambiguity. */}
      <View style={styles.filterRow}>
        {PASSENGER_FILTERS.map((entry) => {
          const selected = filter === entry.value;
          return (
            <Pressable
              key={entry.value}
              onPress={() => setFilter(entry.value)}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${entry.scope}`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && !selected && styles.chipPressed,
              ]}
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.chipLabel,
                    (selected || pressed) && styles.chipLabelSelected,
                  ]}
                >
                  {entry.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.search, searchFocus && styles.searchFocused]}>
        <Icon name="search" size={18} color={theme.palette.onSurfaceVariant} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search a place"
          placeholderTextColor={theme.palette.outline}
          accessibilityLabel="Search boarding and drop-off places"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onFocus={() => {
            searchFocused.current = true;
            setSearchFocus(true);
          }}
          onBlur={() => {
            searchFocused.current = false;
            setSearchFocus(false);
          }}
          style={styles.searchInput}
        />
        {searchQuery !== '' ? (
          <Pressable
            onPress={() => setSearchQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear the place search"
            style={({ pressed }) => [styles.searchClear, pressed && styles.pressed]}
          >
            <Icon name="close" size={18} color={theme.palette.onSurfaceVariant} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.fsummary}>
        <Text style={styles.fsummaryText} accessibilityLiveRegion="polite">
          {summary}
        </Text>
      </View>

      {/* 3. The group ledger. */}
      <View style={styles.secHead}>
        <Text style={styles.secTitle} accessibilityRole="header">
          BOARDING GROUPS
        </Text>
        {shown.length > 0 ? (
          <Pressable
            onPress={() => setSheet('all')}
            accessibilityRole="button"
            accessibilityLabel="All boarding groups. Opens the full group list."
            style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
          >
            <Text style={styles.textActionLabel}>ALL GROUPS</Text>
            <Icon name="chevron" size={14} color={theme.glass.accentPrimary} />
          </Pressable>
        ) : null}
      </View>
    </>
  );

  const emptyBlock =
    tickets.length === 0 ? (
      <View style={styles.inlineEmpty} testID="ps-ledger-nofares">
        <Text style={styles.inlineEmptyLabel} accessibilityRole="header">
          NO FARES ON THIS TRIP
        </Text>
        <Text style={styles.inlineEmptyBody}>
          {selectedTrip?.status === 'ACTIVE'
            ? 'This trip is running and nothing has been recorded against it yet. The first fare you record appears here, grouped by where its passengers got on.'
            : 'This trip closed with nothing recorded against it.'}
        </Text>
      </View>
    ) : (
      <View style={styles.inlineEmpty} testID="ps-ledger-nomatch">
        <Text style={styles.inlineEmptyLabel} accessibilityRole="header">
          NO GROUP MATCHES
        </Text>
        <Text style={styles.inlineEmptyBody}>
          {`Nothing here matches “${searchQuery.trim()}”. The ${plural(
            denom,
            'passenger',
            'passengers',
          )} in scope are still on this trip.`}
        </Text>
        <Pressable
          onPress={() => setSearchQuery('')}
          accessibilityRole="button"
          accessibilityLabel="Clear the place search"
          style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
        >
          <Text style={styles.ghostBtnLabel}>Clear the search</Text>
        </Pressable>
      </View>
    );

  const footer = (
    <>
      {capped ? (
        <Text style={styles.ledgerCap} testID="ps-ledger-cap">
          {`Showing the ${PAIR_LIMIT} largest of ${ranked.length} groups — ${
            ranked.length - PAIR_LIMIT
          } more.`}
        </Text>
      ) : null}
      {/* The vocabulary split, stated: the card quotes the trip's terminals;
          these groups come from the location snapshot stored on each fare. */}
      <Text style={styles.ledgerFoot}>
        The card above shows this trip’s terminals. These groups come from the boarding and
        drop-off points stored on each fare, so a pair can name any two places along the way.
      </Text>
      <StorageFooter note={storageNote} />
    </>
  );

  return (
    <Chrome subtitle={subtitle} onBack={backToHome} insets={insets}>
      <FlatList
        style={styles.screen}
        data={shown}
        keyExtractor={(entry) => municipalityRowKey(entry.row)}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <PairRow
            entry={item}
            denom={denom}
            onPress={() => {
              setPair(item);
              setSheet('pair');
            }}
          />
        )}
        ListEmptyComponent={emptyBlock}
        ListFooterComponent={footer}
        contentContainerStyle={[
          styles.column,
          { paddingBottom: insets.bottom + space(9) },
        ]}
        showsVerticalScrollIndicator={false}
      />
      {overlays}
    </Chrome>
  );
}

/** The chrome every branch shares. */
function Chrome({
  subtitle,
  onBack,
  insets,
  children,
}: {
  subtitle: string;
  onBack: () => void;
  insets: { top: number; bottom: number };
  children: ReactNode;
}) {
  return (
    <SectionChrome
      title="Passengers"
      subtitle={subtitle}
      titleMinHeight={56}
      onBack={() => onBack()}
      insets={insets}
      testID="ps-chrome"
      backTestID="ps-back"
      subtitleTestID="ps-chrome-sub"
    >
      {children}
    </SectionChrome>
  );
}

/** One figure in the card's hero row — FARES / GROUPS / MUNICIPALITIES. */
function Figure({ value, label, live }: { value: number; label: string; live: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureValue, live && styles.amberPrimary]}>{value}</Text>
      <Text style={[styles.figureLabel, live && styles.amberMuted]}>{label}</Text>
    </View>
  );
}

/**
 * The trip card. Amber only while the trip is ACTIVE — the app-wide
 * invariant, at parity with the Home hero, the Trip card and the Trip-
 * tickets card; glass when completed. One card replaces the shipped three.
 */
function TripCard({
  trip,
  total,
  fares,
  groups,
  places,
  now,
  onSwitch,
}: {
  trip: TripRowRecord;
  total: number;
  fares: number;
  groups: number;
  places: number;
  now: number;
  onSwitch: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const live = trip.status === 'ACTIVE';
  const detail =
    `${trip.distance_km_milli > 0 ? formatKm(trip.distance_km_milli) : NO_DISTANCE}` +
    ` · started ${formatRowStamp(trip.started_at)}` +
    ` · ${roadElapsed(trip.started_at, trip.ended_at, now)}`;
  const label =
    `${live ? 'Trip in progress' : 'Trip completed'}. Trip number ${tripNumber(trip)}. ` +
    `${trip.origin_location_snapshot} to ${trip.destination_location_snapshot}. ` +
    `${total} passengers on this trip. ${detail}.`;

  const body = (
    <>
      <View style={styles.pcHead}>
        <View style={styles.pcHeadText}>
          <Text style={[styles.pcEyebrow, live && styles.amberMuted]}>
            {live ? 'TRIP IN PROGRESS' : 'TRIP COMPLETED'}
          </Text>
          <Text style={[styles.pcTitle, live && styles.amberPrimary]}>
            Passengers on this trip
          </Text>
        </View>
        <View style={[styles.stPill, live && styles.stPillSolid]}>
          <Text style={[styles.stPillText, live && styles.stPillTextSolid]}>
            TRIP #{tripNumber(trip)}
          </Text>
        </View>
      </View>

      <View style={styles.heroRoute}>
        <Text style={[styles.heroRouteText, live && styles.amberPrimary]}>
          {trip.origin_location_snapshot}
        </Text>
        <Icon
          name="arrowRight"
          size={18}
          color={live ? onAmber.faint : theme.palette.onSurfaceVariant}
        />
        <Text style={[styles.heroRouteText, live && styles.amberPrimary]}>
          {trip.destination_location_snapshot}
        </Text>
      </View>

      <Text style={[styles.pcDetail, live && styles.amberDetail]}>{detail}</Text>

      <View style={styles.leadFigure}>
        <Text style={[styles.leadValue, live && styles.amberPrimary]}>{total}</Text>
        <Text style={[styles.leadLabel, live && styles.amberMuted]}>
          PASSENGERS ON THIS TRIP
        </Text>
      </View>

      <View style={[styles.heroFigures, live && styles.heroFiguresSolid]}>
        <Figure value={fares} label="FARES" live={live} />
        <Figure value={groups} label="GROUPS" live={live} />
        <Figure value={places} label="MUNICIPALITIES" live={live} />
      </View>

      {/* The card's only control, and it is a ghost: this screen is a reader,
          so no ready state on it carries a solid primary at all. */}
      <Pressable
        onPress={onSwitch}
        accessibilityRole="button"
        accessibilityLabel="Switch trip. Opens the trip list."
        style={({ pressed }) => [
          styles.ghostBtn,
          live && styles.ghostBtnSolid,
          pressed && styles.pressed,
        ]}
      >
        <Icon name="swap" size={16} color={live ? onAmber.detail : theme.palette.onSurfaceVariant} />
        <Text style={[styles.ghostBtnLabel, live && styles.amberDetail]}>Switch trip</Text>
      </Pressable>
    </>
  );

  return live ? (
    <View style={styles.passCardSolid} testID="ps-card-active" accessible accessibilityLabel={label}>
      {body}
    </View>
  ) : (
    <GlassCard style={styles.passCard} testID="ps-card-completed" accessible accessibilityLabel={label}>
      {body}
    </GlassCard>
  );
}

/**
 * One boarding group. The rank is a 2-digit label in a 20px slot, the pair
 * leads, the fare-type mix sits under it, and the count shares a line with
 * the bar that measures it.
 */
function PairRow({
  entry,
  denom,
  onPress,
}: {
  entry: RankedRow;
  denom: number;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { row, rank } = entry;
  const pct = denom > 0 ? Math.round((row.passengerCount / denom) * 100) : 0;
  const mix = mixLabel(row.byType);
  const label =
    `Group ${rank}. ${row.originMunicipality} to ${row.destinationMunicipality}. ` +
    `${plural(row.passengerCount, 'passenger', 'passengers')}, ${pct} percent of the ${denom} in scope.` +
    (mix ? ` ${mix.charAt(0).toUpperCase()}${mix.slice(1)}. ` : ' ') +
    'Opens the group.';

  return (
    <GlassCard
      style={styles.pairCard}
      onPress={onPress}
      testID={`ps-row-${rank}`}
      accessibilityRole="button"
      accessible
      accessibilityLabel={label}
    >
      <View style={styles.prHead}>
        <Text style={styles.prRank}>{rank < 10 ? `0${rank}` : rank}</Text>
        <View style={styles.prBody}>
          <Text style={styles.prPair} numberOfLines={2}>
            {`${row.originMunicipality} → ${row.destinationMunicipality}`}
          </Text>
          {mix ? (
            <Text style={styles.prSub} numberOfLines={1}>
              {mix}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.prFoot}>
        <View
          style={styles.prTrack}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${pct} percent of the ${denom} in scope`}
        >
          <View style={[styles.prFill, { width: `${pct}%` }]} />
        </View>
        <View style={styles.prCount}>
          <Text style={styles.prCountValue}>{row.passengerCount}</Text>
          <Text style={styles.prCountLabel}>passengers</Text>
        </View>
      </View>
    </GlassCard>
  );
}

/** The storage footer, last — the privacy note after the answer. */
function StorageFooter({ note }: { note: ReactNode }) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <GlassCard style={styles.storageCard} testID="ps-storage">
      <Icon name="database" size={18} color={theme.palette.onSurfaceVariant} />
      <Text style={styles.storageNote}>{note}</Text>
    </GlassCard>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  screen: { flex: 1 },
  column: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  pressed: { opacity: 0.88 },

  // ── states ──────────────────────────────────────────────────────────────
  card: {
    marginHorizontal: space(5),
    marginTop: space(3),
    padding: space(5),
  },
  sk: { borderRadius: radius.small, backgroundColor: theme.palette.surfaceContainer },
  skLabel: { height: 11, width: '34%', borderRadius: 6 },
  skBig: { height: 22, width: '62%', marginTop: space(3.5) },
  skLead: { height: 34, width: '34%', marginTop: space(5) },
  skButton: { height: 44, width: '100%', marginTop: space(5), borderRadius: radius.full },

  stateCard: {
    marginHorizontal: space(5),
    marginTop: space(3),
    padding: space(5),
    borderRadius: radius.xlarge,
    borderWidth: 1,
    borderColor: theme.palette.outlineVariant,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.55)',
  },
  errorCard: { borderColor: theme.palette.error, backgroundColor: theme.palette.errorContainer },
  stateHeading: { ...type.headlineSmall, color: theme.palette.onSurface },
  errorHeading: { color: theme.palette.onErrorContainer },
  stateBody: { ...type.bodyMedium, color: theme.palette.onSurfaceVariant, marginTop: space(2) },
  errorBody: { color: theme.palette.onErrorContainer },
  primaryBtn: {
    marginTop: space(3.5),
    minHeight: 48,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(5),
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  primaryBtnLabel: { ...type.labelLarge, color: onPrimarySolid },
  solidButton: {
    marginTop: space(4),
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  solidButtonLabel: { ...type.labelLarge, color: onPrimarySolid },

  // ── the trip card ───────────────────────────────────────────────────────
  passCard: {
    marginHorizontal: space(5),
    marginTop: space(3),
    padding: space(5),
  },
  // The running trip is a flat amber panel, not a glass one: the tint, the
  // rim and the grain are what make glass read as frosted, and on a solid
  // fill they only soften it. The drop shadow stays.
  passCardSolid: {
    marginHorizontal: space(5),
    marginTop: space(3),
    padding: space(5),
    borderRadius: radius.glass,
    backgroundColor: theme.palette.secondary,
    overflow: 'hidden',
    ...cardShadow,
    // Only the shadow's colour follows the mode — the geometry is the card's.
    shadowColor: theme.glass.shadow,
  },
  pcHead: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  pcHeadText: { flex: 1, minWidth: 0 },
  pcEyebrow: { ...type.labelSmall, color: theme.palette.onSurfaceVariant },
  pcTitle: { ...type.titleMedium, color: theme.palette.onSurface, marginTop: space(2) },
  stPill: {
    paddingHorizontal: space(2.5),
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: theme.palette.secondaryContainer,
  },
  // `onSecondaryContainer` inverted into a chip: light pairs #4A3600 with
  // #FFB300 (6.1:1), but dark flips BOTH ends (#FFEFC7 under #FFD066) and the
  // pair collapses to 1.4:1. `onSecondary` is the same dark brown in either
  // palette, so the amber card — itself light in either mode — always gets a
  // dark chip with amber ink on it.
  stPillSolid: { backgroundColor: theme.palette.onSecondary },
  stPillText: { ...type.labelSmall, color: theme.palette.onSecondaryContainer },
  stPillTextSolid: { color: theme.palette.secondary },
  heroRoute: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space(2),
    marginTop: space(3),
  },
  heroRouteText: { ...type.headlineSmall, color: theme.palette.onSurface },
  pcDetail: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(1) },
  leadFigure: { marginTop: space(3) },
  leadValue: {
    ...type.displaySmall,
    color: theme.palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  leadLabel: { ...type.labelSmall, color: theme.palette.onSurfaceVariant, marginTop: space(0.5) },
  heroFigures: {
    flexDirection: 'row',
    gap: space(3),
    marginTop: space(4),
    paddingTop: space(4),
    borderTopWidth: 1,
    borderTopColor: theme.palette.outline,
  },
  heroFiguresSolid: { borderTopColor: 'rgba(61, 46, 0, 0.7)' },
  figure: { flex: 1, minWidth: 0 },
  figureValue: {
    ...type.titleMedium,
    color: theme.palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  figureLabel: { ...type.labelSmall, color: theme.palette.onSurfaceVariant, marginTop: space(0.5) },
  amberPrimary: { color: onAmber.primary },
  amberDetail: { color: onAmber.detail },
  amberMuted: { color: onAmber.muted },
  ghostBtn: {
    marginTop: space(4),
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    paddingHorizontal: space(4),
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: theme.palette.outline,
    backgroundColor: 'transparent',
  },
  ghostBtnSolid: { borderColor: 'rgba(61, 46, 0, 0.6)' },
  ghostBtnLabel: { ...type.labelLarge, color: theme.palette.onSurfaceVariant },

  // ── filter bar: five equal tracks in one row ────────────────────────────
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: space(5),
    marginTop: space(5),
  },
  chip: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: space(1),
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: theme.palette.outline,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    borderWidth: 2,
    borderColor: theme.palette.primarySolid,
    backgroundColor: theme.palette.primarySolid,
  },
  chipPressed: {
    borderWidth: 2,
    borderColor: theme.palette.primarySolid,
    backgroundColor: theme.palette.primarySolid,
  },
  chipLabel: { ...type.labelSmall, color: theme.palette.onSurfaceVariant, textAlign: 'center' },
  chipLabelSelected: { color: onPrimarySolid },

  // ── search + summary ────────────────────────────────────────────────────
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    minHeight: 48,
    marginTop: space(3),
    marginHorizontal: space(5),
    paddingLeft: space(3),
    paddingRight: space(0.5),
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: theme.palette.outline,
    backgroundColor: theme.glass.tint,
  },
  searchFocused: { borderColor: theme.palette.primarySolid },
  searchInput: {
    flex: 1,
    minHeight: 44,
    padding: 0,
    ...type.bodyMedium,
    color: theme.palette.onSurface,
  },
  searchClear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fsummary: { flexDirection: 'row', marginTop: space(3), marginHorizontal: space(5) },
  fsummaryText: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, flex: 1 },

  // ── the ledger ──────────────────────────────────────────────────────────
  secHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(2),
    marginHorizontal: space(5),
    marginTop: space(5),
    marginBottom: space(3),
  },
  secTitle: { ...type.labelSmall, color: theme.palette.onSurfaceVariant },
  textAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    paddingHorizontal: space(1),
  },
  textActionLabel: { ...type.labelSmall, color: theme.glass.accentPrimary },

  pairCard: {
    marginHorizontal: space(5),
    marginTop: space(3),
    padding: space(5),
  },
  prHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2) },
  prRank: {
    width: 20,
    ...type.labelSmall,
    color: theme.palette.onSurfaceVariant,
    paddingTop: space(1),
    fontVariant: ['tabular-nums'],
  },
  prBody: { flex: 1, minWidth: 0 },
  prPair: { ...type.titleMedium, color: theme.palette.onSurface },
  prSub: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(1) },
  prFoot: { flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(3) },
  prTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: theme.palette.surfaceContainer,
    overflow: 'hidden',
  },
  prFill: { height: '100%', borderRadius: radius.full, backgroundColor: theme.palette.tertiary },
  prCount: { flexDirection: 'row', alignItems: 'baseline', gap: space(1) },
  prCountValue: {
    ...type.titleMedium,
    fontWeight: '700',
    color: theme.palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  prCountLabel: { ...type.bodySmall, color: theme.palette.onSurfaceVariant },
  ledgerCap: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginHorizontal: space(5),
    marginTop: space(3),
  },
  ledgerFoot: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginHorizontal: space(5),
    marginTop: space(3),
  },

  // ── inline empties ──────────────────────────────────────────────────────
  inlineEmpty: {
    marginHorizontal: space(5),
    marginTop: space(3),
    padding: space(4),
    borderRadius: radius.xlarge,
    borderWidth: 1,
    borderColor: theme.palette.outlineVariant,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.5)',
  },
  inlineEmptyLabel: { ...type.labelSmall, color: theme.palette.onSurface },
  inlineEmptyBody: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(1.5) },

  // ── storage footer ──────────────────────────────────────────────────────
  storageCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(2),
    marginTop: space(5),
    marginHorizontal: space(5),
    paddingVertical: space(3),
    paddingHorizontal: space(5),
  },
  storageNote: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, flex: 1 },
  storageStrong: { fontWeight: '700', color: theme.palette.onSurface },

  // ── trip picker ─────────────────────────────────────────────────────────
  pickRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(2),
    marginTop: space(2),
    width: '100%',
    borderWidth: 1,
    borderColor: theme.palette.outline,
    borderRadius: radius.large,
    backgroundColor: theme.palette.surface,
  },
  pickRowCurrent: {
    borderWidth: 2,
    borderColor: theme.palette.primarySolid,
    backgroundColor: theme.palette.primarySolid,
    padding: space(1.75),
  },
  pickBody: { flex: 1, minWidth: 0 },
  pickName: { ...type.titleMedium, color: theme.palette.onSurface },
  pickNameCurrent: { color: onPrimarySolid },
  pickSub: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(0.5) },
  pickSubCurrent: { color: onPrimarySolid },
  pillRunning: {
    paddingHorizontal: space(2.5),
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: theme.palette.secondaryContainer,
  },
  pillRunningText: { ...type.labelSmall, color: theme.palette.onSecondaryContainer },
  pickMore: {
    marginTop: space(3),
    padding: space(3),
    borderRadius: radius.large,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.palette.outline,
  },
  pickMoreText: { ...type.bodySmall, color: theme.palette.onSurfaceVariant },
});
