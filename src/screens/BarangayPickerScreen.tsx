import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../icons';
import { cardShadow, glass, palette, radius, space, type } from '../theme';
import {
  fetchActiveTerminals,
  fetchTripWithTickets,
  subscribeToTripWithTickets,
} from '../data/tripTicketsStore';
import type { TerminalRowRecord, TripRowRecord } from '../data/schema';
import {
  DESTINATION_SIDE_TOKEN,
  destinationStopsAfterOrigin,
  filterBarangaysByQuery,
  locationLabel,
  nearestOriginStop,
  rowAnnouncement,
  toBarangayRow,
  toPickerState,
  tripStopsWithinBounds,
  type BarangayRow,
  type PickerSide,
} from '../lib/barangayPickerState';
import { distanceKm } from '../lib/tripTicketsFormat';

export type BarangayPickerScreenProps = {
  /** Required: the trip whose route bounds eligibility. Missing means no list. */
  tripId: number;
  /** Destination token or anything else (boarding). Never a third branch. */
  side: string;
  /** Optional municipality scope. Unused in this port's single-table registry. */
  municipalityId?: number | null;
  /**
   * The subtitle text. This port has no municipalities table to resolve an id
   * against, so the label rides alongside the id — absent means no subtitle.
   */
  municipalityLabel?: string | null;
  /** The currently selected origin barangay; destination side only. */
  originId?: number | null;
  onBack: () => void;
  /**
   * The per-side result write. The caller owns the two distinct keys; the
   * picker only promises to call it for the side it was opened for.
   */
  onPick: (side: PickerSide, barangayId: number) => void;
};

/**
 * The Barangay Picker.
 *
 * Chooses one registered stop for one side of a ticket being recorded. It
 * exists only inside the ticket-recording flow: it writes nothing, navigates
 * nowhere forward, and returns exactly one id through the caller's result
 * channel before going back.
 *
 * The list is the eligible subset — the same rules the recording flow applies
 * (see `barangayPickerState`) — never all active stops. Search narrows after
 * eligibility, so an out-of-scope KM query reads "No matches", not a fake row.
 */
export function BarangayPickerScreen({
  tripId,
  side,
  municipalityId = null,
  municipalityLabel = null,
  originId = null,
  onBack,
  onPick,
}: BarangayPickerScreenProps) {
  const insets = useSafeAreaInsets();
  // The destination token decides the side; anything else is boarding. No
  // third branch, no crash on an unexpected value.
  const resolvedSide: PickerSide =
    side === DESTINATION_SIDE_TOKEN ? 'destination' : 'boarding';

  // The search query is the screen's only local state — component state, so
  // it dies with the screen and re-entering always starts empty.
  const [query, setQuery] = useState('');

  // Store observations. No copies: the rows are derived on every render.
  const [trip, setTrip] = useState<TripRowRecord | null>(null);
  const [tripLoaded, setTripLoaded] = useState(false);
  const [terminals, setTerminals] = useState<TerminalRowRecord[]>([]);

  // Trips and terminals ride the store's single change notification, so a
  // marker edit or a deactivation elsewhere recomputes this list live.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      fetchActiveTerminals()
        .then((rows) => {
          if (!cancelled) setTerminals(rows);
        })
        .catch(() => {
          /* Terminals empty → bounds cannot resolve → the empty branch. */
        });
      fetchTripWithTickets(tripId)
        .then((read) => {
          if (cancelled) return;
          setTripLoaded(true);
          setTrip(read.trip);
        })
        .catch(() => {
          // A failed trip read leaves trip null with tripLoaded true — the
          // bounds cannot resolve, and the fold shows the empty branch, not
          // loading.
          if (!cancelled) setTripLoaded(true);
        });
    };
    run();
    const unsubscribe = subscribeToTripWithTickets(tripId, () => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tripId]);

  // The trip's route endpoints, resolved against the terminal list. The stored
  // snapshots are matched by name against each terminal's display name.
  const { originMarker, destinationMarker } = useMemo(() => {
    if (!trip) return { originMarker: null, destinationMarker: null };
    const origin = terminals.find(
      (t) => t.name === trip.origin_location_snapshot,
    );
    const destination = terminals.find(
      (t) => t.name === trip.destination_location_snapshot,
    );
    return {
      originMarker: origin?.km_marker ?? null,
      destinationMarker: destination?.km_marker ?? null,
    };
  }, [trip, terminals]);

  // Derivation order matters: scope → bounds/direction → side narrowing →
  // search. Filtering first would let an out-of-scope KM query pose as a row.
  const eligible = useMemo(() => {
    // A municipality scope has no effect in this port's single-table registry
    // (each terminal names its own municipality); the parameter is honoured
    // structurally so the pipeline matches the original screen's shape.
    const rows = terminals.map(toBarangayRow);
    if (resolvedSide === 'destination') {
      const originRow = originId !== null ? rows.find((r) => r.id === originId) ?? null : null;
      return destinationStopsAfterOrigin(
        rows,
        originRow?.id ?? null,
        originMarker,
        destinationMarker,
      );
    }
    return nearestOriginStop(
      tripStopsWithinBounds(rows, originMarker, destinationMarker),
      originMarker,
      destinationMarker,
    );
  }, [terminals, resolvedSide, originId, originMarker, destinationMarker]);

  const filtered = useMemo(
    () => filterBarangaysByQuery(eligible, query),
    [eligible, query],
  );

  // Loading: the trip has not landed AND both lists are still empty. Not a
  // timer. A trip failure with terminals loaded is not loading.
  const dataPending = !tripLoaded && terminals.length === 0;

  const state = toPickerState(eligible, filtered, dataPending, query);

  const title =
    resolvedSide === 'destination' ? 'SELECT DESTINATION' : 'SELECT BOARDING LOCATION';

  const pick = (row: BarangayRow) => {
    Keyboard.dismiss();
    onPick(resolvedSide, row.id);
  };

  return (
    <View style={styles.screen}>
      {/* Fixed header — not inside the scroll. */}
      <View style={[styles.header, { paddingTop: insets.top + space(2) }]}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Icon name="chevronLeft" size={20} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {/* Subtitle only when a municipality was supplied. The registry's
              single-table shape means the caller supplies the label text
              through the same prop the id rides — absent means absent. */}
          {municipalityLabel != null ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {municipalityLabel}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Fixed search field. */}
      <View style={styles.searchWrap}>
        <View style={styles.searchField}>
          <Icon name="search" size={18} color={palette.primary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search barangay or registered KM"
            placeholderTextColor={palette.outline}
            accessibilityLabel="Search barangay or registered KM"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
          />
        </View>
      </View>

      {/* The list fills the rest. */}
      <FlatList
        data={state.kind === 'ready' ? state.rows : []}
        keyExtractor={(row) => String(row.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          state.kind === 'loading' ? (
            <View style={styles.stateBlock} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={palette.primary} />
              <Text style={styles.stateText}>Loading locations</Text>
            </View>
          ) : state.kind === 'emptyEligible' ? (
            <View style={styles.stateBlock} accessibilityLiveRegion="polite">
              <View style={styles.stateIcon}>
                <Icon name="route" size={24} color={palette.onSurfaceVariant} />
              </View>
              <Text style={styles.stateTitle}>No eligible locations</Text>
              <Text style={styles.stateText}>
                No registered barangay is available for this selection along the trip.
              </Text>
            </View>
          ) : state.kind === 'emptyMatches' ? (
            <View style={styles.stateBlock} accessibilityLiveRegion="polite">
              <View style={styles.stateIcon}>
                <Icon name="search" size={24} color={palette.onSurfaceVariant} />
              </View>
              <Text style={styles.stateTitle}>No matches</Text>
              <Text style={styles.stateText}>
                Try a different barangay name or registered KM.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => pick(item)}
            accessible
            accessibilityRole="button"
            accessibilityLabel={rowAnnouncement(item, resolvedSide, distanceKm)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={2}>
                {item.barangayName}
              </Text>
              <Text style={styles.rowLocation} numberOfLines={1}>
                {locationLabel(item)}
              </Text>
            </View>
            <Text style={styles.rowKm}>{distanceKm(item.kmMarker)}</Text>
          </Pressable>
        )}
        ListFooterComponent={<View style={{ height: insets.bottom + space(4) }} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  pressed: { opacity: 0.88 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(4),
    paddingVertical: space(2),
  },
  // ORANGE GLASS, the shared SectionChrome pair: solid accent fill, lit 1px
  // lip, 44 square. The one hand-rolled header outside SectionChrome.
  back: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.primarySolid,
    borderWidth: 1,
    borderColor: glass.rim,
    ...cardShadow,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space(4),
    paddingVertical: space(1.25),
    borderRadius: radius.full,
    backgroundColor: palette.primarySolid,
    borderWidth: 1,
    borderColor: glass.rim,
    ...cardShadow,
  },
  title: { ...type.titleMedium, color: '#FFFFFF' },
  subtitle: { ...type.bodySmall, color: '#FFFFFF', marginTop: space(0.5) },

  searchWrap: { paddingHorizontal: space(4), paddingVertical: space(2) },
  searchField: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: palette.outlineVariant,
    backgroundColor: palette.surfaceContainerLowest,
  },
  searchInput: { flex: 1, color: palette.onSurface, ...type.bodyMedium },

  listContent: {
    paddingHorizontal: space(4),
    paddingTop: space(2),
    gap: space(2),
  },

  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    borderRadius: radius.medium,
    backgroundColor: palette.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: palette.outlineVariant,
  },
  rowText: { flex: 1 },
  rowName: { ...type.bodyMedium, fontWeight: '600', color: palette.onSurface },
  rowLocation: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: space(0.5),
  },
  // 4.5:1, not `palette.primary`'s 3.79:1 — a 16px number is still normal text.
  rowKm: {
    ...type.titleMedium,
    color: glass.accentPrimary,
    fontVariant: ['tabular-nums'],
  },

  stateBlock: {
    alignItems: 'center',
    padding: space(8),
    gap: space(2),
  },
  stateIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: { ...type.titleMedium, color: palette.onSurface, textAlign: 'center' },
  stateText: { ...type.bodyMedium, color: palette.onSurfaceVariant, textAlign: 'center' },
});
