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
  barangayEditorComposeName,
  barangayEditorMunicipalityOptions,
  municipalityDisplayLabel,
  pickTerminalMunicipality,
  TERMINAL_NOT_FOUND_ERROR,
  TERMINAL_SAVE_ERROR,
  buildTerminalWrite,
  commitTerminalEditorField,
  initialTerminalEditorUiState,
  terminalEditorAccessibilityTitle,
  terminalEditorFieldsFromRecord,
  terminalEditorHint,
  terminalEditorTitle,
  validateTerminalEditorFields,
} from '../lib/terminalEditorState';

export type TerminalEditorScreenProps = {
  /** Absent = create mode; present = edit that terminal. The only param. */
  terminalId: number | null;
  onBack: () => void;
};

/**
 * The Terminal Editor: one screen for both create and edit, one route, one
 * optional id — the app-side port of add-terminal.html.
 *
 * Three fields, the file's own three columns: the PLACE name (the form
 * refuses a comma because the stored string is `place, municipality` and two
 * readers downstream split it on different commas), the municipality by
 * PICKER — never typed — and the marker in thousandths under the file's cap.
 * The composed name is built at this boundary and handed to the store whole;
 * nothing else in the app composes a terminal name.
 *
 * Validation keeps the app's contract, stated as the decision: every failure
 * on every attempt, all shown at once — the file's first-error-only
 * `validate()` is the one contract dropped, because a three-field form that
 * highlights one error per tap costs a tap per error. Field refusals mark
 * their own control and take focus; a store rejection (the duplicate) and a
 * write failure share the ONE notice above the form — two channels, never a
 * stack, no dismiss, cleared when a value changes. A failed write never
 * navigates.
 *
 * Edit carries every column the driver cannot see: the id and the active
 * flag ride through from the loaded record, and the municipality link loads
 * into the picker so a save cannot null an association it never showed.
 * On success the screen goes straight back — create first announces itself
 * through the flash the registry consumes once; the list repaints through
 * `subscribeToTrips` either way.
 */
export function TerminalEditorScreen({ terminalId, onBack }: TerminalEditorScreenProps) {
  const insets = useSafeAreaInsets();

  // The mode derives from the param, never from state: a route reuse cannot
  // show one terminal's edit form under the create title.
  const mode = terminalId === null ? 'create' : 'edit';
  const title = terminalEditorTitle(mode);

  // Both editable values are strings. A number-bound field cannot hold a
  // decimal point mid-typing; the conversion happens once, at save. Loading
  // starts true in BOTH modes: the picker's municipality table has to land
  // before the form can offer a choice or tell the truth about one.
  const [state, setState] = useState(() => ({
    ...initialTerminalEditorUiState(mode),
    isLoading: true,
  }));
  const [municipalities, setMunicipalities] = useState<MunicipalityRowRecord[] | null>(null);
  const [terminals, setTerminals] = useState<TerminalRowRecord[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusedField, setFocusedField] = useState<'name' | 'km' | null>(null);

  // The loaded record, held as STATE — the hint renders from it, so it can
  // never be a ref (a ref read during render is what the hooks rule refuses).
  // The source of the preserved fields on save; never rendered itself.
  const [loaded, setLoaded] = useState<TerminalRowRecord | null>(null);
  // The in-flight save guard, readable synchronously: state updates land
  // after the callback returns, so a second tap inside one frame must be
  // refused by a ref, not by the flag in state.
  const savingRef = useRef(false);
  const nameRef = useRef<TextInput>(null);
  const kmRef = useRef<TextInput>(null);

  // The two tables load in both modes; the record only in edit. A missing
  // terminal is an error, never a create fallback.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchAllMunicipalities(),
      fetchAllTerminals(),
      terminalId === null ? Promise.resolve(null) : fetchTerminalById(terminalId),
    ])
      .then(([municipalityRows, terminalRows, record]) => {
        if (cancelled) return;
        setMunicipalities(municipalityRows);
        setTerminals(terminalRows);
        if (terminalId !== null) {
          const fields = terminalEditorFieldsFromRecord(record);
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
        setLoadError('Unable to load terminal.');
        setState((current) => ({ ...current, isLoading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [mode, terminalId]);

  const editName = useCallback((text: string) => {
    setState((current) => commitTerminalEditorField(current, 'name', text));
  }, []);

  const editKm = useCallback((text: string) => {
    setState((current) => {
      const filtered = applyFareInputFilter(current.km, text);
      // A rejected keystroke changes nothing — not even the error state.
      if (filtered === current.km) return current;
      return commitTerminalEditorField(current, 'km', filtered);
    });
  }, []);

  /** Choosing a municipality: one render, the sheet closes with it. */
  const pickMunicipality = useCallback((municipalityId: number) => {
    setState((current) => pickTerminalMunicipality(current, municipalityId));
    setSheetOpen(false);
  }, []);

  const onSave = useCallback(() => {
    if (savingRef.current) return; // guard a second save in flight
    if (municipalities === null) return; // the picker's table has not landed

    // Every check on every attempt; field refusals mark their own control
    // and the FIRST text field at fault takes focus (the picker is a
    // button — it cannot take focus, so its error announces in place).
    const validation = validateTerminalEditorFields(state, {
      municipalities,
      requireActiveMunicipality: mode === 'create',
    });
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
      if (validation.nameError !== null) nameRef.current?.focus();
      else if (validation.kmError !== null) kmRef.current?.focus();
      return;
    }

    // The composition happens HERE, at the boundary: the store receives the
    // string it stores and never a set of parts. An edit that did not move
    // the municipality keeps its stored tail byte-for-byte.
    const chosen = municipalities.find((row) => row.id === state.municipalityId) ?? null;
    const composed = barangayEditorComposeName(
      { name: state.name, municipalityId: state.municipalityId, km: state.km },
      chosen,
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
        if (mode === 'create' && chosen !== null) {
          // The registry's one announcement, consumed once on the other side.
          setScreenFlash(`${state.name.trim()} added to ${chosen.name}.`);
        }
        onBack();
        return;
      }
      // The form, the typed values, and the button all survive; navigating
      // on a failed write would show a save that did not happen. The store's
      // duplicate sentence arrives here verbatim; anything else is the
      // generic write failure.
      setState((current) => ({
        ...current,
        isSaving: false,
        saveError: result.kind === 'rejected' ? result.reason : TERMINAL_SAVE_ERROR,
      }));
    });
  }, [state, municipalities, loaded, mode, onBack]);

  // Picker options: active municipalities, province-then-name, each with the
  // all-status terminal count its sub-line prints — one filter, one order,
  // one count, shared with the registry's own picker.
  const options = useMemo(
    () =>
      municipalities === null || terminals === null
        ? []
        : barangayEditorMunicipalityOptions(municipalities, terminals),
    [municipalities, terminals],
  );

  const chosenMunicipality =
    state.municipalityId === null || municipalities === null
      ? null
      : (municipalities.find((row) => row.id === state.municipalityId) ?? null);

  // The control reads its own value and affordance back: the composed pair
  // when one is chosen, the instruction when there is not.
  const muniValue =
    chosenMunicipality === null ? 'Choose a municipality' : municipalityDisplayLabel(chosenMunicipality);
  const muniLabel =
    chosenMunicipality === null
      ? `Municipality. Choose a municipality.${state.muniError !== null ? ' Invalid.' : ''}`
      : `Municipality. ${muniValue}. Change it.${state.muniError !== null ? ' Invalid.' : ''}`;

  // The caption re-derives on every keystroke because it quotes what will be
  // written and reads the marker context back from the table.
  const hint = useMemo(
    () =>
      terminalEditorHint(
        { name: state.name, municipalityId: state.municipalityId, km: state.km },
        { municipalities: municipalities ?? [], terminals: terminals ?? [], loaded },
      ),
    [state.name, state.municipalityId, state.km, municipalities, terminals, loaded],
  );

  const body = (() => {
    if (state.isLoading) {
      // The loading card owns the body; the save button is absent, not
      // disabled — there is nothing to save yet.
      return (
        <View style={styles.centerBlock}>
          <View style={styles.loadingCard} accessibilityLiveRegion="polite">
            <ActivityIndicator size={24} color={palette.primary} />
            <Text style={styles.centerTitle}>Loading terminal</Text>
            <Text style={styles.centerText}>Reading offline terminal data.</Text>
          </View>
        </View>
      );
    }
    if (notFound) {
      // The single-string failure: one line, no form, no create fallback.
      return (
        <View style={styles.centerBlock}>
          <View style={styles.failureCard} accessibilityLiveRegion="polite">
            <Text style={styles.notFoundText}>{TERMINAL_NOT_FOUND_ERROR}</Text>
          </View>
        </View>
      );
    }
    if (loadError !== null) {
      // A read failure owns the body, like the list and fare screens.
      return (
        <View style={styles.centerBlock} accessibilityLiveRegion="polite">
          <Text style={styles.centerTitle} accessibilityRole="header">
            Terminal unavailable
          </Text>
          <Text style={styles.centerText}>{loadError}</Text>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back to the terminal list"
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
        {/* One notice, no dismiss: a store rejection (the duplicate) and a
            whole-save failure are the same channel — the write was refused.
            Field refusals live on their fields. It clears when a value
            changes, because it belonged to the attempt that value broke. */}
        {state.saveError !== null ? (
          <View testID="tc-msg" style={styles.noticeSlot}>
            <View
              testID="tc-banner"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={styles.caution}
            >
              <Text style={styles.cautionText}>{state.saveError}</Text>
            </View>
          </View>
        ) : null}

        <View testID="tc-form" style={styles.formSection}>
          {/* One card, three fields, the commit — the family's shared
              range-card bytes, 14px padding kept so the editors do not split
              into two measurements. */}
          <GlassCard style={styles.formCard}>
            <View style={styles.fields}>
              <View
                testID="tc-name-wrap"
                style={[
                  styles.field,
                  focusedField === 'name' && styles.fieldFocused,
                  state.nameError !== null && styles.fieldInvalid,
                ]}
              >
                <View style={styles.fieldIcon}>
                  <Icon name="terminal" size={18} color={accent.tertiary.onContainer} />
                </View>
                <View style={styles.fieldBody}>
                  <Text style={styles.fieldLabel}>Terminal</Text>
                  <TextInput
                    ref={nameRef}
                    testID="tc-name"
                    value={state.name}
                    onChangeText={editName}
                    // ENTER submits from any field — this screen's one commit.
                    onSubmitEditing={onSave}
                    placeholder="e.g. Dau"
                    placeholderTextColor={palette.outline}
                    maxLength={60}
                    autoComplete="off"
                    autoCorrect={false}
                    editable={!state.isSaving}
                    onFocus={() => setFocusedField('name')}
                    onBlur={() => setFocusedField(null)}
                    accessibilityLabel={`Terminal name${state.nameError !== null ? ', invalid' : ''}`}
                    style={styles.fieldInput}
                  />
                </View>
              </View>
              {state.nameError !== null ? (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {state.nameError}
                </Text>
              ) : null}

              {/* Not a text field: the municipality is a foreign key a typo
                  would corrupt, so it opens the sheet — the picker supplies
                  the second half of the composed name, never the driver. */}
              <Pressable
                testID="tc-muni-btn"
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
                    style={[styles.fieldValue, chosenMunicipality === null && styles.fieldValueEmpty]}
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

              <View
                testID="tc-km-wrap"
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
                  {/* The unit lives inside the value line: a marker is never
                      read or typed without it. */}
                  <View style={styles.kmLine}>
                    <TextInput
                      ref={kmRef}
                      testID="tc-km"
                      value={state.km}
                      onChangeText={editKm}
                      onSubmitEditing={onSave}
                      keyboardType="decimal-pad"
                      placeholder="0.0"
                      placeholderTextColor={palette.outline}
                      maxLength={6}
                      autoComplete="off"
                      autoCorrect={false}
                      editable={!state.isSaving}
                      onFocus={() => setFocusedField('km')}
                      onBlur={() => setFocusedField(null)}
                      accessibilityLabel={`Registered KM marker${state.kmError !== null ? ', invalid' : ''}`}
                      style={styles.kmInput}
                    />
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

            {/* The screen's ONE solid primary, 48px, same column as the
                fields, 20px under the last — the grid the file measured. */}
            <Pressable
              testID="tc-save"
              onPress={onSave}
              disabled={state.isSaving}
              accessibilityRole="button"
              accessibilityLabel="Save terminal"
              accessibilityState={{ disabled: state.isSaving, busy: state.isSaving }}
              style={({ pressed }) => [
                styles.save,
                state.isSaving && styles.saveBusy,
                pressed && !state.isSaving && styles.pressed,
              ]}
            >
              <Text style={styles.saveLabel}>SAVE TERMINAL</Text>
            </Pressable>
          </GlassCard>

          {/* The most useful line on the screen: the row this write is about
              to store, and the marker context the chosen municipality already
              holds — every figure fetched, never typed. */}
          <Text testID="tc-kmhint" style={styles.hint} accessibilityLiveRegion="polite">
            {hint}
          </Text>
        </View>

        <GlassCard
          testID="tc-storage"
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
        // Sentence case for the reader; the visual casing stays as specified.
        titleAccessibilityLabel={terminalEditorAccessibilityTitle(mode)}
        subtitle="Registers a terminal and its KM marker"
        subtitleTestID="tc-sub"
        titleMinHeight={56}
        onBack={onBack}
        insets={insets}
        // The previous screen is the list, not Settings — a different
        // previous screen from the list screen's own back label.
        backLabel="Back"
        testID="tc-chrome"
        backTestID="tc-back"
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
          subtitle="Chooses where this terminal belongs"
          onClose={() => setSheetOpen(false)}
          closeTestID="tc-sheet-close"
          fill
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.pickList}
          >
            {options.map((option) => {
              const current = option.id === state.municipalityId;
              const n = option.barangayCount;
              const subLine = `${option.province} · ${n} ${n === 1 ? 'terminal' : 'terminals'}`;
              return (
                <Pressable
                  key={option.id}
                  testID={`tc-muni-${option.id}`}
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
                    <Text style={[styles.pickSub, current && styles.pickSubCurrent]}>
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

  // ONE column, ONE gutter — the same inset the list screens use.
  column: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: space(5),
    paddingTop: space(5),
  },

  // ── the notice: the write channel only ──
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
  // 14px, the shared range-card's own padding — the same bytes hold these
  // fields and the registry's rows; re-padding splits the family.
  formCard: { padding: 14 },
  // 12px, same stack as the sibling editors: three rows, one gap.
  fields: { gap: space(3) },
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
  // Focus changes the border's colour only — never a width change that would
  // reflow the field under the caret.
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
  // 20px, not the 14px a primary button might ship: the screen's one
  // irreversible write, on the 4px grid, 20 below the last field.
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

  // ── the caption, 10 below the card — `.range-caption`'s own margin ──
  hint: {
    ...type.bodySmall,
    color: glass.onGlassVariant,
    marginTop: 10,
  },

  // ── the offline statement, 20 below the section ──
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

  // ── the municipality sheet: the family's pick rows ──
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
    gap: space(3),
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
