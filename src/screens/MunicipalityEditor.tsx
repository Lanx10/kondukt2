import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { maxContentWidth, onPrimarySolid, radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import {
  countMunicipalitiesInProvince,
  fetchMunicipalityById,
  saveMunicipality,
  updateMunicipality,
} from '../data/tripTicketsStore';
import { setScreenFlash } from '../lib/screenFlash';
import {
  MUNICIPALITY_SAVE_ERROR,
  commitMunicipalityEditorField,
  initialMunicipalityEditorUiState,
  municipalityEditorChrome,
  municipalityEditorHint,
  municipalityEditorUiStateFrom,
  municipalityEditorValidate,
  type MunicipalityEditorField,
  type MunicipalityEditorUiState,
} from '../lib/municipalityEditorState';

export type MunicipalityEditorProps = {
  onBack: () => void;
  /**
   * Null creates; a number is the row being edited.
   *
   * The router has always held this id and used to route the non-null half to a
   * "not built yet" placeholder — a screen reached from the Barangay
   * Configuration row's own EDIT button, so the affordance existed and the
   * operation behind it did not. Both halves are alive now: same two fields,
   * same validator, same notice slot, one store write either way.
   */
  id?: number | null;
};

/** The load state of the edit half. Create needs no read. */
type LoadState =
  | { kind: 'create' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'notFound' }
  | { kind: 'ready' };

/**
 * The Add Municipality screen — add-municipality.html made real.
 *
 * Two fields, one irreversible write, no third anything: `municipalities` is
 * `name, province` and a municipality owns no KM marker — its barangays do.
 * Both fields refuse a comma at the boundary because two readers of the same
 * stored string (`barangayNameOf` cuts the first comma, `municipalityOf` the
 * last) already disagree, and the seed itself used to violate the rule —
 * fixed in this same pass.
 *
 * ONE notice slot holds every refusal: a field validation error, the data
 * layer's duplicate rejection (the file marks the name for it), and a whole
 * save failure alike — never a stack, and no dismiss button, because closing
 * it would hide the reason the write was refused. The two channels differ by
 * their mark: a field refusal also marks and focuses its field; a save
 * failure touches no field. The mark and the notice both clear when the
 * offending value changes, never on a tap elsewhere.
 *
 * The duplicate rule is NOT here: it is a SELECT on the pair in the store,
 * and its rejection arrives verbatim through the notice slot. The caption's
 * count is the store's COUNT(*) over the same table the registry lists — a
 * typo in the province reads as a wrong count instead of quietly minting a
 * new province. A failed write never navigates: the form keeps every typed
 * value, because navigating shows a save that did not happen.
 */
export function MunicipalityEditor({ onBack, id = null }: MunicipalityEditorProps) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const chrome = municipalityEditorChrome(id);

  const [state, setState] = useState<MunicipalityEditorUiState>(
    initialMunicipalityEditorUiState,
  );
  const [load, setLoad] = useState<LoadState>(id === null ? { kind: 'create' } : { kind: 'loading' });
  const [retryToken, setRetryToken] = useState(0);

  // The edit half's one read. `notFound` is a state of its own: the row is
  // gone, and an empty form would look like a create.
  //
  // No synchronous `setState` here: the state already starts as `loading` for an
  // edit, and the retry path re-enters `loading` from the button's own handler,
  // so the effect only ever answers an external read.
  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    fetchMunicipalityById(id)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setLoad({ kind: 'notFound' });
          return;
        }
        setState(municipalityEditorUiStateFrom(row));
        setLoad({ kind: 'ready' });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, retryToken]);
  const [focusedField, setFocusedField] = useState<MunicipalityEditorField | null>(null);
  // The caption's count, keyed by the province it counted: a keystroke leaves
  // the previous number visible only while it still names the same province,
  // otherwise the instruction stands in — one frame of the honest unknown.
  const [count, setCount] = useState<{ province: string; n: number } | null>(null);
  // The in-flight save guard, readable synchronously: state updates land
  // after the callback returns, so a second tap inside one frame must be
  // refused by a ref, not by the flag in state.
  const savingRef = useRef(false);
  const nameRef = useRef<TextInput>(null);
  const provRef = useRef<TextInput>(null);

  // The count is derived data, fetched per province the moment it is typed.
  // Async only — no synchronous setState, and no loading UI: the instruction
  // sentence is what the caption says until the number arrives.
  useEffect(() => {
    const province = state.province.trim();
    if (province === '') return;
    let cancelled = false;
    countMunicipalitiesInProvince(province).then((n) => {
      if (!cancelled) setCount({ province, n });
    });
    return () => {
      cancelled = true;
    };
  }, [state.province]);

  const editField = useCallback((field: MunicipalityEditorField, value: string) => {
    setState((current) => commitMunicipalityEditorField(current, field, value));
  }, []);

  const onSave = useCallback(() => {
    if (savingRef.current) return; // guard a second save in flight
    if (load.kind !== 'create' && load.kind !== 'ready') return; // nothing readable to write back

    // The prototype's order, one refusal at a time: name empty → name comma
    // → province empty → province comma. The comma is second, not last — it
    // is a structural defect, and no later check can be trusted while the
    // value is ambiguous. The DUPLICATE is the data layer's, checked after.
    const refusal = municipalityEditorValidate({
      name: state.name,
      province: state.province,
    });
    if (refusal !== null) {
      setState((current) => ({
        ...current,
        notice: refusal.message,
        invalid: refusal.field,
      }));
      if (refusal.field === 'name') nameRef.current?.focus();
      else provRef.current?.focus();
      return;
    }

    const name = state.name.trim();
    const province = state.province.trim();
    savingRef.current = true;
    setState((current) => ({ ...current, isSaving: true, notice: null, invalid: null }));

    // One write either way: create INSERTs, edit UPDATEs. Both return the same
    // result shape, so one branch handles the rejection and the failure.
    const write =
      id === null
        ? saveMunicipality(name, province)
        : updateMunicipality({ id, name, province });
    void write.then((result) => {
      savingRef.current = false;
      if (result.kind === 'saved') {
        // The registry's one announcement, consumed once on the other side.
        setScreenFlash(id === null ? `${name} added to ${province}.` : `${name} updated.`);
        onBack();
        return;
      }
      if (result.kind === 'notFound') {
        // The row went away between the read and the write. The form stays put
        // and says so; it must not look like a create that succeeded.
        setState((current) => ({
          ...current,
          isSaving: false,
          notice: 'That municipality is no longer on this device.',
          invalid: null,
        }));
        return;
      }
      // The form, the typed values, and the button all survive. The duplicate
      // rejection takes the file's mark — the name field — because that is
      // the control the driver has to touch; a storage failure marks nothing.
      const rejected = result.kind === 'rejected';
      setState((current) => ({
        ...current,
        isSaving: false,
        notice: rejected ? result.reason : MUNICIPALITY_SAVE_ERROR,
        invalid: rejected ? 'name' : null,
      }));
      if (rejected) nameRef.current?.focus();
    });
  }, [state, onBack, id, load.kind]);

  const hint = useMemo(() => {
    const province = state.province.trim();
    const n = count !== null && count.province === province ? count.n : null;
    return municipalityEditorHint(state.name, province, n);
  }, [state.name, state.province, count]);

  return (
    <View style={styles.screen}>
      <GlassBackdrop />
      <SectionChrome
        title={chrome.title}
        subtitle={chrome.subtitle}
        subtitleTestID="am-sub"
        titleMinHeight={56}
        onBack={onBack}
        insets={insets}
        backLabel={chrome.backLabel}
        testID="am-chrome"
        backTestID="am-back"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'android' ? undefined : 'padding'}
          style={styles.flex}
          pointerEvents="box-none"
        >
          <ScrollView
            contentContainerStyle={[styles.column, { paddingBottom: insets.bottom + space(9) }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* One notice, no dismiss: a validation error is not transient,
                and closing it would hide the reason the write was refused.
                It clears when a value changes — it belonged to that value,
                never to a tap elsewhere on the screen. */}
            {state.notice !== null ? (
              <View testID="am-msg" style={styles.noticeSlot}>
                <View
                  testID="am-banner"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={styles.caution}
                >
                  <Text style={styles.cautionText}>{state.notice}</Text>
                </View>
              </View>
            ) : null}

            {load.kind === 'create' || load.kind === 'ready' ? (
            <View testID="am-form" style={styles.formSection}>
              {/* One card, two fields, the commit — the shared range-card
                  bytes, the same 14px padding add-barangay.html's card
                  carries, the same 12px gap between its fields. */}
              <GlassCard style={styles.formCard}>
                <View style={styles.fields}>
                  <View
                    testID="am-name-wrap"
                    style={[
                      styles.field,
                      focusedField === 'name' && styles.fieldFocused,
                      state.invalid === 'name' && styles.fieldInvalid,
                    ]}
                  >
                    <View style={styles.fieldIcon}>
                      <Icon name="municipality" size={18} color={theme.accent.tertiary.onContainer} />
                    </View>
                    <View style={styles.fieldBody}>
                      <Text style={styles.fieldLabel}>Municipality</Text>
                      <TextInput
                        ref={nameRef}
                        testID="am-name"
                        value={state.name}
                        onChangeText={(text) => editField('name', text)}
                        // ENTER submits from either input — this screen's one commit.
                        onSubmitEditing={onSave}
                        placeholder="e.g. San Jose"
                        placeholderTextColor={theme.palette.outline}
                        maxLength={60}
                        autoComplete="off"
                        autoCorrect={false}
                        editable={!state.isSaving}
                        onFocus={() => setFocusedField('name')}
                        onBlur={() => setFocusedField(null)}
                        accessibilityLabel={`Municipality name${
                          state.invalid === 'name' ? ', invalid' : ''
                        }`}
                        style={styles.fieldInput}
                      />
                    </View>
                  </View>

                  <View
                    testID="am-prov-wrap"
                    style={[
                      styles.field,
                      focusedField === 'province' && styles.fieldFocused,
                      state.invalid === 'province' && styles.fieldInvalid,
                    ]}
                  >
                    <View style={styles.fieldIcon}>
                      <Icon name="pin" size={18} color={theme.accent.tertiary.onContainer} />
                    </View>
                    <View style={styles.fieldBody}>
                      <Text style={styles.fieldLabel}>Province</Text>
                      <TextInput
                        ref={provRef}
                        testID="am-prov"
                        value={state.province}
                        onChangeText={(text) => editField('province', text)}
                        onSubmitEditing={onSave}
                        placeholder="e.g. Bulacan"
                        placeholderTextColor={theme.palette.outline}
                        maxLength={60}
                        autoComplete="off"
                        autoCorrect={false}
                        editable={!state.isSaving}
                        onFocus={() => setFocusedField('province')}
                        onBlur={() => setFocusedField(null)}
                        accessibilityLabel={`Province${
                          state.invalid === 'province' ? ', invalid' : ''
                        }`}
                        style={styles.fieldInput}
                      />
                    </View>
                  </View>
                </View>

                {/* The screen's ONE solid primary, 48px, same column as the
                    fields, 20px under the last — the only filled block here. */}
                <Pressable
                  testID="am-save"
                  onPress={onSave}
                  disabled={state.isSaving}
                  accessibilityRole="button"
                  accessibilityLabel="Save municipality"
                  accessibilityState={{ disabled: state.isSaving, busy: state.isSaving }}
                  style={({ pressed }) => [
                    styles.save,
                    state.isSaving && styles.saveBusy,
                    pressed && !state.isSaving && styles.pressed,
                  ]}
                >
                  <Text style={styles.saveLabel}>{chrome.saveLabel}</Text>
                </Pressable>
              </GlassCard>

              {/* The screen's only count, `.range-caption`: 10px below the
                  card — the one gap here that is not 12 or 20, the family's
                  caption margin. The province field points readers here; the
                  composed pair is spoken from this line. */}
              <Text
                testID="am-provhint"
                style={styles.hint}
                accessibilityLiveRegion="polite"
              >
                {hint}
              </Text>
            </View>
            ) : (
              /* The edit half's read. `notFound` is its own sentence — a row
                 that is gone must not look like a form nobody filled in. */
              <View testID="am-state" style={styles.formSection}>
                <GlassCard style={styles.formCard}>
                  <Text style={styles.stateTitle}>
                    {load.kind === 'loading'
                      ? 'Reading the municipality'
                      : load.kind === 'notFound'
                        ? 'That municipality is no longer on this device.'
                        : 'The municipality could not be read.'}
                  </Text>
                  <Text style={styles.stateBody}>
                    {load.kind === 'loading'
                      ? 'It is stored on this device.'
                      : load.kind === 'notFound'
                        ? 'It may have been removed from another screen. Nothing else on this device was changed.'
                        : 'Nothing was lost. The record is still on this device, and reading it again is safe.'}
                  </Text>
                  {load.kind === 'error' ? (
                    <Pressable
                      testID="am-retry"
                      onPress={() => {
                        setLoad({ kind: 'loading' });
                        setRetryToken((token) => token + 1);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Read the municipality again"
                      style={({ pressed }) => [styles.stateRetry, pressed && styles.pressed]}
                    >
                      <Text style={styles.stateRetryLabel}>Read it again</Text>
                    </Pressable>
                  ) : null}
                </GlassCard>
              </View>
            )}

            <GlassCard
              testID="am-storage"
              style={styles.noteLock}
              accessible
              accessibilityLabel="Offline storage. The record is saved on this device and works offline."
            >
              <Icon name="lock" size={18} color={theme.glass.onGlassVariant} />
              <View style={styles.noteLockBody}>
                <Text style={styles.noteLockLabel}>OFFLINE STORAGE</Text>
                <Text style={styles.noteLockText}>
                  The record is saved on this device and works offline.
                </Text>
              </View>
            </GlassCard>
          </ScrollView>
        </KeyboardAvoidingView>
      </SectionChrome>
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.88 },
  screen: { flex: 1, backgroundColor: theme.glass.backdrop },

  // ONE column, ONE gutter — the same inset the registry above it uses.
  column: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: space(5),
    paddingTop: space(5),
  },

  // ── the notice: one slot for every refusal ──
  noticeSlot: { marginTop: space(4) },
  caution: {
    paddingVertical: space(3),
    paddingHorizontal: space(4),
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: theme.palette.outlineVariant,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)',
  },
  cautionText: { ...type.bodySmall, color: theme.glass.onGlassVariant },

  // ── the form card ──
  formSection: { marginTop: space(5) },
  // 14px, the shared range-card's own padding — the same bytes hold this
  // screen's fields and the registry's rows; re-padding splits the family.
  formCard: { padding: 14 },
  // 12px, same stack as add-barangay's `.ab-fields`: two rows, one gap.
  fields: { gap: space(3) },
  field: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.palette.outline,
    borderRadius: radius.large,
    backgroundColor: theme.palette.surface,
  },
  // Focus changes the border's colour only — never a width change that
  // would reflow the field under the caret.
  fieldFocused: { borderColor: theme.palette.primary },
  fieldInvalid: { borderColor: theme.palette.error },
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
  fieldInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    ...type.bodyMedium,
    fontFamily: 'Poppins_600SemiBold',
    color: theme.palette.onSurface,
    // The wrapper carries the focus ring, exactly as the prototype's
    // `input { outline: none }` does — one ring, never two.
    outlineWidth: 0,
  },

  // ── the one commit ──
  // 20px, not the 14px a primary button might ship: the screen's one
  // irreversible write, on the 4px grid, 20 below the last field.
  save: {
    minHeight: 48,
    marginTop: space(5),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  saveBusy: { opacity: 0.65 },
  saveLabel: { ...type.labelLarge, color: onPrimarySolid, letterSpacing: 0.8 },

  // ── the edit half's read states ──
  stateTitle: { ...type.titleMedium, color: theme.palette.onSurface },
  stateBody: { ...type.bodySmall, color: theme.glass.onGlassVariant, marginTop: space(2) },
  stateRetry: {
    marginTop: space(4),
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: theme.palette.outline,
  },
  stateRetryLabel: { ...type.labelLarge, color: theme.palette.onSurface },

  // ── the caption, 10 below the card — `.range-caption`'s own margin ──
  hint: {
    ...type.bodySmall,
    color: theme.glass.onGlassVariant,
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
  noteLockLabel: { ...type.labelSmall, color: theme.glass.onGlassVariant },
  noteLockText: { ...type.bodySmall, color: theme.glass.onGlassVariant, marginTop: space(1) },
});
