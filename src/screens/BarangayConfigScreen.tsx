import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionChrome } from '../components/SectionChrome';
import { GlassBackdrop } from '../components/GlassBackdrop';
import { GlassCard } from '../components/GlassCard';
import { DetailCard, DetailRow, Sheet } from '../components/BottomSheet';
import { ConfigTransferSheet, TransferTrigger } from '../components/ConfigTransferSheet';
import { Icon } from '../icons';
import { maxContentWidth, onPrimarySolid, radius, space, tintedGlass, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import {
  deactivateMunicipality,
  deactivateTerminal,
  fetchAllMunicipalities,
  fetchAllTerminals,
  subscribeToTrips,
  type DeactivateMunicipalityResult,
  type DeactivateResult,
} from '../data/tripTicketsStore';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import { plural } from '../lib/currentTripState';
import { takeScreenFlash } from '../lib/screenFlash';
import { useConfigTransfer } from '../lib/useConfigTransfer';
import { BARANGAY_REGISTRY } from '../lib/transferRegistry';
import {
  barangayDetailPairs,
  barangayDetailSubtitle,
  barangayRowValue,
  deriveLocationView,
  initialLocationUiState,
  locationCountAnnouncement,
  locationEmptyState,
  municipalityDetailPairs,
  municipalityRowValue,
  recordAnnouncement,
  scopeMenuItems,
  scopeOptionSelected,
  scopeTriggerAnnouncement,
  scopeTriggerLabel,
  toConfigBarangayRow,
  type ConfigBarangayRow,
  type DetailPair,
  type LocationEmptyAction,
  type LocationStatusFilter,
  type LocationTab,
  type LocationConfigurationUiState,
  type MunicipalityRow,
} from '../lib/barangayConfigState';

export type BarangayConfigScreenProps = {
  onBack: () => void;
  /** Barangay editor — create (null) or edit (id). One route, one param. */
  onOpenBarangayEditor: (barangayId: number | null) => void;
  /** Municipality editor — create (null) or edit (id). One route, one param. */
  onOpenMunicipalityEditor: (municipalityId: number | null) => void;
};

/** Tabs, in reading order, with the labels the segment prints. */
const TABS: { key: LocationTab; label: string }[] = [
  { key: 'BARANGAYS', label: 'Barangays' },
  { key: 'MUNICIPALITIES', label: 'Municipalities' },
];

const STATUS_FILTERS: LocationStatusFilter[] = ['ALL', 'ACTIVE', 'INACTIVE'];

/** Thousandths of a km → the one decimal the reference prints on a marker: "231.0 KM". */
const fmtKm = (milli: number): string => `${(milli / 1000).toFixed(1)} KM`;

const GENERIC_MUNICIPALITY_FAILURE = 'Unable to deactivate municipality.';

/** The sheet the screen has open. One at a time — a sheet that replaces a sheet. */
type Overlay =
  | { kind: 'status' }
  | { kind: 'scope' }
  | { kind: 'record'; rowKind: ListRow['kind']; id: number }
  | { kind: 'confirm'; rowKind: ListRow['kind']; id: number }
  | { kind: 'transfer' };

/** The list's one item type, tagged so renderItem narrows without casts. */
type ListRow =
  | { kind: 'barangay'; barangay: ConfigBarangayRow }
  | { kind: 'municipality'; municipality: MunicipalityRow; barangayCount: number };

/**
 * The Barangay Configuration screen.
 *
 * A registry with a filter and one write: it lists the barangays and the
 * municipalities, deactivates a record, and opens a read-only detail sheet. It
 * does not price a boarding and owns no global state.
 *
 * The redesign in one sentence: right tokens, wrong language. Every recipe
 * here is one a sibling screen already owns — the control card is the
 * Dashboard's glass range-card with its segment and caption, the two controls
 * are add-trip's `.field` pickers, every record is Settings' row MINUS its
 * chip, the overlays are the bottom sheet every other screen opens, the
 * empties are `.inline-empty` and the loading state is the shell's skeleton.
 *
 * What changed, and why:
 *
 *   · the intro card is gone — it printed the title the chrome already says.
 *   · the status filter is a CAPTION that names its live value, and it renders
 *     on BOTH tabs, because its selection narrows both lists.
 *   · one row shape for both collections, with no chip and no inline actions:
 *     the row opens a sheet, and the sheet is where EDIT and DEACTIVATE live.
 *   · the count sits in the section head beside the collection it counts, and
 *     says "2 of 20" the moment anything is hidden.
 *   · three empty shapes in a fixed order, so a filtered-out list can never
 *     read as a missing one, and only an empty registry invites a duplicate.
 *   · DEACTIVATE is named for what it does (the old card said DELETE), and the
 *     confirm is the primary treatment, not the error fill: a deactivation is
 *     a routine one-way flag, not a fault.
 */
export function BarangayConfigScreen({
  onBack,
  onOpenBarangayEditor,
  onOpenMunicipalityEditor,
}: BarangayConfigScreenProps) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  // Local state, reset on unmount: re-entering shows the barangays tab, both
  // queries empty, no scope, and ALL. The record lists are never copied —
  // the store is the only copy. The editor's one announcement rides in on
  // this first read, consumed once: it was set just before navigating back,
  // it shows here, and the next mount finds nothing to repeat — the
  // prototype's takeFlash(), without its storage key.
  const [state, setState] = useState<LocationConfigurationUiState>(() => {
    const initial = initialLocationUiState();
    const flash = takeScreenFlash();
    return flash === null ? initial : { ...initial, message: flash };
  });
  const [barangays, setBarangays] = useState<TerminalRowRecord[] | null>(null);
  const [municipalities, setMunicipalities] = useState<MunicipalityRowRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const apply = useCallback(
    (patch: Partial<typeof state>) => setState((current) => ({ ...current, ...patch })),
    [],
  );

  // Two live observations, one subscription. Returning from an editor
  // repaints through the store's change notification — no refetch on focus,
  // no values round-tripped through params.
  useEffect(() => {
    let cancelled = false;
    const run = () =>
      // The BARANGAY half of the registry, not every stop: the terminal list
      // is the other module's, and reading both is what made the two
      // Configuration screens show the same rows.
      Promise.all([fetchAllTerminals('BARANGAY'), fetchAllMunicipalities()])
        .then(([terminalRows, municipalityRows]) => {
          if (cancelled) return;
          setBarangays(terminalRows);
          setMunicipalities(municipalityRows);
          setLoadError(null);
        })
        .catch(() => {
          if (cancelled) return;
          setLoadError('Unable to load location configuration.');
        });
    run();
    const unsubscribe = subscribeToTrips(() => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const isLoading = (barangays === null || municipalities === null) && loadError === null;

  // Province comes from the LINKED municipality row — the flat stop name
  // cannot carry it, and an unlinked row is passed an empty province.
  const allBarangays = useMemo(
    () =>
      (barangays ?? []).map((terminal) =>
        toConfigBarangayRow(
          terminal,
          (municipalities ?? []).find((m) => m.id === terminal.municipality_id)?.province ?? '',
        ),
      ),
    [barangays, municipalities],
  );

  // The single derivation: search → scope → status → sort for barangays,
  // search → status → sort for municipalities, totals and the fixed counts
  // from the unfiltered collections.
  const view = useMemo(
    () =>
      deriveLocationView({
        allBarangays,
        allMunicipalities: municipalities ?? [],
        barangaySearchQuery: state.barangaySearchQuery,
        municipalitySearchQuery: state.municipalitySearchQuery,
        selectedMunicipalityId: state.selectedMunicipalityId,
        statusFilter: state.statusFilter,
      }),
    [allBarangays, municipalities, state],
  );

  const onBarangays = state.selectedTab === 'BARANGAYS';
  const query = onBarangays ? state.barangaySearchQuery : state.municipalitySearchQuery;
  const hasQuery = query.trim() !== '';
  const scopeApplied = scopeTriggerLabel(state.selectedMunicipalityId, municipalities ?? []);
  const scopeItems = useMemo(() => scopeMenuItems(municipalities ?? []), [municipalities]);
  const rows: ListRow[] = useMemo(
    () =>
      onBarangays
        ? view.barangays.map((barangay): ListRow => ({ kind: 'barangay', barangay }))
        : view.municipalities.map(
            (municipality): ListRow => ({
              kind: 'municipality',
              municipality,
              barangayCount: view.barangayCountByMunicipality[municipality.id] ?? 0,
            }),
          ),
    [onBarangays, view],
  );

  // The chrome subtitle is one fact the list cannot show all of: both
  // collection sizes, and the state of the read while there is one.
  const chromeSubtitle = isLoading
    ? 'Loading locations'
    : loadError !== null
      ? 'Location configuration unavailable'
      : `${plural(view.totalBarangays, 'barangay', 'barangays')} · ${plural(view.totalMunicipalities, 'municipality', 'municipalities')}`;

  // The empty branch, resolved from the controls that are actually applied —
  // the scope only counts on the barangays tab, because that is the only tab
  // the scope narrows.
  const empty = useMemo(
    () =>
      locationEmptyState({
        noun: onBarangays ? 'barangays' : 'municipalities',
        hasQuery,
        statusFilter: state.statusFilter,
        scope: onBarangays && state.selectedMunicipalityId !== null ? scopeApplied : null,
      }),
    [onBarangays, hasQuery, state.statusFilter, state.selectedMunicipalityId, scopeApplied],
  );

  // One sheet's record, re-read from the CURRENT rows every render: a write
  // replaces the list, and a row captured before it would be the old record.
  const target: ListRow | null = useMemo(() => {
    if (overlay === null || (overlay.kind !== 'record' && overlay.kind !== 'confirm')) return null;
    if (overlay.rowKind === 'barangay') {
      const barangay = allBarangays.find((row) => row.id === overlay.id);
      return barangay ? { kind: 'barangay', barangay } : null;
    }
    const municipality = (municipalities ?? []).find((row) => row.id === overlay.id);
    return municipality
      ? {
          kind: 'municipality',
          municipality,
          barangayCount: view.barangayCountByMunicipality[municipality.id] ?? 0,
        }
      : null;
  }, [overlay, allBarangays, municipalities, view]);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setDeactivating(false);
  }, []);

  const openRecord = useCallback((rowKind: ListRow['kind'], id: number) => {
    setOverlay({ kind: 'record', rowKind, id });
  }, []);

  /**
   * The LINKED municipality's name for one row. The stop string's parsed tail
   * is "Olongapo" where the municipality row says "Olongapo City"; every line
   * this screen prints reads the linked row so it can never disagree with the
   * scope filter that narrowed the list to it.
   */
  const linkedNameOf = useCallback(
    (row: ConfigBarangayRow) =>
      row.municipalityId === null
        ? null
        : (view.municipalityNameById[row.municipalityId] ?? null),
    [view.municipalityNameById],
  );

  const confirmDeactivate = useCallback(() => {
    if (overlay === null || overlay.kind !== 'confirm' || deactivating) return;
    setDeactivating(true);
    const { rowKind, id } = overlay;
    const done = (message: string) => {
      setDeactivating(false);
      setOverlay(null);
      // One transient message, either way; the list follows the store, never an
      // optimistic flip, and a failure never touches the load branch.
      apply({ message });
    };
    if (rowKind === 'barangay') {
      void deactivateTerminal(id).then((result: DeactivateResult) => {
        done(result === 'deactivated' ? 'Barangay deactivated.' : 'Unable to deactivate barangay.');
      });
      return;
    }
    void deactivateMunicipality(id).then((result: DeactivateMunicipalityResult) => {
      // The repository's own explanation for a rule rejection, verbatim; the
      // generic sentence only for unexpected failures.
      done(
        result.kind === 'deactivated'
          ? 'Municipality deactivated.'
          : result.kind === 'rejected'
            ? result.reason
            : GENERIC_MUNICIPALITY_FAILURE,
      );
    });
  }, [overlay, deactivating, apply]);

  // The Import / Export state and its whole flow, owned by the hook — this
  // screen supplies the registry and its live rows, and holds nothing. The
  // sheet it opens is the same component the Terminal screen opens.
  const transfer = useConfigTransfer({
    registry: BARANGAY_REGISTRY,
    municipalities: municipalities ?? [],
    stops: barangays ?? [],
  });

  /** One tap puts every hidden row back: query, scope and status at once. */
  const clearEmpty = useCallback(
    (action: LocationEmptyAction) => {
      if (action === 'clearQuery') {
        apply(onBarangays ? { barangaySearchQuery: '' } : { municipalitySearchQuery: '' });
        return;
      }
      apply({
        barangaySearchQuery: '',
        municipalitySearchQuery: '',
        selectedMunicipalityId: null,
        statusFilter: 'ALL',
      });
    },
    [apply, onBarangays],
  );

  const body = (() => {
    if (isLoading) return <LoadingState />;
    if (loadError !== null) {
      return (
        <GlassCard
          tint={tintedGlass.error}
          cornerRadius={radius.xlarge}
          style={styles.stateError}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.stateErrorTitle} accessibilityRole="header">
            Location configuration unavailable
          </Text>
          <Text style={styles.stateErrorBody}>{loadError}</Text>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back to settings"
            style={({ pressed }) => [styles.stateGoBack, pressed && styles.pressed]}
          >
            <Text style={styles.stateGoBackLabel}>GO BACK</Text>
          </Pressable>
        </GlassCard>
      );
    }

    const shown = rows.length;
    const total = onBarangays ? view.totalBarangays : view.totalMunicipalities;

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'android' ? undefined : 'padding'}
        style={styles.flex}
        pointerEvents="box-none"
      >
        <FlatList
          data={rows}
          keyExtractor={(item) =>
            String(item.kind === 'barangay' ? item.barangay.id : item.municipality.id)
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {/* One card, not four controls: the tabs, the search and the
                  scope are the controls that jointly define the list, so they
                  share the Dashboard's glass range-card — and the sentence
                  that qualifies them sits directly beneath it, where the
                  family puts every other caption. */}
              <GlassCard style={styles.controlCard}>
                <GlassCard
                  cornerRadius={radius.full}
                  style={styles.segments}
                  accessibilityRole="tablist"
                  accessibilityLabel="Location type"
                >
                  {TABS.map((tab) => {
                    const selected = tab.key === state.selectedTab;
                    const count =
                      tab.key === 'BARANGAYS' ? view.totalBarangays : view.totalMunicipalities;
                    return (
                      <Pressable
                        key={tab.key}
                        // A tab row, not a pager: no swipe, no hidden gesture.
                        onPress={() => apply({ selectedTab: tab.key, message: null })}
                        accessibilityRole="tab"
                        accessibilityLabel={`${tab.label} ${count}`}
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [
                          styles.segment,
                          selected && styles.segmentSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.segmentLabel,
                            selected && styles.segmentLabelSelected,
                          ]}
                        >
                          {tab.label}
                        </Text>
                        <Text
                          style={[
                            styles.segmentCount,
                            selected && styles.segmentCountSelected,
                          ]}
                        >
                          {count}
                        </Text>
                      </Pressable>
                    );
                  })}
                </GlassCard>

                <View style={styles.fields}>
                  {/* Search: add-trip's `.field`, minus the trailing control. */}
                  <GlassCard cornerRadius={radius.large} style={styles.field}>
                    <View style={styles.fieldIcon}>
                      <Icon name="search" size={18} color={theme.accent.tertiary.onContainer} />
                    </View>
                    <TextInput
                      value={query}
                      onChangeText={(text) =>
                        apply(
                          onBarangays
                            ? { barangaySearchQuery: text }
                            : { municipalitySearchQuery: text },
                        )
                      }
                      placeholder={onBarangays ? 'Search barangays' : 'Search municipalities'}
                      placeholderTextColor={theme.palette.outline}
                      accessibilityLabel={onBarangays ? 'Search barangays' : 'Search municipalities'}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      style={styles.fieldInput}
                    />
                  </GlassCard>

                  {/* The scope is the only control that appears and disappears
                      with the tab: a municipality cannot be scoped to a
                      municipality. */}
                  {onBarangays ? (
                    <Pressable
                      onPress={() => setOverlay({ kind: 'scope' })}
                      accessibilityRole="button"
                      accessibilityLabel={scopeTriggerAnnouncement(scopeApplied)}
                      accessibilityState={{ expanded: overlay?.kind === 'scope' }}
                      style={({ pressed }) => [
                        styles.field,
                        styles.fieldScope,
                        pressed && styles.pressed,
                      ]}
                    >
                      <GlassCard
                        cornerRadius={radius.large}
                        style={StyleSheet.absoluteFill}
                        pointerEvents="none"
                      />
                      <View style={styles.fieldIcon}>
                        <Icon name="pin" size={18} color={theme.accent.tertiary.onContainer} />
                      </View>
                      <View style={styles.fieldBody}>
                        <Text style={styles.fieldLabel}>Municipality</Text>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.fieldValue,
                            state.selectedMunicipalityId === null && styles.fieldValueEmpty,
                          ]}
                        >
                          {scopeApplied}
                        </Text>
                      </View>
                      <Icon name="chevronDown" size={18} color={theme.palette.onSurfaceVariant} />
                    </Pressable>
                  ) : null}
                </View>
              </GlassCard>

              {/* The status caption IS the filter: not a chip that hides its
                  value behind an icon, but a sentence that states what is
                  applied — on both tabs, because it narrows both lists. */}
              <View style={styles.caption}>
                <View
                  style={[
                    styles.captionDot,
                    {
                      backgroundColor:
                        state.statusFilter === 'ALL' ? theme.palette.outline : theme.palette.primary,
                    },
                  ]}
                />
                <Text style={styles.captionText} accessibilityLiveRegion="polite">
                  Status filter:{' '}
                  <Text style={styles.captionValue}>{state.statusFilter}</Text>, applied to both
                  lists.
                </Text>
                <Pressable
                  onPress={() => setOverlay({ kind: 'status' })}
                  accessibilityRole="button"
                  accessibilityLabel={`Status filter is ${state.statusFilter}. Change it.`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
                >
                  {({ pressed }) => (
                    // Hover underlines the label and changes nothing else, so
                    // the resting contrast is also the pressed contrast.
                    <Text
                      style={[
                        styles.textActionLabel,
                        pressed && styles.textActionLabelPressed,
                      ]}
                    >
                      Change
                    </Text>
                  )}
                </Pressable>
              </View>

              {/* Transient message. One at a time, never a persistent banner. */}
              {state.message !== null ? (
                <GlassCard
                  cornerRadius={radius.large}
                  style={styles.caution}
                  accessibilityLiveRegion="polite"
                >
                  <Text style={styles.cautionText}>{state.message}</Text>
                  <Pressable
                    onPress={() => apply({ message: null })}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss message"
                    hitSlop={8}
                    style={({ pressed }) => [styles.cautionClose, pressed && styles.pressed]}
                  >
                    <Icon name="close" size={18} color={theme.glass.onGlassVariant} />
                  </Pressable>
                </GlassCard>
              ) : null}

              {/* Section head: the label, then the screen's ONE solid pill —
                  count and action are one control, as the reference composes
                  them: "3 of 20 | ADD BARANGAY +", the count carrying the
                  same on-primary ink as the action it belongs to. */}
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel} accessibilityRole="header">
                  {state.selectedTab}
                </Text>
                <View style={styles.sectionEnd}>
                  <Pressable
                    onPress={() =>
                      onBarangays ? onOpenBarangayEditor(null) : onOpenMunicipalityEditor(null)
                    }
                    accessibilityRole="button"
                    accessibilityLiveRegion="polite"
                    accessibilityLabel={`${locationCountAnnouncement(
                      shown,
                      total,
                      onBarangays ? 'barangay' : 'municipality',
                    )}. ${onBarangays ? 'Add Barangay' : 'Add Municipality'}`}
                    style={({ pressed }) => [styles.addPill, pressed && styles.pressed]}
                  >
                    <Text style={styles.addPillCount}>
                      <Text style={styles.addPillCountStrong}>{shown}</Text>
                      {shown === total ? '' : ` of ${total}`}
                    </Text>
                    <View style={styles.addPillDiv} />
                    <Text style={styles.addPillLabel}>
                      {onBarangays ? 'ADD BARANGAY' : 'ADD MUNICIPALITY'}
                    </Text>
                    <Icon name="plus" size={14} color={onPrimarySolid} />
                  </Pressable>
                </View>
              </View>
            </>
          }
          renderItem={({ item }) => {
            // ONE shape of record, so one formatter: title, value, state,
            // announcement — assembled twice, rendered once.
            if (item.kind === 'barangay') {
              const value = barangayRowValue(item.barangay, linkedNameOf(item.barangay), fmtKm);
              return (
                <RecordRow
                  title={item.barangay.barangayName}
                  value={value}
                  active={item.barangay.isActive}
                  unlinked={item.barangay.municipalityId === null}
                  label={recordAnnouncement(item.barangay.barangayName, value, item.barangay.isActive)}
                  onPress={() => openRecord('barangay', item.barangay.id)}
                />
              );
            }
            const value = municipalityRowValue(item.municipality, item.barangayCount);
            const active = item.municipality.is_active === 1;
            return (
              <RecordRow
                title={item.municipality.name}
                value={value}
                active={active}
                unlinked={false}
                label={recordAnnouncement(item.municipality.name, value, active)}
                onPress={() => openRecord('municipality', item.municipality.id)}
              />
            );
          }}
          ListEmptyComponent={
            <InlineEmpty
              title={empty.title}
              body={empty.body}
              action={empty.action}
              actionLabel={empty.actionLabel}
              onAction={clearEmpty}
            />
          }
          ListFooterComponent={
            <>
              <Text style={styles.secNote}>
                {onBarangays
                  ? 'Used when creating passenger tickets.'
                  : 'Barangays are assigned to a municipality here.'}
              </Text>
              {/* The one Import / Export entry point, above the storage card it
                  acts on. A barangay file carries the municipalities too, so it
                  is reachable from either tab and neither tab is a dead end. */}
              <TransferTrigger
                label={transfer.triggerLabel}
                testID="bc-transfer"
                onPress={() => setOverlay({ kind: 'transfer' })}
              />
              <GlassCard
                style={styles.noteLock}
                accessible
                accessibilityLabel={`Offline storage. ${
                  onBarangays
                    ? 'All barangays are saved locally and work offline.'
                    : 'All location configurations are saved locally and work offline.'
                }`}
              >
                <Icon name="lock" size={18} color={theme.glass.onGlassVariant} />
                <View style={styles.noteLockBody}>
                  <Text style={styles.noteLockLabel}>OFFLINE STORAGE</Text>
                  <Text style={styles.noteLockText}>
                    {onBarangays
                      ? 'All barangays are saved locally and work offline.'
                      : 'All location configurations are saved locally and work offline.'}
                  </Text>
                </View>
              </GlassCard>
            </>
          }
          contentContainerStyle={[
            styles.column,
            { paddingBottom: insets.bottom + space(9) },
          ]}
        />
      </KeyboardAvoidingView>
    );
  })();

  return (
    <View style={styles.screen}>
      {/* The field the glass sits over: the same two washes every glass screen
          paints, so this screen and the Dashboard refract one backdrop. */}
      <GlassBackdrop />
      <SectionChrome
        title="Barangay Configuration"
        // Sentence case on purpose — unlike the terminal and fare screens.
        titleMinHeight={56}
        subtitle={chromeSubtitle}
        onBack={onBack}
        insets={insets}
        backLabel="Back to settings"
        testID="bc-chrome"
        backTestID="bc-back"
      >
        {body}
      </SectionChrome>

      {overlay?.kind === 'status' ? (
        <Sheet
          kind="status"
          title="Status filter"
          subtitle="Applies to both lists"
          onClose={closeOverlay}
          closeTestID="bc-sheet-close"
        >
          <View style={styles.pickList}>
            {STATUS_FILTERS.map((option) => (
              <PickOption
                key={option}
                label={option}
                current={state.statusFilter === option}
                testID={`bc-status-${option}`}
                onPress={() => {
                  apply({ statusFilter: option });
                  closeOverlay();
                }}
              />
            ))}
          </View>
        </Sheet>
      ) : overlay?.kind === 'scope' ? (
        <Sheet
          kind="scope"
          title="Municipality scope"
          subtitle="Narrows the barangay list"
          onClose={closeOverlay}
          closeTestID="bc-sheet-close"
        >
          <View style={styles.pickList}>
            {scopeItems.map((option) => (
              <PickOption
                key={option.label}
                label={option.label}
                current={scopeOptionSelected(option, state.selectedMunicipalityId)}
                testID={`bc-scope-${option.id === null ? 'all' : option.id}`}
                onPress={() => {
                  apply({ selectedMunicipalityId: option.id });
                  closeOverlay();
                }}
              />
            ))}
          </View>
        </Sheet>
      ) : overlay?.kind === 'record' && target ? (
        <RecordSheet
          row={target}
          linkedNameOf={(row) =>
            row.kind === 'barangay' ? linkedNameOf(row.barangay) : null
          }
          activeCount={
            target.kind === 'municipality'
              ? (view.activeBarangayCountByMunicipality[target.municipality.id] ?? 0)
              : 0
          }
          onClose={closeOverlay}
          onEdit={() => {
            closeOverlay();
            if (target.kind === 'barangay') onOpenBarangayEditor(target.barangay.id);
            else onOpenMunicipalityEditor(target.municipality.id);
          }}
          onDeactivate={() => {
            // aria-disabled, not a hidden button: an already-inactive record
            // stays on screen and keeps reading DEACTIVATE, and the guard is
            // what makes the state mean something.
            const active =
              target.kind === 'barangay'
                ? target.barangay.isActive
                : target.municipality.is_active === 1;
            if (!active) return;
            setOverlay({ kind: 'confirm', rowKind: target.kind, id: rowIdOf(target) });
          }}
        />
      ) : overlay?.kind === 'confirm' && target ? (
        <ConfirmSheet
          row={target}
          linkedName={
            target.kind === 'barangay' ? linkedNameOf(target.barangay) : null
          }
          busy={deactivating}
          onClose={closeOverlay}
          onConfirm={confirmDeactivate}
        />
      ) : overlay?.kind === 'transfer' ? (
        <ConfigTransferSheet {...transfer.sheetProps} onClose={closeOverlay} />
      ) : null}
    </View>
  );
}

/** The record id, whichever of the two shapes is open. */
function rowIdOf(row: ListRow): number {
  return row.kind === 'barangay' ? row.barangay.id : row.municipality.id;
}

/**
 * ONE shape of record, for both collections: title, value, status pill,
 * chevron. No chip — the list is scoped to one collection, so a per-module
 * glyph would repeat the section label twenty times — and no inline actions,
 * because the row opens a sheet and the sheet is where they live.
 */
function RecordRow({
  title,
  value,
  active,
  unlinked,
  label,
  onPress,
}: {
  title: string;
  value: string;
  active: boolean;
  /** No municipality link: an error-tinted row that says so in words. */
  unlinked: boolean;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <GlassCard
      onPress={onPress}
      cornerRadius={radius.glass}
      // A data fault is a red GLASS card, not a flat panel: the same
      // material as every other row, carrying the error pigment.
      tint={unlinked ? tintedGlass.error : undefined}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, unlinked && styles.rowTitleUnlinked]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[styles.rowValue, unlinked && styles.rowValueUnlinked]}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>

      <View style={styles.rowEnd}>
        {/* Visual-only: the merged announcement states the state once, and a
            pill that repeats it reads "Active" twice. */}
        <View
          style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text
            style={[styles.pillLabel, active ? styles.pillLabelActive : styles.pillLabelInactive]}
          >
            {active ? 'ACTIVE' : 'INACTIVE'}
          </Text>
        </View>
        <Icon
          name="chevron"
          size={18}
          color={unlinked ? '#FFFFFF' : theme.palette.onSurfaceVariant}
        />
      </View>
    </GlassCard>
  );
}

/** The `.inline-empty` block: three causes, three sentences, one way out. */
function InlineEmpty({
  title,
  body,
  action,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  /** Which control brings the rows back; null on an empty registry. */
  action: LocationEmptyAction | null;
  actionLabel: string | null;
  onAction: (action: LocationEmptyAction) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <GlassCard
      cornerRadius={radius.xlarge}
      style={styles.inlineEmpty}
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.inlineEmptyTitle}>{title}</Text>
      <Text style={styles.inlineEmptyBody}>{body}</Text>
      {action !== null && actionLabel !== null ? (
        <View style={styles.cardActions}>
          <Pressable
            onPress={() => onAction(action)}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
          >
            {/* The empty state's way out is a glass pill like every other
                control on this screen, not an outline on theme.glass. */}
            <GlassCard
              cornerRadius={radius.large}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Text style={styles.ghostBtnLabel}>{actionLabel}</Text>
          </Pressable>
        </View>
      ) : null}
    </GlassCard>
  );
}

/**
 * One option in a filter sheet. The applied one is tinted AND says
 * "Currently applied" AND carries `selected` — selection is never colour
 * alone.
 */
function PickOption({
  label,
  current,
  onPress,
  testID,
}: {
  label: string;
  current: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <GlassCard
      onPress={onPress}
      testID={testID}
      cornerRadius={radius.large}
      style={styles.pickRow}
      // The applied option is the ACTIVE button, so it is the orange glass
      // pill — same material and same pigment as the tab pills and add pill.
      tint={current ? tintedGlass.accent : undefined}
      accessibilityRole="button"
      accessibilityLabel={current ? `${label}, currently applied` : label}
      accessibilityState={{ selected: current }}
    >
      <View style={styles.pickBody}>
        <Text style={[styles.pickName, current && styles.pickNameCurrent]}>{label}</Text>
        {current ? (
          <Text style={[styles.pickSub, current && styles.pickSubCurrent]}>
            Currently applied
          </Text>
        ) : null}
      </View>
      <Icon
        name="check"
        size={18}
        color={current ? onPrimarySolid : theme.palette.onSurfaceVariant}
      />
    </GlassCard>
  );
}

/**
 * The detail sheet, where the row's two actions moved: the stored values the
 * row reads, the line that says nothing is written from here, and EDIT /
 * DEACTIVATE in the sheet's action row.
 */
function RecordSheet({
  row,
  linkedNameOf,
  activeCount,
  onClose,
  onEdit,
  onDeactivate,
}: {
  row: ListRow;
  /** The LINKED municipality's name for a barangay; null when unlinked. */
  linkedNameOf: (row: ListRow) => string | null;
  /** Active barangays of a municipality, folded from the same registry. */
  activeCount: number;
  onClose: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const isBarangay = row.kind === 'barangay';
  const title = isBarangay ? row.barangay.barangayName : row.municipality.name;
  const active = isBarangay ? row.barangay.isActive : row.municipality.is_active === 1;
  const linkedName = linkedNameOf(row);
  const pairs: DetailPair[] = isBarangay
    ? barangayDetailPairs(row.barangay, linkedName, fmtKm)
    : municipalityDetailPairs(row.municipality, row.barangayCount, activeCount);
  const subtitle = isBarangay
    ? barangayDetailSubtitle(row.barangay, linkedName)
    : row.municipality.province;

  return (
    <Sheet
      kind="record"
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      closeTestID="bc-sheet-close"
      footer={
        <View style={styles.sheetActions}>
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${title}`}
            style={({ pressed }) => [styles.sheetGhost, pressed && styles.pressed]}
          >
            <GlassCard
              cornerRadius={radius.large}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Text style={styles.sheetGhostLabel}>EDIT</Text>
          </Pressable>
          <Pressable
            onPress={onDeactivate}
            accessibilityRole="button"
            accessibilityLabel={`Deactivate ${title}`}
            accessibilityState={{ disabled: !active }}
            style={({ pressed }) => [
              styles.sheetDestructive,
              !active && styles.sheetDestructiveOff,
              pressed && active && styles.pressed,
            ]}
          >
            {/* The irreversible write is red glass — the error pigment under
                this app's own material, not a flat error swatch. */}
            {active ? (
              <GlassCard
                tint={tintedGlass.error}
                cornerRadius={radius.large}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
            ) : null}
            <Text
              style={[
                styles.sheetDestructiveLabel,
                !active && styles.sheetDestructiveLabelOff,
              ]}
            >
              DEACTIVATE
            </Text>
          </Pressable>
        </View>
      }
    >
      <DetailCard>
        {pairs.map((pair) => (
          <DetailRow
            key={pair.label}
            label={pair.label}
            value={pair.value}
            tabular={pair.label !== 'Municipality' && pair.label !== 'Province'}
          />
        ))}
      </DetailCard>
      <Text style={styles.sheetNote}>
        The stored values this record reads. Nothing is written from this sheet.
      </Text>
    </Sheet>
  );
}

/**
 * The confirmation. It names the row and both consequences, and its fill is
 * the primary treatment — a deactivation is a routine one-way flag, not an
 * error, and a red confirm teaches the wrong reflex for the one irreversible
 * write on the screen.
 */
function ConfirmSheet({
  row,
  linkedName,
  busy,
  onClose,
  onConfirm,
}: {
  row: ListRow;
  /** The LINKED municipality's name, so the confirmation names the same
   *  municipality the row's own caption prints. */
  linkedName: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const isBarangay = row.kind === 'barangay';
  const title = isBarangay ? 'Deactivate Barangay?' : 'Deactivate Municipality?';
  const body = isBarangay
    ? `${barangayDetailSubtitle(row.barangay, linkedName)} will no longer appear when creating new passenger tickets. Existing ticket history will not be affected.`
    : `${row.municipality.name} will be deactivated if it has no active barangays.`;

  return (
    <Sheet
      kind="confirm"
      title={title}
      onClose={onClose}
      closeTestID="bc-sheet-close"
      footer={
        <View style={styles.sheetActions}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel, keep the record active"
            style={({ pressed }) => [styles.sheetGhost, pressed && styles.pressed]}
          >
            <GlassCard
              cornerRadius={radius.large}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Text style={styles.sheetGhostLabel}>CANCEL</Text>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Confirm: deactivate ${
              isBarangay ? row.barangay.barangayName : row.municipality.name
            }`}
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [
              styles.sheetPrimary,
              busy && styles.sheetPrimaryBusy,
              pressed && !busy && styles.pressed,
            ]}
          >
            <Text style={styles.sheetPrimaryLabel}>
              {busy ? 'Deactivating…' : 'DEACTIVATE'}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Text style={styles.sheetBodyText}>{body}</Text>
    </Sheet>
  );
}

/**
 * Loading: the shell's skeleton, not a spinner. The shape of the list is
 * already known, so the screen shows it — and the chrome still states what is
 * being read.
 */
function LoadingState() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.stateBlock}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel="Loading locations"
    >
      {[0, 1, 2, 3].map((index) => (
        <GlassCard key={index} cornerRadius={radius.xlarge} style={styles.skRow}>
          <View style={styles.skBlock} />
          <View style={styles.skLines}>
            <View style={[styles.skLine, { width: '62%' }]} />
            <View style={[styles.skLineThin, { width: '38%' }]} />
          </View>
        </GlassCard>
      ))}
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.88 },
  screen: { flex: 1, backgroundColor: theme.glass.backdrop },

  // ONE column, ONE gutter — the same inset the chrome above it uses.
  column: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: space(5),
    paddingTop: space(5),
  },

  // ── the control card ──
  // Every surface on this screen is a GlassCard; these styles are geometry
  // only. The tab track, the search box and the scope trigger are glass
  // cards nested in the control card, so they drop their own fill and lip
  // and let the component paint them.
  controlCard: { marginTop: space(5), padding: 14 },
  segments: {
    flexDirection: 'row',
    gap: space(1),
    padding: space(1),
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    borderRadius: radius.full,
  },
  segmentSelected: { backgroundColor: theme.palette.primarySolid },
  segmentLabel: { ...type.labelLarge, color: theme.palette.onSurfaceVariant },
  segmentLabelSelected: { fontFamily: 'Poppins_700Bold', color: onPrimarySolid },
  segmentCount: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    opacity: 0.72,
    fontVariant: ['tabular-nums'],
  },
  segmentCountSelected: { color: onPrimarySolid },

  fields: { marginTop: space(3), gap: space(3) },
  field: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    paddingHorizontal: 14,
    // The scope trigger is a Pressable whose fill is a GlassCard child, so it
    // needs the overflow the card clips against, or the child spills a corner.
    overflow: 'hidden',
    borderRadius: radius.large,
  },
  // The scope is a two-line control — label over value — so it runs six px
  // taller than the search above it, exactly as the reference measures them.
  fieldScope: { minHeight: 68 },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent.tertiary.container,
  },
  fieldBody: { flex: 1, minWidth: 0 },
  fieldLabel: { ...type.bodySmall, color: theme.palette.onSurfaceVariant },
  fieldValue: { ...type.bodyMedium, fontFamily: 'Poppins_600SemiBold', color: theme.palette.onSurface },
  // "All Municipalities" reads as the absence of a choice, not a chosen value.
  fieldValueEmpty: {
    fontFamily: 'Poppins_400Regular',
    fontWeight: '500',
    color: theme.palette.onSurfaceVariant,
  },
  fieldInput: { flex: 1, minWidth: 0, padding: 0, ...type.bodyMedium, color: theme.palette.onSurface },

  // ── the status caption: the filter, in words ──
  //
  // Centred, and set at the caption's own 12px throughout. It is a status
  // sentence, not an action bar: the "Change" label used to be `labelLarge`
  // (15px), which made the action louder than the sentence it qualified and
  // left the row reading as a left-aligned toolbar.
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    marginTop: space(2.5),
  },
  // The one off-grid mark on this screen: a fixed 5×5 dot. flexShrink only —
  // RN's `flex: 0` compiles to the CSS shorthand `0 1 0%` on web, which
  // collapses the box to zero and lets its children spill past the column.
  captionDot: { width: 5, height: 5, borderRadius: 2, flexShrink: 0 },
  // Sized to the sentence, so Change sits right after it — the prototype's
  // inline flow — and shrinks (wrapping the sentence) before it can overflow.
  captionText: { ...type.bodySmall, color: theme.glass.onGlassVariant, flexShrink: 1 },
  captionValue: { fontFamily: 'Poppins_700Bold' },
  textAction: {
    minHeight: 48,
    paddingHorizontal: space(1),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    flexShrink: 0,
  },
  // 600 at the caption's size, not `labelLarge`: still unmistakably a control
  // (weight + accent ink), no longer a different size from the sentence beside
  // it. The Pressable keeps its 48px minHeight, so the touch target never
  // shrinks with the label.
  textActionLabel: {
    ...type.bodySmall,
    fontFamily: 'Poppins_600SemiBold',
    color: theme.glass.accentPrimary,
  },
  textActionLabelPressed: { textDecorationLine: 'underline' },

  // ── the transient message ──
  caution: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    marginTop: space(4),
    paddingVertical: space(3),
    paddingHorizontal: space(4),
  },
  cautionText: { ...type.bodySmall, color: theme.glass.onGlassVariant, flex: 1 },
  cautionClose: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // ── section head ──
  // flex-wrap is the safety rail for the widest pair on the screen —
  // "MUNICIPALITIES" plus "19 of 19 | ADD MUNICIPALITY +" exceeds the
  // column, and the reference drops the pill to its own line, right-aligned,
  // where nothing clips. margin-left:auto keeps it right when wrapped.
  sectionHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(2),
    marginTop: space(5),
    marginBottom: space(3),
  },
  sectionLabel: { ...type.labelSmall, color: theme.glass.onGlassVariant },
  sectionEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    flexShrink: 0,
    marginLeft: 'auto',
  },
  // The screen's ONE solid fill: a compact pill that carries the count
  // itself — "3 of 20 | ADD BARANGAY +" — one control, not two neighbours
  // negotiating for the same row. tabular-nums stops the pill reflowing as
  // filters change the digit count; the bold half is the shown count, the
  // "of 20" half stays regular white because it is still text.
  addPill: {
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    borderRadius: radius.full,
    backgroundColor: theme.palette.primarySolid,
  },
  addPillCount: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
    color: onPrimarySolid,
    fontVariant: ['tabular-nums'],
  },
  addPillCountStrong: { fontFamily: 'Poppins_700Bold' },
  // The "|" in "3 of 20 | ADD BARANGAY" — ornament inside the pill's own
  // palette, currentColor at a whisper of opacity.
  addPillDiv: {
    width: 1,
    height: 14,
    backgroundColor: onPrimarySolid,
    opacity: 0.45,
  },
  addPillLabel: { ...type.labelSmall, color: onPrimarySolid },

  // ── the record row: Settings' card, minus its chip ──
  // A GlassCard: the unlinked fault is the red glass variant (see the `tint`
  // prop in `RecordRow`), never a flat error panel.
  row: {
    minHeight: 90,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(5),
    marginBottom: space(3),
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...type.titleMedium, color: theme.palette.onSurface },
  rowValue: { ...type.bodyMedium, color: theme.palette.onSurfaceVariant, marginTop: 2 },
  // On the red glass row the neutral ink goes dark-on-red; white clears
  // 6.5:1 on `tintedGlass.error` and reads as the fault.
  rowTitleUnlinked: { color: '#FFFFFF' },
  rowValueUnlinked: {
    fontFamily: 'Poppins_600SemiBold',
    color: '#FFFFFF',
  },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: space(2), flexShrink: 0 },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full },
  pillActive: { backgroundColor: theme.accent.tertiary.container },
  pillInactive: { backgroundColor: theme.palette.surfaceContainer },
  pillLabel: { ...type.labelSmall },
  pillLabelActive: { color: theme.accent.tertiary.onContainer },
  pillLabelInactive: { color: theme.glass.onGlassVariant },

  // ── the empty state ──
  inlineEmpty: {
    paddingVertical: space(4),
    paddingHorizontal: 18,
  },
  inlineEmptyTitle: { ...type.labelSmall, color: theme.glass.onGlass },
  inlineEmptyBody: { ...type.bodySmall, color: theme.glass.onGlassVariant, marginTop: space(2) },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(4) },
  ghostBtn: {
    minHeight: 48,
    paddingHorizontal: space(4),
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: radius.large,
  },
  ghostBtnLabel: { ...type.labelLarge, color: theme.glass.onGlassVariant },

  // ── the section note and the offline statement ──
  secNote: { ...type.bodySmall, color: theme.glass.onGlassVariant, marginTop: space(3) },
  noteLock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    marginTop: space(5),
    paddingVertical: space(4),
    paddingHorizontal: space(5),
  },
  noteLockBody: { flex: 1 },
  noteLockLabel: { ...type.labelSmall, color: theme.glass.onGlassVariant },
  noteLockText: { ...type.bodySmall, color: theme.glass.onGlassVariant, marginTop: space(1) },

  // ── sheets: options and actions ──
  pickList: { marginTop: space(2), gap: space(2) },
  // A GlassCard, geometry only: the applied option's orange glass comes from
  // the `tint` prop in `PickOption`, and the 2px border is gone with the
  // fill, so choosing a row no longer resizes the list under the finger.
  pickRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    paddingHorizontal: space(3),
  },
  pickBody: { flex: 1, minWidth: 0 },
  pickName: { ...type.bodyMedium, color: theme.palette.onSurface },
  pickNameCurrent: { color: onPrimarySolid },
  pickSub: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: 2 },
  pickSubCurrent: { color: onPrimarySolid, opacity: 0.85 },

  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: space(3),
    marginTop: space(4),
  },
  sheetGhost: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space(3),
    overflow: 'hidden',
    borderRadius: radius.large,
  },
  sheetGhostLabel: { ...type.labelLarge, color: theme.palette.onSurfaceVariant },
  // The irreversible write, red GLASS: the error pigment is carried by a
  // tinted GlassCard child, so this style is geometry only. It is greyed,
  // never hidden, on a record that has nothing left to deactivate.
  sheetDestructive: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(5),
    overflow: 'hidden',
    borderRadius: radius.large,
  },
  sheetDestructiveOff: { backgroundColor: theme.palette.surfaceContainer },
  sheetDestructiveLabel: { ...type.labelLarge, color: theme.palette.onError },
  sheetDestructiveLabelOff: { color: theme.palette.outline },
  sheetPrimary: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(5),
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  sheetPrimaryBusy: { opacity: 0.65 },
  sheetPrimaryLabel: { ...type.labelLarge, color: onPrimarySolid },
  sheetNote: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginTop: space(3),
  },
  sheetBodyText: { ...type.bodyMedium, color: theme.palette.onSurfaceVariant },

  // ── loading and error: they replace the whole screen ──
  stateBlock: {
    marginTop: space(5),
    marginHorizontal: space(5),
    gap: space(3),
  },
  skRow: {
    minHeight: 90,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(5),
  },
  skBlock: {
    width: 48,
    height: 48,
    borderRadius: radius.medium,
    backgroundColor: theme.palette.surfaceContainerHigh,
  },
  skLines: { flex: 1, minWidth: 0 },
  skLine: { height: 14, borderRadius: radius.small, backgroundColor: theme.palette.surfaceContainerHigh },
  skLineThin: {
    height: 12,
    marginTop: space(2),
    borderRadius: radius.small,
    backgroundColor: theme.palette.surfaceContainerHigh,
  },
  stateError: {
    marginTop: space(5),
    marginHorizontal: space(5),
    padding: space(5),
    gap: space(2),
  },
  // The screen's one hard failure, and it is red glass: white on the error
  // pigment clears 6.5:1, where the pale errorContainer ink would go
  // pink-on-red.
  stateErrorTitle: { ...type.titleMedium, color: '#FFFFFF' },
  stateErrorBody: { ...type.bodyMedium, color: '#FFFFFF', opacity: 0.92 },
  stateGoBack: {
    alignSelf: 'flex-start',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space(3),
    paddingHorizontal: space(6),
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  stateGoBackLabel: { ...type.labelLarge, color: onPrimarySolid, letterSpacing: 0.8 },
});
