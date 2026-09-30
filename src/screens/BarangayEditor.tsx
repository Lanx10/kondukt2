import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionChrome } from '../components/SectionChrome';
import { GlassBackdrop } from '../components/GlassBackdrop';
import { GlassCard } from '../components/GlassCard';
import { Sheet } from '../components/BottomSheet';
import { Icon } from '../icons';
import { accent, glass, maxContentWidth, palette, radius, space, type } from '../theme';
import {
  fetchAllMunicipalities,
  fetchAllTerminals,
  fetchTerminalById,
  saveTerminal,
} from '../data/tripTicketsStore';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import { applyFareInputFilter } from '../lib/fareFormat';
import { setScreenFlash } from '../lib/screenFlash';
import {
  BARANGAY_NOT_FOUND_ERROR,
  TERMINAL_SAVE_ERROR,
  barangayEditorComposeName,
  barangayEditorFieldsFromRecord,
  barangayEditorHint,
  barangayEditorMunicipalityOptions,
  buildTerminalWrite,
  commitTerminalEditorField,
  initialTerminalEditorUiState,
  municipalityDisplayLabel,
  validateBarangayEditorFields,
  type TerminalEditorUiState,
} from '../lib/terminalEditorState';

export type BarangayEditorProps = {
  /** null = create; a number = edit that terminal. The route's one param. */
  id: number | null;
  onBack: () => void;
};

/**
 * The screen's whole visible state: the shared Terminal Editor state (so it
 * reuses `commitTerminalEditorField`'s clear-on-keystroke rule byte for byte)
 * plus the two slots that editor has no fields for.
 */
type EditorState = TerminalEditorUiState & {
  municipalityId: number | null;
  muniError: string | null;
};

const SUBTITLE = 'Registers a stop and its KM marker';

/**
 * The Add / Edit Barangay screen — add-barangay.html made real.
 *
 * SPLIT, NOT REPLACE: this screen owns the barangay-config route for BOTH
 * overloads (`id === null` creates, a number edits, the title rule
 * HomeScreen already computed). `TerminalEditorScreen` stays wired to the
 * terminal-configuration route and edits the same table without a
 * municipality field — two entry points, one table; merging them is a
 * separate change to a tested screen.
 *
 * The three fields, in decision order — what it is called, where it belongs,
 * where along the road — then the one solid CTA. Every value the driver sees
 * is derived from stored rows: the hint names the composed name that will be
 * written and the nearest marker already registered in the chosen
 * municipality. Validation is the app's contract, not the prototype's: all
 * field errors at once (the module documents and tests it), the KM via
 * `parseScaled` so `0`, `12.345` and `150.25` stay valid exactly as the
 * editor beside it accepts them, the comma refused at the boundary, and a
 * duplicate refused against every stored row including inactive ones. A
 * failed write never navigates — the form keeps every typed value.
 *
 * `aria-expanded` needs no non-rendering owner here: the prototype's
 * open/close path skipped render() to keep focus, and the attribute had to be
 * set by hand beside the state. React renders the button and the sheet from
 * one `sheetOpen`, so the expanded state cannot drift.
 */
export function BarangayEditor({ id, onBack }: BarangayEditorProps) {
  const insets = useSafeAreaInsets();

  // The mode derives from the param, never from state: a route reuse cannot
  // show one terminal's form under the create title.
  const title = id === null ? 'Add Barangay' : 'Edit Barangay';

  const [state, setState] = useState<EditorState>(() => ({
    ...initialTerminalEditorUiState(id === null ? 'create' : 'edit'),
    // This screen loads in BOTH modes: create still needs the two tables
    // before its duplicate check and its hint can tell the truth.
    isLoading: true,
    municipalityId: null,
    muniError: null,
  }));
  // The two tables this screen reads for real: the picker lists the active
  // municipalities, the duplicate check and the hint read every terminal.
  const [municipalities, setMunicipalities] = useState<MunicipalityRowRecord[] | null>(null);
  const [terminals, setTerminals] = useState<TerminalRowRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusedField, setFocusedField] = useState<'name' | 'km' | null>(null);

  // The loaded record — the source of the preserved columns on save (id,
  // active flag, the stored name's tail) and of the hint's edit-aware
  // composition. State, not a ref: the hint renders from it.
  const [loaded, setLoaded] = useState<TerminalRowRecord | null>(null);
  // The in-flight save guard, readable synchronously: state updates land
  // after the callback returns, so a second tap inside one frame must be
  // refused by a ref, not by the flag in state.
  const savingRef = useRef(false);
  const nameRef = useRef<TextInput>(null);
  const kmRef = useRef<TextInput>(null);

  // One load for both modes: the two tables always, the record only in edit.
  // Create is "loading" until the tables land too — a duplicate check
  // against an unseen registry would wave the wrong rows through.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchAllTerminals(),
      fetchAllMunicipalities(),
      id === null ? Promise.resolve(null) : fetchTerminalById(id),
    ])
      .then(([terminalRows, municipalityRows, record]) => {
        if (cancelled) return;
        setTerminals(terminalRows);
        setMunicipalities(municipalityRows);
        if (id !== null) {
          // A missing terminal is an error, not a create fallback.
          if (record === null) {
            setNotFound(true);
            setState((current) => ({ ...current, isLoading: false }));
            return;
          }
          const fields = barangayEditorFieldsFromRecord(record);
          if (fields === null) {
            setNotFound(true);
            setState((current) => ({ ...current, isLoading: false }));
            return;
          }
          setLoaded(record);
          setState((current) => ({
            ...current,
            isLoading: false,
            name: fields.name,
            municipalityId: fields.municipalityId,
            km: fields.km,
          }));
          return;
        }
        setState((current) => ({ ...current, isLoading: false }));
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError('Unable to load barangay data.');
        setState((current) => ({ ...current, isLoading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const editName = useCallback((text: string) => {
    setState((current) => ({
      ...current,
      ...commitTerminalEditorField(current, 'name', text),
    }));
  }, []);

  const editKm = useCallback((text: string) => {
    setState((current) => {
      const filtered = applyFareInputFilter(current.km, text);
      // A rejected keystroke changes nothing — not even the error state.
      if (filtered === current.km) return current;
      return { ...current, ...commitTerminalEditorField(current, 'km', filtered) };
    });
  }, []);

  /** Choosing a municipality clears ITS error and any stale save failure —
   *  the value changed, so the error that belonged to it is gone. */
  const pickMunicipality = useCallback((municipalityId: number) => {
    setState((current) => ({
      ...current,
      municipalityId,
      muniError: null,
      saveError: null,
    }));
    setSheetOpen(false);
  }, []);

  const onSave = useCallback(() => {
    if (savingRef.current) return; // guard a second save in flight
    if (municipalities === null || terminals === null) return; // nothing to validate against

    // Every check, every error, one tap — the module's documented contract.
    // The municipality race is cheap: a sheet can be open while the row it
    // offers is deactivated elsewhere, and a record that lands on it is one
    // the registry immediately refuses to count.
    const validation = validateBarangayEditorFields(
      { name: state.name, municipalityId: state.municipalityId, km: state.km },
      {
        municipalities,
        terminals,
        editingId: id,
        requireActiveMunicipality: id === null,
      },
    );
    if (
      validation.nameError !== null ||
      validation.muniError !== null ||
      validation.kmError !== null ||
      validation.kmStored === null
    ) {
      setState((current) => ({
        ...current,
        nameError: validation.nameError,
        muniError: validation.muniError,
        kmError: validation.kmError,
        saveError: null,
      }));
      // Focus the first TEXT control at fault. The municipality is a button;
      // RN cannot focus a Pressable, so its error announces through its own
      // live region instead of taking focus.
      if (validation.nameError !== null) nameRef.current?.focus();
      else if (validation.kmError !== null) kmRef.current?.focus();
      return;
    }

    const municipality =
      municipalities.find((row) => row.id === state.municipalityId) ?? null;
    const composed = barangayEditorComposeName(
      { name: state.name, municipalityId: state.municipalityId, km: state.km },
      municipality,
      loaded,
    );
    const write = buildTerminalWrite(
      loaded,
      composed,
      validation.kmStored,
      state.municipalityId,
    );

    savingRef.current = true;
    setState((current) => ({
      ...current,
      isSaving: true,
      nameError: null,
      muniError: null,
      kmError: null,
      saveError: null,
    }));

    void saveTerminal(write).then((result) => {
      savingRef.current = false;
      if (result.kind === 'saved') {
        if (id === null && municipality !== null) {
          // The registry's one announcement, consumed once on the other side
          // — the prototype's flash, without its localStorage key. An edit
          // goes straight back: the row it changed is what the list shows.
          setScreenFlash(`${state.name.trim()} added to ${municipality.name}.`);
        }
        onBack();
        return;
      }
      // The form, the typed values, and the button all survive; navigating
      // on a failed write would show a save that did not happen.
      setState((current) => ({ ...current, isSaving: false, saveError: TERMINAL_SAVE_ERROR }));
    });
  }, [state, municipalities, terminals, loaded, id, onBack]);

  const chosenMunicipality = useMemo(
    () =>
      state.municipalityId === null || municipalities === null
        ? null
        : (municipalities.find((row) => row.id === state.municipalityId) ?? null),
    [state.municipalityId, municipalities],
  );

  const muniValue = chosenMunicipality === null
    ? 'Choose a municipality'
    : municipalityDisplayLabel(chosenMunicipality);
  // The control reads its own value and its affordance back, so the visible
  // value being plain text costs the reader nothing.
  const muniLabel =
    chosenMunicipality === null
      ? 'Municipality. Choose a municipality.'
      : `Municipality. ${muniValue}. Change it.`;

  const options = useMemo(
    () =>
      municipalities === null || terminals === null
        ? []
        : barangayEditorMunicipalityOptions(municipalities, terminals),
    [municipalities, terminals],
  );

  // The hint re-derives on every keystroke because it quotes what will be
  // written — that is the whole reason this screen re-renders while typing.
  const hint = useMemo(
    () =>
      barangayEditorHint(
        { name: state.name, municipalityId: state.municipalityId, km: state.km },
        {
          municipalities: municipalities ?? [],
          terminals: terminals ?? [],
          loaded,
        },
      ),
    [state.name, state.municipalityId, state.km, municipalities, terminals, loaded],
  );

  const body = (() => {
    if (state.isLoading) {
      // The card owns the body; the save button is absent, not disabled —
      // there is nothing to save yet.
      return (
        <View style={styles.centerBlock}>
          <View style={styles.loadingCard} accessibilityLiveRegion="polite">
            <ActivityIndicator size={24} color={palette.primary} />
            <Text style={styles.centerTitle}>Loading barangay</Text>
            <Text style={styles.centerText}>Reading offline location data.</Text>
          </View>
        </View>
      );
    }
    if (notFound) {
      // The single-string failure: one line, no form, no create fallback.
      return (
        <View style={styles.centerBlock}>
          <View style={styles.failureCard} accessibilityLiveRegion="polite">
            <Text style={styles.notFoundText}>{BARANGAY_NOT_FOUND_ERROR}</Text>
          </View>
        </View>
      );
    }
    if (loadError !== null) {
      return (
        <View style={styles.centerBlock} accessibilityLiveRegion="polite">
          <Text style={styles.centerTitle} accessibilityRole="header">
            Barangay unavailable
          </Text>
          <Text style={styles.centerText}>{loadError}</Text>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back to barangay configuration"
            style={({ pressed }) => [styles.goBackButton, pressed && styles.pressed]}
          >
            <Text style={styles.goBackLabel}>GO BACK</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <ScrollView
        contentContainerStyle={[styles.column, { paddingBottom: insets.bottom + space(6) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* One notice, no dismiss button: on a form the notice is the
            whole-save failure — a validation error lives on its own field.
            It clears when a value changes, because it belonged to the save
            attempt that value broke, never to a tap elsewhere. */}
        {state.saveError !== null ? (
          <View testID="ab-msg" style={styles.noticeSlot}>
            <View
              testID="ab-banner"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={styles.caution}
            >
              <Text style={styles.cautionText}>{state.saveError}</Text>
            </View>
          </View>
        ) : null}

        <View testID="ab-form" style={styles.formSection}>
          {/* One card, three fields, the commit — the registry's shared
              range-card bytes, 14px padding kept so the family's cards do
              not split into two measurements. */}
          <GlassCard style={styles.formCard}>
            <View style={styles.fields}>
              <View testID="ab-name-wrap" style={styles.fieldWrap}>
                <View
                  style={[
                    styles.field,
                    focusedField === 'name' && styles.fieldFocused,
                    state.nameError !== null && styles.fieldInvalid,
                  ]}
                >
                  <View style={styles.fieldIcon}>
                    <Icon name="barangay" size={18} color={accent.tertiary.onContainer} />
                  </View>
                  <View style={styles.fieldBody}>
                    <Text style={styles.fieldLabel}>Barangay</Text>
                    <TextInput
                      ref={nameRef}
                      testID="ab-name"
                      value={state.name}
                      onChangeText={editName}
                      // ENTER submits from either input — this screen's one commit.
                      onSubmitEditing={onSave}
                      placeholder="e.g. Bagong"
                      placeholderTextColor={palette.outline}
                      maxLength={60}
                      autoComplete="off"
                      autoCorrect={false}
                      editable={!state.isSaving}
                      onFocus={() => setFocusedField('name')}
                      onBlur={() => setFocusedField(null)}
                      accessibilityLabel={`Barangay name${state.nameError !== null ? ', invalid' : ''}`}
                      style={styles.fieldInput}
                    />
                  </View>
                </View>
                {state.nameError !== null ? (
                  <Text style={styles.errorText} accessibilityLiveRegion="polite">
                    {state.nameError}
                  </Text>
                ) : null}
              </View>

              {/* Not a select, not a text field: a foreign key a typo would
                  corrupt, so it opens the sheet — and its expanded state is
                  the same render as the sheet's, by construction. */}
              <View style={styles.fieldWrap}>
                <Pressable
                  testID="ab-muni-btn"
                  onPress={() => setSheetOpen(true)}
                  disabled={state.isSaving}
                  accessibilityRole="button"
                  accessibilityLabel={muniLabel}
                  accessibilityState={{ expanded: sheetOpen, disabled: state.isSaving }}
                  style={({ pressed }) => [
                    styles.field,
                    state.muniError !== null && styles.fieldInvalid,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.fieldIcon}>
                    <Icon name="pin" size={18} color={accent.tertiary.onContainer} />
                  </View>
                  <View style={styles.fieldBody}>
                    <Text style={styles.fieldLabel}>Municipality</Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.fieldValue,
                        chosenMunicipality === null && styles.fieldValueEmpty,
                      ]}
                    >
                      {muniValue}
                    </Text>
                  </View>
                  <Icon name="chevronDown" size={18} color={palette.onSurfaceVariant} />
                </Pressable>
                {state.muniError !== null ? (
                  <Text style={styles.errorText} accessibilityLiveRegion="polite">
                    {state.muniError}
                  </Text>
                ) : null}
              </View>

              <View testID="ab-km-wrap" style={styles.fieldWrap}>
                <View
                  style={[
                    styles.field,
                    focusedField === 'km' && styles.fieldFocused,
                    state.kmError !== null && styles.fieldInvalid,
                  ]}
                >
                  <View style={styles.fieldIcon}>
                    <Icon name="route" size={18} color={accent.tertiary.onContainer} />
                  </View>
                  <View style={styles.fieldBody}>
                    <Text style={styles.fieldLabel}>Registered KM</Text>
                    <View style={styles.kmLine}>
                      <TextInput
                        ref={kmRef}
                        testID="ab-km"
                        value={state.km}
                        onChangeText={editKm}
                        onSubmitEditing={onSave}
                        keyboardType="decimal-pad"
                        placeholder="0.0"
                        placeholderTextColor={palette.outline}
                        autoComplete="off"
                        autoCorrect={false}
                        editable={!state.isSaving}
                        onFocus={() => setFocusedField('km')}
                        onBlur={() => setFocusedField(null)}
                        accessibilityLabel={`Registered KM marker${state.kmError !== null ? ', invalid' : ''}`}
                        style={styles.kmInput}
                      />
                      {/* The label already says KM; the unit is decoration
                          beside the number, never spoken twice. */}
                      <Text style={styles.kmUnit} importantForAccessibility="no-hide-descendants">
                        KM
                      </Text>
                    </View>
                  </View>
                </View>
                {state.kmError !== null ? (
                  <Text style={styles.errorText} accessibilityLiveRegion="polite">
                    {state.kmError}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* The screen's ONE solid primary, 48px, same column as the
                fields, 20px under the last — the grid the prototype measured. */}
            <Pressable
              testID="ab-save"
              onPress={onSave}
              disabled={state.isSaving}
              accessibilityRole="button"
              accessibilityLabel="Save barangay"
              accessibilityState={{ disabled: state.isSaving, busy: state.isSaving }}
              style={({ pressed }) => [
                styles.save,
                state.isSaving && styles.saveBusy,
                pressed && !state.isSaving && styles.pressed,
              ]}
            >
              <Text style={styles.saveLabel}>SAVE BARANGAY</Text>
            </Pressable>
          </GlassCard>

          {/* The most useful line on the screen: what will be stored, and
              the nearest marker already registered — derived, not typed. */}
          <Text
            testID="ab-kmhint"
            style={styles.hint}
            accessibilityLiveRegion="polite"
          >
            {hint}
          </Text>
        </View>

        <GlassCard
          testID="ab-storage"
          style={styles.noteLock}
          accessible
          accessibilityLabel="Offline storage. The record is saved on this device and works offline."
        >
          <Icon name="lock" size={18} color={glass.onGlassVariant} />
          <View style={styles.noteLockBody}>
            <Text style={styles.noteLockLabel}>OFFLINE STORAGE</Text>
            <Text style={styles.noteLockText}>
              The record is saved on this device and works offline.
            </Text>
          </View>
        </GlassCard>
      </ScrollView>
    );
  })();

  return (
    <View style={styles.screen}>
      <GlassBackdrop />
      <SectionChrome
        title={title}
        subtitle={SUBTITLE}
        subtitleTestID="ab-sub"
        titleMinHeight={56}
        onBack={onBack}
        insets={insets}
        backLabel="Back to barangay configuration"
        testID="ab-chrome"
        backTestID="ab-back"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'android' ? undefined : 'padding'}
          style={styles.flex}
          pointerEvents="box-none"
        >
          {body}
        </KeyboardAvoidingView>
      </SectionChrome>

      {sheetOpen ? (
        <Sheet
          kind="muni"
          title="Municipality"
          subtitle="Chooses where this barangay belongs"
          onClose={() => setSheetOpen(false)}
          closeTestID="ab-sheet-close"
          fill
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.pickList}
          >
            {options.map((option) => {
              const current = option.id === state.municipalityId;
              // A zero count prints no count: the sub-line exists to say what
              // a municipality OWNS (every row, any status), and "· 0" read
              // as a fact about the registry is the defect the two-tier rule
              // was fixed for.
              const countLine =
                option.barangayCount === 0
                  ? ''
                  : `${option.barangayCount} ${
                      option.barangayCount === 1 ? 'barangay' : 'barangays'
                    }`;
              const subLine =
                countLine === ''
                  ? option.province
                  : option.province === ''
                    ? countLine
                    : `${option.province} · ${countLine}`;
              return (
                <Pressable
                  key={option.id}
                  testID={`ab-muni-${option.id}`}
                  onPress={() => pickMunicipality(option.id)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    current
                      ? `${option.name}, ${subLine}, currently applied`
                      : `${option.name}, ${subLine}`
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
                      numberOfLines={1}
                      style={[styles.pickName, current && styles.pickNameCurrent]}
                    >
                      {option.name}
                    </Text>
                    <Text
                      style={[styles.pickSub, current && styles.pickSubCurrent]}
                    >
                      {subLine}
                    </Text>
                  </View>
                  <Icon
                    name="check"
                    size={18}
                    color={current ? palette.onPrimaryContainer : palette.onSurfaceVariant}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.88 },
  screen: { flex: 1, backgroundColor: glass.backdrop },

  // ONE column, ONE gutter — the same inset the registry above it uses.
  column: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: space(5),
    paddingTop: space(5),
  },

  // ── the notice: the whole-save failure's own channel ──
  noticeSlot: { marginTop: space(4) },
  caution: {
    paddingVertical: space(3),
    paddingHorizontal: space(4),
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: palette.outlineVariant,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  cautionText: { ...type.bodySmall, color: glass.onGlassVariant },

  // ── the form card ──
  formSection: { marginTop: space(5) },
  // 14px, the shared range-card's own padding: the same card holds 68px
  // fields on this screen and 90px rows on the registry, and re-padding one
  // screen splits the family. Allowlisted, on the 4px grid's half-step.
  formCard: { padding: 14 },
  fields: { gap: space(3) },
  fieldWrap: { gap: space(1) },
  field: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.outline,
    borderRadius: radius.large,
    backgroundColor: palette.surface,
  },
  // Focus changes the border's colour only — the prototype's focus ring is
  // a colour swap plus a shadow, never a width change that would reflow the
  // field under the caret.
  fieldFocused: { borderColor: palette.primary },
  fieldInvalid: { borderColor: palette.error },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: accent.tertiary.container,
  },
  fieldBody: { flex: 1, minWidth: 0 },
  fieldLabel: { ...type.bodySmall, color: palette.onSurfaceVariant },
  fieldInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    ...type.bodyMedium,
    fontFamily: 'Poppins_600SemiBold',
    color: palette.onSurface,
    // The wrapper carries the focus ring, exactly as the prototype's
    // `input { outline: none }` does — one ring, never two.
    outlineWidth: 0,
  },
  fieldValue: { ...type.bodyMedium, fontFamily: 'Poppins_600SemiBold', color: palette.onSurface },
  // "Choose a municipality" reads as the absence of a choice, not a value.
  fieldValueEmpty: {
    fontFamily: 'Poppins_400Regular',
    fontWeight: '500',
    color: palette.onSurfaceVariant,
  },
  kmLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  kmInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    ...type.bodyMedium,
    fontFamily: 'Poppins_600SemiBold',
    color: palette.onSurface,
    outlineWidth: 0,
  },
  kmUnit: { ...type.bodyMedium, fontFamily: 'Poppins_600SemiBold', color: palette.onSurfaceVariant },
  errorText: { ...type.bodySmall, color: palette.error },

  // ── the one commit ──
  save: {
    minHeight: 48,
    marginTop: space(5),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.large,
    backgroundColor: palette.primarySolid,
  },
  saveBusy: { opacity: 0.65 },
  saveLabel: { ...type.labelLarge, color: palette.onPrimary, letterSpacing: 0.8 },

  // ── the hint, 20 below the card ──
  hint: {
    ...type.bodySmall,
    color: glass.onGlassVariant,
    marginTop: space(5),
  },

  // ── the offline statement, 20 below the hint ──
  noteLock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    marginTop: space(5),
    paddingVertical: space(4),
    paddingHorizontal: space(5),
  },
  noteLockBody: { flex: 1 },
  noteLockLabel: { ...type.labelSmall, color: glass.onGlassVariant },
  noteLockText: { ...type.bodySmall, color: glass.onGlassVariant, marginTop: space(1) },

  // ── the municipality sheet: the registry's own pick rows ──
  pickList: { gap: space(2), paddingBottom: space(2) },
  pickRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    paddingHorizontal: space(3),
    borderWidth: 1,
    borderColor: palette.outline,
    borderRadius: radius.large,
    backgroundColor: palette.surface,
  },
  // 2px on the applied row and one less padding, so choosing a row does
  // not resize the list under the finger.
  pickRowCurrent: {
    borderWidth: 2,
    borderColor: palette.primarySolid,
    backgroundColor: palette.primaryContainer,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  pickBody: { flex: 1, minWidth: 0 },
  pickName: { ...type.bodyMedium, color: palette.onSurface },
  pickNameCurrent: { color: palette.onPrimaryContainer },
  pickSub: { ...type.bodySmall, color: palette.onSurfaceVariant, marginTop: 2 },
  pickSubCurrent: { color: palette.onPrimaryContainer, opacity: 0.85 },

  // ── body-owned states: they replace the form entirely ──
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(4),
  },
  loadingCard: {
    alignItems: 'center',
    padding: space(4),
    gap: space(3),
    borderRadius: radius.medium,
    backgroundColor: palette.surfaceContainerLow,
  },
  failureCard: {
    padding: space(4),
    borderRadius: radius.medium,
    backgroundColor: palette.surfaceContainerLow,
  },
  notFoundText: { ...type.titleMedium, color: palette.error, textAlign: 'center' },
  centerTitle: { ...type.titleMedium, color: palette.onSurface },
  centerText: { ...type.bodyMedium, color: palette.onSurfaceVariant, textAlign: 'center' },
  goBackButton: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space(3),
    borderRadius: radius.large,
    backgroundColor: accent.primary.container,
    paddingHorizontal: space(6),
  },
  goBackLabel: { ...type.labelLarge, color: accent.primary.onContainer, letterSpacing: 0.8 },
});
