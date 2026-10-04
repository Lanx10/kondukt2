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
  deactivateTerminal,
  fetchAllMunicipalities,
  fetchAllTerminals,
  subscribeToTrips,
  type DeactivateResult,
} from '../data/tripTicketsStore';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import { locationCountAnnouncement } from '../lib/barangayConfigState';
import { takeScreenFlash } from '../lib/screenFlash';
import { useConfigTransfer } from '../lib/useConfigTransfer';
import { TERMINAL_REGISTRY } from '../lib/transferRegistry';
import {
  deriveTerminalView,
  TERMINAL_FILTERS,
  terminalCardAnnouncement,
  terminalChromeSubtitle,
  terminalDetailPairs,
  terminalEmptyState,
  terminalNameOf,
  terminalRowValue,
  terminalSheetSubtitle,
  type TerminalFilter,
} from '../lib/terminalConfigState';

export type TerminalConfigScreenProps = {
  onBack: () => void;
  /**
   * Editor in create mode (no id) or edit mode (terminal id). The ADD pill
   * passes null; the record sheet's EDIT action passes the row's id.
   */
  onOpenEditor: (terminalId: number | null) => void;
};

/** The sheet the screen has open. One at a time — a sheet that replaces a sheet. */
type Overlay =
  | { kind: 'status' }
  | { kind: 'record'; id: number }
  | { kind: 'confirm'; id: number }
  | { kind: 'transfer' };

/**
 * The Terminal Configuration screen — terminal-config.html made real.
 *
 * The row answers the question the shipped card could not: which stops exist,
 * where they sit on the route, and which municipality each belongs to. The
 * municipality is a JOIN on `municipality_id`, printed on the row and
 * searchable from the same box — never a scope, never a tab, never a parse of
 * the composed name. A link that resolves to nothing still draws, captioned
 * `Not linked`: a fact to be shown, not an error to report. The one error
 * channel is a load failure, and it owns the body.
 *
 * One write: the row opens a sheet, the sheet holds EDIT and DEACTIVATE, and
 * DEACTIVATE asks first behind a confirmation that is deliberately not
 * error-tinted — nothing is deleted, only deactivated. The list follows the
 * store's result; no optimistic flip, no refetch on focus: `subscribeToTrips`
 * repaints it.
 *
 * The Add pill lives in the section head and always carries the count it
 * shows — "3 of 5 | ADD TERMINAL +" — because the count and the commit are
 * one control, not two neighbours negotiating for the same row. It is never
 * withheld: a narrowed view still answers how much of the collection it is
 * looking at, and the genuinely-empty registry finds the pill already on
 * screen instead of a second Add inside the empty block.
 */
export function TerminalConfigScreen({ onBack, onOpenEditor }: TerminalConfigScreenProps) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  // Local state: query, filter, overlay, transient message — all reset on
  // unmount, so re-entering shows every terminal, no query, ALL. The records
  // are never copied: the store is the only copy.
  const [terminals, setTerminals] = useState<TerminalRowRecord[] | null>(null);
  const [municipalities, setMunicipalities] = useState<MunicipalityRowRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<TerminalFilter>('ALL');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  // The editor's one announcement rides in on this first read, consumed once:
  // set just before navigating back, shown here, and the next mount finds
  // nothing to repeat — the prototype's takeFlash(), without its key.
  const [message, setMessage] = useState<string | null>(() => takeScreenFlash());

  // Two reads, one subscription. Returning from the editor repaints through
  // the store's change notification — no refetch on focus, no params
  // round-trip. The municipalities load in the same pass because the row's
  // caption is a join: the screen cannot print the link without them.
  useEffect(() => {
    let cancelled = false;
    const run = () =>
      // The TERMINAL half of the registry: the barangay list is the other
      // module's, and reading every stop here is what made the two
      // Configuration screens show the same rows. Municipalities load in the
      // same pass because the row's caption is a join.
      Promise.all([fetchAllTerminals('TERMINAL'), fetchAllMunicipalities()])
        .then(([terminalRows, municipalityRows]) => {
          if (cancelled) return;
          setTerminals(terminalRows);
          setMunicipalities(municipalityRows);
          setLoadError(null);
        })
        .catch(() => {
          if (cancelled) return;
          setLoadError('Unable to load terminals.');
        });
    run();
    const unsubscribe = subscribeToTrips(() => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const isLoading = (terminals === null || municipalities === null) && loadError === null;
  const hasQuery = searchQuery.trim() !== '';

  const view = useMemo(
    () => deriveTerminalView(terminals ?? [], searchQuery, filter, municipalities ?? []),
    [terminals, municipalities, searchQuery, filter],
  );

  const emptyState = useMemo(
    () => terminalEmptyState(hasQuery, filter),
    [hasQuery, filter],
  );

  // One sheet's record, re-read from the CURRENT rows every render: a write
  // replaces the list, and a row captured before it would be the old record.
  const target = useMemo(() => {
    if (overlay === null || overlay.kind === 'status' || overlay.kind === 'transfer') return null;
    return terminals?.find((row) => row.id === overlay.id) ?? null;
  }, [overlay, terminals]);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setDeactivating(false);
  }, []);

  /**
   * The sheet's one action. An active row asks first; an already-inactive
   * row keeps the button visible but greyed and answers with no write — the
   * state is shown on the control itself, never a dead-looking live fill.
   */
  const requestDeactivate = useCallback(() => {
    if (overlay === null || overlay.kind !== 'record' || target === null) return;
    if (target.is_active !== 1) return;
    setOverlay({ kind: 'confirm', id: target.id });
  }, [overlay, target]);

  const confirmDeactivate = useCallback(() => {
    if (overlay === null || overlay.kind !== 'confirm' || deactivating) return;
    setDeactivating(true);
    const { id } = overlay;
    void deactivateTerminal(id).then((result: DeactivateResult) => {
      setDeactivating(false);
      setOverlay(null);
      // Transient message either way; the list follows the store, never an
      // optimistic flip, and a failure never touches the load-error branch.
      setMessage(
        result === 'deactivated' ? 'Terminal deactivated.' : 'Unable to deactivate terminal.',
      );
    });
  }, [overlay, deactivating]);

  // The same hook, the same sheet and the same offline file path as the
  // Barangay screen — this screen supplies the registry and its live rows, and
  // holds no transfer state of its own.
  const transfer = useConfigTransfer({
    registry: TERMINAL_REGISTRY,
    municipalities: municipalities ?? [],
    stops: terminals ?? [],
  });

  /** One tap puts every hidden row back: query and filter at once. */
  const clearEmpty = useCallback((action: 'clearQuery' | 'clearFilter') => {
    if (action === 'clearQuery') {
      setSearchQuery('');
      return;
    }
    setSearchQuery('');
    setFilter('ALL');
  }, []);

  const chromeSubtitle = isLoading
    ? 'Loading terminals'
    : loadError !== null
      ? 'Terminal configuration unavailable'
      : terminalChromeSubtitle(view.total, view.active);

  const body = (() => {
    // Loading and the load failure both replace the WHOLE screen: on either
    // one, no list, no filter and no total mean anything.
    if (isLoading) return <LoadingState />;
    if (loadError !== null) {
      return (
        <GlassCard
          testID="tc-state"
          tint={tintedGlass.error}
          cornerRadius={radius.xlarge}
          style={styles.stateError}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.stateErrorTitle} accessibilityRole="header">
            Terminal configuration unavailable
          </Text>
          <Text style={styles.stateErrorBody}>{loadError}</Text>
          <Pressable
            onPress={onBack}
            testID="tc-goback"
            accessibilityRole="button"
            accessibilityLabel="Go back to settings"
            style={({ pressed }) => [styles.stateGoBack, pressed && styles.pressed]}
          >
            <Text style={styles.stateGoBackLabel}>GO BACK</Text>
          </Pressable>
        </GlassCard>
      );
    }

    const shown = view.rows.length;
    const total = view.total;

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'android' ? undefined : 'padding'}
        style={styles.flex}
        pointerEvents="box-none"
      >
        <FlatList
          testID="tc-list"
          accessibilityLiveRegion="polite"
          data={view.rows}
          keyExtractor={(terminal) => String(terminal.id)}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
          ListHeaderComponent={
            <>
            <View testID="tc-controls">
              {/* One card, one control: the shared 60px search field. */}
              <GlassCard style={styles.controlCard}>
                <GlassCard cornerRadius={radius.large} style={styles.field}>
                  <View style={styles.fieldIcon}>
                    <Icon name="search" size={18} color={theme.accent.tertiary.onContainer} />
                  </View>
                  <TextInput
                    testID="tc-q"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search terminals"
                    placeholderTextColor={theme.palette.outline}
                    accessibilityLabel="Search terminals"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.fieldInput}
                  />
                </GlassCard>
              </GlassCard>

              {/* The status caption IS the filter: it names the value already
                  applied, on this list, and tints its dot only when a filter
                  is on. */}
              <View style={styles.caption} testID="tc-statusline">
                <View
                  style={[
                    styles.captionDot,
                    {
                      backgroundColor: filter === 'ALL' ? theme.palette.outline : theme.palette.primary,
                    },
                  ]}
                />
                <Text style={styles.captionText} accessibilityLiveRegion="polite">
                  Status filter:{' '}
                  <Text style={styles.captionValue}>{filter}</Text>, applied to this list.
                </Text>
                <Pressable
                  onPress={() => setOverlay({ kind: 'status' })}
                  testID="tc-status"
                  accessibilityRole="button"
                  accessibilityLabel={`Status filter is ${filter}. Change it.`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
                >
                  {({ pressed }) => (
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
            </View>

            {/* One transient notice at a time — the write's answer, or the
                editor's flash, in the shell's inline notice. */}
            {message !== null ? (
              <GlassCard
                testID="tc-banner"
                style={styles.caution}
                accessibilityLiveRegion="polite"
              >
                <Text style={styles.cautionText}>{message}</Text>
                <Pressable
                  onPress={() => setMessage(null)}
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
                them: "3 of 5 | ADD TERMINAL +". */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel} accessibilityRole="header">
                TERMINALS
              </Text>
              <View style={styles.sectionEnd}>
                <Pressable
                  onPress={() => onOpenEditor(null)}
                  testID="tc-add"
                  accessibilityRole="button"
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={`${locationCountAnnouncement(
                    shown,
                    total,
                    'terminal',
                  )}. Add Terminal`}
                  style={({ pressed }) => [styles.addPill, pressed && styles.pressed]}
                >
                  <Text style={styles.addPillCount}>
                    <Text style={styles.addPillCountStrong}>{shown}</Text>
                    {shown === total ? '' : ` of ${total}`}
                  </Text>
                  <View style={styles.addPillDiv} />
                  <Text style={styles.addPillLabel}>ADD TERMINAL</Text>
                  <Icon name="plus" size={14} color={onPrimarySolid} />
                </Pressable>
              </View>
            </View>
            </>
          }
          ListEmptyComponent={
            <GlassCard
              testID="tc-empty"
              cornerRadius={radius.xlarge}
              style={styles.inlineEmpty}
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.inlineEmptyTitle}>{emptyState.title}</Text>
              <Text style={styles.inlineEmptyBody}>{emptyState.body}</Text>
              {emptyState.kind !== 'nothing' ? (
                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() =>
                      clearEmpty(emptyState.kind === 'search' ? 'clearQuery' : 'clearFilter')
                    }
                    testID={emptyState.kind === 'search' ? 'tc-clearq' : 'tc-clear'}
                    accessibilityRole="button"
                    accessibilityLabel={
                      emptyState.kind === 'search' ? 'Clear the search' : 'Clear the filter'
                    }
                    style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
                  >
                    {/* The way out is a glass pill like every other control on
                        this screen, not an outline on theme.glass. */}
                    <GlassCard
                      cornerRadius={radius.large}
                      style={StyleSheet.absoluteFill}
                      pointerEvents="none"
                    />
                    <Text style={styles.ghostBtnLabel}>
                      {emptyState.kind === 'search' ? 'Clear the search' : 'Clear the filter'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </GlassCard>
          }
          renderItem={({ item }) => (
            <TerminalRecordRow
              terminal={item}
              value={terminalRowValue(item, municipalities ?? [])}
              onPress={() => setOverlay({ kind: 'record', id: item.id })}
            />
          )}
          ListFooterComponent={
            <>
              <Text style={styles.secNote} testID="tc-secnote">
                Terminals mark where a trip starts and ends.
              </Text>
              {/* The one Import / Export entry point, above the storage card it
                  acts on — the same place and the same component as the
                  Barangay screen's, so the two registries read as one feature. */}
              <TransferTrigger
                label={transfer.triggerLabel}
                testID="tc-transfer"
                onPress={() => setOverlay({ kind: 'transfer' })}
              />
              {/* A surface like every other storage footer in the app, but
                  still not a control: no chevron, nothing to press. */}
              <GlassCard
                testID="tc-storage"
                style={styles.noteLock}
                accessible
                accessibilityLabel="Offline storage. All terminals are saved locally and work offline."
              >
                <Icon name="lock" size={18} color={theme.glass.onGlassVariant} />
                <View style={styles.noteLockBody}>
                  <Text style={styles.noteLockLabel}>OFFLINE STORAGE</Text>
                  <Text style={styles.noteLockText} testID="tc-offline">
                    All terminals are saved locally and work offline.
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
      <GlassBackdrop />
      <SectionChrome
        title="Terminal Configuration"
        titleMinHeight={56}
        subtitle={chromeSubtitle}
        subtitleTestID="tc-sub"
        onBack={onBack}
        insets={insets}
        backLabel="Back to settings"
        testID="tc-chrome"
        backTestID="tc-back"
      >
        {body}
      </SectionChrome>

      {overlay?.kind === 'status' ? (
        <Sheet
          kind="status"
          title="Status filter"
          subtitle="Applies to this list"
          onClose={closeOverlay}
          closeTestID="tc-sheet-close"
        >
          <View style={styles.pickList}>
            {TERMINAL_FILTERS.map((option) => (
              <PickOption
                key={option.value}
                label={option.label}
                current={filter === option.value}
                testID={`tc-status-${option.value}`}
                onPress={() => {
                  setFilter(option.value);
                  closeOverlay();
                }}
              />
            ))}
          </View>
        </Sheet>
      ) : overlay?.kind === 'record' && target ? (
        <RecordSheet
          terminal={target}
          allMunicipalities={municipalities ?? []}
          onEdit={() => onOpenEditor(target.id)}
          onDeactivate={requestDeactivate}
          onClose={closeOverlay}
        />
      ) : overlay?.kind === 'confirm' && target ? (
        <ConfirmSheet
          terminal={target}
          busy={deactivating}
          onClose={closeOverlay}
          onConfirm={confirmDeactivate}
        />
      ) : overlay?.kind === 'transfer' ? (
        <ConfigTransferSheet {...transfer.sheetProps} onClose={closeOverlay} />
      ) : null}
    </View>
  );
}/**
 * ONE shape of record: title (first comma is the boundary), the municipality
 * and marker, the pill, the chevron. The row is the tap target — it carries
 * no inline actions, and both lines clamp to one line so twenty rows land on
 * one height; the sheet carries the untruncated text. An unlinked row is a
 * normal row of this registry — the editor creates terminals without a
 * municipality — so it is plain glass like every other, captioned honestly
 * by `terminalRowValue`.
 */
function TerminalRecordRow({
  terminal,
  value,
  onPress,
}: {
  terminal: TerminalRowRecord;
  value: string;
  onPress: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const active = terminal.is_active === 1;
  return (
    <GlassCard
      onPress={onPress}
      testID={`tc-row-${terminal.id}`}
      cornerRadius={radius.glass}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={terminalCardAnnouncement(terminal, value)}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {terminalNameOf(terminal.name)}
        </Text>
        <Text style={styles.rowValue} numberOfLines={1}>
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
        <Icon name="chevron" size={18} color={theme.palette.onSurfaceVariant} />
      </View>
    </GlassCard>
  );
}

/** One option in the filter sheet. The applied one is tinted AND says so. */
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
      // The applied option is the ACTIVE button, so it is the orange glass
      // pill — same material and same pigment as the sibling's picker.
      tint={current ? tintedGlass.accent : undefined}
      cornerRadius={radius.large}
      style={styles.pickRow}
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
 * The record sheet: what is stored, and the two actions this screen owns —
 * EDIT hands the id to the shared editor, DEACTIVATE writes the status. The
 * municipality line agrees with the row it was opened from and says where the
 * value came from — the join, the composed name, or neither.
 */
function RecordSheet({
  terminal,
  allMunicipalities,
  onEdit,
  onDeactivate,
  onClose,
}: {
  terminal: TerminalRowRecord;
  allMunicipalities: MunicipalityRowRecord[];
  onEdit: () => void;
  onDeactivate: () => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const title = terminalNameOf(terminal.name);
  const pairs = terminalDetailPairs(terminal, allMunicipalities);
  return (
    <Sheet
      kind="record"
      title={title}
      subtitle={terminalSheetSubtitle(terminal, allMunicipalities)}
      onClose={onClose}
      closeTestID="tc-sheet-close"
      footer={
        <View style={styles.sheetActions}>
          {/* EDIT first, ghost glass — same material and position as the
              Barangay sheet's, so the two registries read as one. It closes
              the sheet by unmounting into the editor route. */}
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
          {/* Live for an inactive row too: the state
              is answered with a sentence, never a dead control. */}
          <Pressable
            onPress={onDeactivate}
            testID={`tc-deact-${terminal.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Deactivate ${title}`}
            accessibilityState={{ disabled: terminal.is_active !== 1 }}
            style={({ pressed }) => [
              styles.sheetDestructive,
              terminal.is_active !== 1 && styles.sheetDestructiveOff,
              pressed && terminal.is_active === 1 && styles.pressed,
            ]}
          >
            {/* The irreversible write is red glass — the error pigment under
                this app's own material, not a flat error swatch. An already-
                inactive row greys instead: there is nothing left to write. */}
            {terminal.is_active === 1 ? (
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
                terminal.is_active !== 1 && styles.sheetDestructiveLabelOff,
              ]}
            >
              DEACTIVATE
            </Text>
          </Pressable>
        </View>
      }
    >
      <View testID="tc-record-rows">
        <DetailCard>
          {pairs.map((pair) => (
            <DetailRow
              key={pair.label}
              label={pair.label}
              value={pair.value}
              tabular={pair.label !== 'Municipality'}
            />
          ))}
        </DetailCard>
      </View>
      <Text style={styles.sheetNote}>
        The stored values this record reads. Only the status is written from this sheet.
      </Text>
    </Sheet>
  );
}

/**
 * The confirmation. Deliberately not error-tinted: nothing here is deleted,
 * only deactivated, and a red confirm on a reversible write teaches the wrong
 * reflex for the one screen where the reflex matters.
 */
function ConfirmSheet({
  terminal,
  busy,
  onClose,
  onConfirm,
}: {
  terminal: TerminalRowRecord;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const title = terminalNameOf(terminal.name);
  return (
    <Sheet
      kind="confirm"
      title="Deactivate Terminal?"
      onClose={onClose}
      closeTestID="tc-sheet-close"
      footer={
        <View style={styles.sheetActions}>
          <Pressable
            onPress={onClose}
            testID="tc-confirm-cancel"
            accessibilityRole="button"
            accessibilityLabel="Cancel, keep the terminal active"
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
            testID="tc-confirm-go"
            accessibilityRole="button"
            accessibilityLabel={`Confirm: deactivate ${title}`}
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
      <Text style={styles.sheetBodyText} testID="tc-confirm-body">
        {`${title} will no longer be offered when creating a trip. Existing trips will not be affected.`}
      </Text>
    </Sheet>
  );
}

/**
 * Loading: four skeleton rows in the row geometry — the list is what is
 * loading, so the screen shows the shape it arrives in. A spinner says
 * nothing about that shape.
 */
function LoadingState() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      testID="tc-state"
      style={styles.stateBlock}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel="Loading terminals"
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

  // ONE column, ONE gutter — the family's 20px, matching the reference shell.
  column: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: space(5),
    paddingTop: space(5),
  },

  // ── the control card: search, then the caption that qualifies it ──
  controlCard: { padding: 14 },
  /** The list's card gap, between rows — the note's 12 comes from its own margin. */
  rowGap: { height: space(3) },
  // A GlassCard (the `cornerRadius` prop in the JSX paints it); these styles
  // are geometry only — the flat white field was the same defect the rest of
  // this column had.
  field: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    paddingHorizontal: 14,
  },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent.tertiary.container,
  },
  fieldInput: { flex: 1, minWidth: 0, padding: 0, ...type.bodyMedium, color: theme.palette.onSurface },

  // `.range-caption`: 10px below the card — the family's caption margin, the
  // one gap here that is not 12 or 20.
  // Centred, and set at the caption's own 12px throughout — see the same row
  // in BarangayConfigScreen. The two screens are a pair; they do not differ
  // in type size.
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    marginTop: 10,
  },
  captionDot: { width: 5, height: 5, borderRadius: 2, flexShrink: 0 },
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

  // ── the one transient notice ──
  // A GlassCard, geometry only: the shell's inline notice at the family's
  // card rhythm, 16px below the caption it follows.
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
  // flex-wrap is the safety rail for the widest pair on the screen: the pill
  // drops to its own line, right-aligned, where nothing clips.
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
  // itself — "3 of 5 | ADD TERMINAL +" — one control, not two neighbours
  // negotiating for the same row. tabular-nums stops the pill reflowing as
  // filters change the digit count; the bold half is the shown count.
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
  // The "|" in "3 of 5 | ADD TERMINAL" — ornament inside the pill's own
  // palette, currentColor at a whisper of opacity.
  addPillDiv: {
    width: 1,
    height: 14,
    backgroundColor: onPrimarySolid,
    opacity: 0.45,
  },
  addPillLabel: { ...type.labelSmall, color: onPrimarySolid },

  // ── the record row: Settings' card, minus its chip ──
  row: {
    minHeight: 90,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(5),
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...type.titleMedium, color: theme.palette.onSurface },
  rowValue: { ...type.bodyMedium, color: theme.palette.onSurfaceVariant, marginTop: 2 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: space(2), flexShrink: 0 },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full },
  pillActive: { backgroundColor: theme.accent.tertiary.container },
  pillInactive: { backgroundColor: theme.palette.surfaceContainer },
  pillLabel: { ...type.labelSmall },
  pillLabelActive: { color: theme.accent.tertiary.onContainer },
  pillLabelInactive: { color: theme.glass.onGlassVariant },

  // ── the empty state: three causes, three ways out ──
  // A GlassCard, geometry only. Nothing here invites a duplicate add: the
  // section head's pill is already on screen and is the registry's one Add.
  inlineEmpty: {
    marginBottom: space(3),
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
  // the `tint` prop in PickOption — the same material and pigment as the
  // sibling registry's picker, so the two screens cannot disagree.
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
  // tinted GlassCard child, so this style is geometry only. It greys, never
  // hides, on a row that has nothing left to deactivate.
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
  // The confirmation's DEACTIVATE: the primary treatment, never the error fill.
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
  stateErrorTitle: { ...type.titleMedium, color: onPrimarySolid },
  stateErrorBody: { ...type.bodyMedium, color: onPrimarySolid, opacity: 0.92 },
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
