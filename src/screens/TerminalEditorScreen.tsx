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
import { Icon } from '../icons';
import { accent, glass, maxContentWidth, palette, radius, space, type } from '../theme';
import {
  fetchAllTerminals,
  fetchTerminalById,
  saveTerminal,
} from '../data/tripTicketsStore';
import type { TerminalRowRecord } from '../data/schema';
import { applyFareInputFilter } from '../lib/fareFormat';
import { setScreenFlash } from '../lib/screenFlash';
import {
  TERMINAL_NOT_FOUND_ERROR,
  TERMINAL_SAVE_ERROR,
  buildTerminalWrite,
  commitTerminalEditorField,
  composeTerminalName,
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
 * optional id — the app-side port of add-terminal.html, minus its
 * municipality picker.
 *
 * Two fields: the PLACE name (the form refuses a comma because a stored name
 * is `place, municipality` and two readers downstream split it on different
 * commas) and the marker in thousandths under the file's cap. The
 * municipality link is the Barangay Editor's field — it composes the stored
 * tail; this route stores the bare place on create and carries a loaded
 * row's tail through an edit untouched, so a save from here can never wipe
 * a link or a provenance this form does not show.
 *
 * Validation keeps the app's contract, stated as the decision: every failure
 * on every attempt, all shown at once — the prototype's first-error-only
 * `validate()` is the one contract dropped, because a form that highlights
 * one error per tap costs a tap per error. Field refusals mark their own
 * control and take focus; a store rejection (the duplicate) and a write
 * failure share the ONE notice above the form — two channels, never a
 * stack, no dismiss, cleared when a value changes. A failed write never
 * navigates.
 *
 * Edit carries every column the driver cannot see: the id and the active
 * flag ride through from the loaded record. On success the screen goes
 * straight back — the registry's flash announces the write once, and the
 * list repaints through `subscribeToTrips` either way.
 */
export function TerminalEditorScreen({ terminalId, onBack }: TerminalEditorScreenProps) {
  const insets = useSafeAreaInsets();

  // The mode derives from the param, never from state: a route reuse cannot
  // show one terminal's edit form under the create title.
  const mode = terminalId === null ? 'create' : 'edit';
  const title = terminalEditorTitle(mode);

  // Both editable values are strings. A number-bound field cannot hold a
  // decimal point mid-typing; the conversion happens once, at save.
  const [state, setState] = useState(() => ({
    ...initialTerminalEditorUiState(mode),
    isLoading: terminalId !== null,
  }));
  const [terminals, setTerminals] = useState<TerminalRowRecord[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  // The registry loads in both modes: the hint reads the stored markers so a
  // new number is typed next to the route's own figures. The record only in
  // edit. A missing terminal is an error, never a create fallback.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchAllTerminals(),
      terminalId === null ? Promise.resolve(null) : fetchTerminalById(terminalId),
    ])
      .then(([terminalRows, record]) => {
        if (cancelled) return;
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

  const onSave = useCallback(() => {
    if (savingRef.current) return; // guard a second save in flight

    // Every check on every attempt; field refusals mark their own control
    // and the FIRST text field at fault takes focus.
    const validation = validateTerminalEditorFields(state);
    if (
      validation.nameError !== null ||
      validation.kmError !== null ||
      validation.kmStored === null
    ) {
      setState((current) => ({
        ...current,
        nameError: validation.nameError,
        kmError: validation.kmError,
        saveError: null,
      }));
      if (validation.nameError !== null) nameRef.current?.focus();
      else kmRef.current?.focus();
      return;
    }

    // The name happens HERE, at the boundary: create stores the bare place;
    // an edit carries the loaded row's stored tail byte-for-byte, so a save
    // that fixes a KM never rewrites the provenance under it.
    const name = composeTerminalName(state.name, loaded);
    const write = {
      ...buildTerminalWrite(loaded, name, validation.kmStored),
      // Files the record under this module, so it lists under Terminal
      // Configuration and not in the barangay registry.
      kind: 'TERMINAL' as const,
    };

    savingRef.current = true;
    setState((current) => ({
      ...current,
      isSaving: true,
      nameError: null,
      kmError: null,
      saveError: null,
    }));

    void saveTerminal(write).then((result) => {
      savingRef.current = false;
      if (result.kind === 'saved') {
        // The registry's one announcement, consumed once on the other side.
        if (mode === 'create') {
          setScreenFlash(`${state.name.trim()} added.`);
        } else {
          setScreenFlash(`${state.name.trim()} updated.`);
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
  }, [state, loaded, mode, onBack]);

  // The caption re-derives on every keystroke because it quotes what will be
  // written and reads the registry's markers back.
  const hint = useMemo(
    () => terminalEditorHint({ name: state.name, km: state.km }, { terminals: terminals ?? [] }),
    [state.name, state.km, terminals],
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
        contentContainerStyle={[styles.column, { paddingBottom: insets.bottom + space(9) }]}
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
          {/* One card, two fields, the commit — the family's shared
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
              to store, and the marker context the registry already holds —
              every figure fetched, never typed. */}
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
