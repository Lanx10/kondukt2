import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { GlassCard } from '../components/GlassCard';
import { SectionChrome } from '../components/SectionChrome';
import { Icon } from '../icons';
import {
  amberSurface,
  cardShadowFor,
  onAmber,
  onPrimarySolid,
  radius,
  space,
  type,
  type KonduktTheme,
} from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import {
  fetchFareConfiguration,
  saveFareConfiguration,
  subscribeToFareStore,
} from '../data/fareStore';
import {
  FARE_FIELDS,
  SCALE_KM,
  SCALE_PESO,
  applyFareInputFilter,
  fareTextFromStored,
  parseScaled,
  toStoredFareValues,
  validateFareFields,
  type FareFieldDef,
  type FareFieldErrors,
  type FareFieldKey,
  type FareValues,
} from '../lib/fareFormat';
import { formatKm, formatPeso, formatRate, priceTicket, type FareRules } from '../lib/addTicketFare';
import { plural } from '../lib/currentTripState';
import { loadDeluxeEnabled, saveDeluxeEnabled } from '../lib/preferences';

export type FareSettingsScreenProps = {
  onBack: () => void;
};

/**
 * The fare configuration screen — a port of `fare-config.html`.
 *
 * The reference's shape, in order:
 *
 *   1. WHAT IT COSTS — a live price at two distances, so the two floors are
 *      observable on a form whose other nine numbers only scale;
 *   2. one banner — a count and the list of which fields, never a queue;
 *   3. MINIMUM CHARGES — the two floors, side by side;
 *   4. FARE PER KM — the 2×2 the schema already is (ordinary road × express
 *      way, Regular × Deluxe), with the Deluxe switch in the section head;
 *   5. DISCOUNTED FARE PER KM — the same 2×2 for PWD, Student and Senior;
 *   6. the storage note — a lock and a sentence, deliberately not a card;
 *   7. a fixed action bar: the one solid primary, and the reason it is live
 *      or dead printed under it.
 *
 * ── What this port keeps from the shipped screen ───────────────────────────
 *
 * The save path is the app's: values are strings, converted at save time,
 * `withTollFallbacks` seats the four express columns from their ordinary
 * counterparts when nothing usable is there, and the Deluxe switch is a
 * preference that applies on tap. What changed is the interface: all ten
 * fields the reference shows are shown (the express columns charge real
 * express-way trips — `priceTicket` picks them), validation counts only the
 * fields the switch leaves active, and every white card is the shared
 * `GlassCard`.
 */

/** The example run the preview prices — the reference's own corridor. */
const SAMPLE_TRIP = { caption: 'Iba → Caloocan · 217.4 km · Express way', distanceMilli: 217_400 };
/** The short hop: inside the minimum distance, so the minimum fare binds. */
const SAMPLE_HOP = { label: 'Cubao → Meycauayan', distanceMilli: 3_200 };

/** The six numbers `priceTicket` reads (the calculator's own inputs). */
const CALC_KEYS: FareFieldKey[] = [
  'minimumFare',
  'minimumDistance',
  'ratePerKm',
  'expressRatePerKm',
  'specialRate',
  'specialExpressRate',
];

/** The four rates the Deluxe switch switches off — and nothing charges them. */
const DELUXE_KEYS: FareFieldKey[] = [
  'deluxeRatePerKm',
  'expressDeluxeRatePerKm',
  'specialDeluxeRate',
  'specialExpressDeluxeRate',
];

/** Every key on the form, in the reference's (and the validator's) order. */
const VISIBLE_KEYS: FareFieldKey[] = FARE_FIELDS.map((field) => field.key);

const FIELD_BY_KEY = new Map(FARE_FIELDS.map((field) => [field.key, field]));

const EMPTY_VALUES: FareValues = FARE_FIELDS.reduce((acc, field) => {
  acc[field.key] = '';
  return acc;
}, {} as FareValues);

const readPeso = (text: string) => parseScaled(text, SCALE_PESO) ?? 0;

const FLOORS_NOTE =
  'A trip shorter than the lowest distance is billed as if the bus travelled that far, and if the total still comes to less than the lowest fare, the lowest fare is charged instead. That order never changes.';

type CellSpec = { key: FareFieldKey; unit: string; testID: string };
type MxRowSpec = { label: string; cells: CellSpec[] };

const FLOOR_FIELDS: { label: string; cell: CellSpec }[] = [
  { label: 'Lowest fare', cell: { key: 'minimumFare', unit: 'PHP', testID: 'fc-min-fare' } },
  { label: 'Lowest distance', cell: { key: 'minimumDistance', unit: 'km', testID: 'fc-min-dist' } },
];

/** The four rates, as the 2×2 the schema already is. */
const RATE_ROWS: MxRowSpec[] = [
  {
    label: 'Regular',
    cells: [
      { key: 'ratePerKm', unit: 'PHP', testID: 'fc-rate-ord' },
      { key: 'expressRatePerKm', unit: 'PHP', testID: 'fc-rate-sctex' },
    ],
  },
  {
    label: 'Deluxe',
    cells: [
      { key: 'deluxeRatePerKm', unit: 'PHP', testID: 'fc-rate-deluxe' },
      { key: 'expressDeluxeRatePerKm', unit: 'PHP', testID: 'fc-rate-deluxe-sctex' },
    ],
  },
];

/** The same 2×2 for the discounted fares — same shape, same words. */
const CONCESSION_ROWS: MxRowSpec[] = [
  {
    label: 'Regular',
    cells: [
      { key: 'specialRate', unit: 'PHP', testID: 'fc-conc-ord' },
      { key: 'specialExpressRate', unit: 'PHP', testID: 'fc-conc-express' },
    ],
  },
  {
    label: 'Deluxe',
    cells: [
      { key: 'specialDeluxeRate', unit: 'PHP', testID: 'fc-conc-deluxe' },
      { key: 'specialExpressDeluxeRate', unit: 'PHP', testID: 'fc-conc-deluxe-express' },
    ],
  },
];

/**
 * Fills the four express rates from their ordinary counterparts when the form
 * has nothing usable there.
 *
 * Two jobs at once: a fresh device validates and saves without the four
 * invisible-at-typing fields blocking it, and a device whose row predates the
 * express-way columns keeps charging what it always charged instead of a zero.
 */
function withTollFallbacks(values: FareValues): FareValues {
  const seated: [FareFieldKey, FareFieldKey][] = [
    ['expressRatePerKm', 'ratePerKm'],
    ['expressDeluxeRatePerKm', 'deluxeRatePerKm'],
    ['specialExpressRate', 'specialRate'],
    ['specialExpressDeluxeRate', 'specialDeluxeRate'],
  ];
  const next = { ...values };
  for (const [toll, ordinary] of seated) {
    if (parseScaled(next[toll], SCALE_PESO) === null) next[toll] = values[ordinary];
  }
  return next;
}

/** The two distances the preview prices, and the passenger types it reports. */
const FIGURES = [
  { label: 'REGULAR', type: 'REGULAR' as const },
  { label: 'PWD, STUDENT, SENIOR', type: 'STUDENT' as const },
];

export function FareSettingsScreen({ onBack }: FareSettingsScreenProps) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  // All ten editable values are strings. A number-bound field cannot hold a
  // decimal point mid-typing; strings convert only at save time.
  const [values, setValues] = useState<FareValues>(EMPTY_VALUES);
  const [deluxeEnabled, setDeluxeEnabled] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<FareFieldErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load-once guard: the first non-null emission populates; later emissions are
  // ignored, so an external write can never clobber in-progress typing.
  const [farePopulated, setFarePopulated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      fetchFareConfiguration()
        .then(({ fare }) => {
          if (cancelled) return;
          setIsLoading(false);
          setValues((current) => {
            if (fare && !farePopulated) {
              setFarePopulated(true);
              return { ...current, ...fareTextFromStored(fare) };
            }
            return current;
          });
        })
        .catch(() => {
          if (!cancelled) {
            setIsLoading(false);
            setLoadError(
              'The stored fare configuration could not be read, so there is nothing to edit here. Nothing on this device has been changed.',
            );
          }
        });
    run();
    const unsubscribe = subscribeToFareStore(() => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [farePopulated]);

  // The Deluxe switch is a preference, not a fare: it applies on tap, like the
  // theme toggle in Advanced Settings, and never joins the dirty count.
  useEffect(() => {
    let cancelled = false;
    void loadDeluxeEnabled().then((stored) => {
      if (!cancelled && stored !== null) setDeluxeEnabled(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const editField = useCallback((key: FareFieldKey, rawText: string) => {
    setValues((current) => {
      const filtered = applyFareInputFilter(current[key], rawText);
      if (filtered === current[key]) return current;
      return { ...current, [key]: filtered };
    });
    // First keystroke anywhere marks the form dirty and clears any message.
    setHasChanges(true);
    setFieldErrors({});
    setSaveError(null);
    setSuccessMessage(null);
  }, []);

  const onToggleDeluxe = useCallback(() => {
    const next = !deluxeEnabled;
    setDeluxeEnabled(next);
    // The set of fields that count just changed; stale errors on the rows the
    // switch took away would keep a banner up over fields that no longer fail.
    setFieldErrors({});
    setSuccessMessage(null);
    setSaveError(null);
    void saveDeluxeEnabled(next).then((written) => {
      if (!written) {
        // The switch must not show a state the device did not keep.
        setDeluxeEnabled(!next);
        setSaveError('Unable to save the Deluxe setting.');
      }
    });
  }, [deluxeEnabled]);

  /**
   * The fields the switch leaves on. Everything the reference counts — filled,
   * blank, wrong, live — runs off this and only this, so a disabled Deluxe
   * field is not merely greyed: it is not a field.
   */
  const activeKeys = useMemo(
    () => (deluxeEnabled ? VISIBLE_KEYS : VISIBLE_KEYS.filter((key) => !DELUXE_KEYS.includes(key))),
    [deluxeEnabled],
  );

  const onSave = useCallback(() => {
    if (isSaving) return; // guard against a second save in flight
    const payload = withTollFallbacks(values);
    const errors = validateFareFields(payload);
    // Only the active fields may block the save: a Deluxe row the switch took
    // off is not a field, and refusing to save because of one is a screen that
    // cannot be left (the reference's own argument).
    const named: FareFieldErrors = {};
    if (errors !== null) {
      for (const key of activeKeys) {
        const message = errors[key];
        if (message) named[key] = message;
      }
    }
    if (Object.keys(named).length > 0) {
      setFieldErrors(named);
      setSuccessMessage(null);
      setSaveError(null);
      return;
    }
    setFieldErrors({});
    setIsSaving(true);
    setSuccessMessage(null);
    setSaveError(null);
    const stored = toStoredFareValues(payload);
    void saveFareConfiguration({
      minimum_fare: stored.minimumFare,
      minimum_distance_milli: stored.minimumDistance,
      rate_per_km: stored.ratePerKm,
      deluxe_rate_per_km: stored.deluxeRatePerKm,
      special_rate_per_km: stored.specialRate,
      express_rate_per_km: stored.expressRatePerKm,
      express_deluxe_rate_per_km: stored.expressDeluxeRatePerKm,
      special_express_rate_per_km: stored.specialExpressRate,
      special_deluxe_rate_per_km: stored.specialDeluxeRate,
      special_express_deluxe_rate_per_km: stored.specialExpressDeluxeRate,
    }).then((committed) => {
      setIsSaving(false);
      if (committed) {
        // Dirty clears only here. The typed text is NOT reformatted — the user
        // keeps exactly what they typed.
        setHasChanges(false);
        setSaveError(null);
        setSuccessMessage('Fare configuration saved.');
      } else {
        setHasChanges(true);
        setSuccessMessage(null);
        setSaveError('Unable to save fare configuration.');
      }
    });
  }, [activeKeys, isSaving, values]);

  /** The calculator's own inputs, read from the form rather than from storage. */
  const rules = useMemo<FareRules>(() => {
    const seated = withTollFallbacks(values);
    return {
      minimumFareCentavos: readPeso(values.minimumFare),
      minimumDistanceMilli: parseScaled(values.minimumDistance, SCALE_KM) ?? 0,
      ratePerKmCentavos: readPeso(values.ratePerKm),
      expressRatePerKmCentavos: readPeso(seated.expressRatePerKm),
      specialRatePerKmCentavos: readPeso(values.specialRate),
      specialExpressRatePerKmCentavos: readPeso(seated.specialExpressRate),
    };
  }, [values]);

  const priceAt = useCallback(
    (distanceMilli: number, usesExpressWay: boolean, passengerType: 'REGULAR' | 'STUDENT') =>
      priceTicket({
        distanceMilli,
        usesExpressWay,
        passengerType,
        quantity: 1,
        rules,
      }),
    [rules],
  );

  /** The chrome's count, and the live errors the save reason is built from. */
  const filledCount = useMemo(
    () => activeKeys.filter((key) => String(values[key]).trim() !== '').length,
    [activeKeys, values],
  );
  const total = activeKeys.length;

  const liveErrors = useMemo(() => {
    const found = validateFareFields(withTollFallbacks(values));
    if (found === null) return [] as FareFieldDef[];
    return FARE_FIELDS.filter((field) => activeKeys.includes(field.key) && found[field.key]);
  }, [activeKeys, values]);

  const errorCount = Object.keys(fieldErrors).length;

  /**
   * The one transient message: exactly one, never queued. The saved string is
   * the app's own; the failed one gains the count and the list, which is what
   * ten scattered red lines do not have.
   */
  const banner = useMemo(() => {
    if (successMessage !== null) {
      return (
        <View style={styles.banner} accessibilityLiveRegion="polite" testID="fc-banner">
          <Text style={styles.bannerLead}>{successMessage}</Text>
        </View>
      );
    }
    if (errorCount > 0) {
      return (
        <View style={styles.banner} accessibilityLiveRegion="polite" testID="fc-banner">
          <Text style={[styles.bannerLead, styles.bannerLeadBad]}>Nothing was saved.</Text>
          <Text style={styles.bannerCount}>
            {plural(errorCount, 'field is', 'fields are')} blank or wrong. Nothing is saved unless
            every field is right.
          </Text>
          {FARE_FIELDS.filter((field) => fieldErrors[field.key]).map((field) => (
            <Text key={field.key} style={styles.bannerItem}>
              <Text style={styles.bannerItemName}>{field.label}</Text>
              {'  '}
              {fieldErrors[field.key]}
            </Text>
          ))}
        </View>
      );
    }
    if (saveError !== null) {
      return (
        <View style={styles.banner} accessibilityLiveRegion="polite" testID="fc-banner">
          <Text style={[styles.bannerLead, styles.bannerLeadBad]}>{saveError}</Text>
        </View>
      );
    }
    return null;
  }, [errorCount, fieldErrors, saveError, successMessage, styles]);

  /**
   * What the count under the button says, and why it is live or dead —
   * "still empty" and "needs fixing" are different sentences, and a fresh
   * device deserves the first: nothing is wrong, ten things are missing.
   */
  const saveReason = useMemo(() => {
    if (liveErrors.length > 0) {
      const allBlank = liveErrors.every((field) => String(values[field.key]).trim() === '');
      const what = allBlank
        ? plural(liveErrors.length, 'field is still empty.', 'fields are still empty.')
        : plural(liveErrors.length, 'field needs fixing.', 'fields need fixing.');
      // The prefix rides only when a save was actually refused — before the
      // first press, nothing has failed yet.
      return (errorCount > 0 || saveError !== null ? 'Not saved. ' : '') + what;
    }
    if (!hasChanges) return 'No changes to save yet.';
    return '';
  }, [errorCount, hasChanges, liveErrors, saveError, values]);

  const saveEnabled =
    !isLoading && loadError === null && !isSaving && (hasChanges || liveErrors.length > 0);

  // The price. Derived from the live field text on every keystroke, so it
  // moves while the conductor types and cannot fight them the way a second
  // store subscription could.
  const blankCalc = useMemo(
    () =>
      CALC_KEYS.filter(
        (key) => parseScaled(values[key], FIELD_BY_KEY.get(key)?.scale ?? SCALE_PESO) === null,
      ),
    [values],
  );

  const hop = blankCalc.length === 0 ? priceAt(SAMPLE_HOP.distanceMilli, false, 'REGULAR') : null;

  const previewNote = useMemo(() => {
    if (blankCalc.length > 0) {
      // The four Deluxe rates are the only values here the app never charges
      // from, so the note has to name them: otherwise a conductor who has typed
      // every number that counts and still has no price has no way to learn why.
      return deluxeEnabled
        ? 'Not the four Deluxe fares — nothing uses those yet.'
        : 'Deluxe is off, so its four fares are not part of this count either way.';
    }
    // The note exists because the two minimums are the only numbers on this
    // screen that bind rather than scale. It states the rule in the words a
    // conductor would use: flat minimum fare inside the minimum distance,
    // distance times the rate past it.
    const how =
      `Every fare is worked out the same way: up to ` +
      `${formatKm(rules.minimumDistanceMilli)} the fare is the flat ` +
      `${formatPeso(rules.minimumFareCentavos)}, past that it is the distance times the rate.`;
    if (hop && hop.distanceFloorApplied) {
      return (
        `${how} ${SAMPLE_HOP.label} is only ${formatKm(SAMPLE_HOP.distanceMilli)}, within ` +
        `that minimum distance, so ${formatPeso(hop.perPassengerCentavos)} is charged.`
      );
    }
    return how;
  }, [blankCalc.length, deluxeEnabled, hop, rules]);

  const subtitle = isLoading
    ? 'Reading your saved fares'
    : loadError !== null
      ? 'Saved fares unavailable'
      : errorCount > 0
        ? `${plural(errorCount, 'field needs', 'fields need')} fixing`
        : `${filledCount} of ${total} filled in`;

  const body = useMemo(() => {
    if (isLoading) {
      return (
        <View style={styles.centerBlock} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.palette.primary} />
          <Text style={styles.centerTitle}>Loading fare settings</Text>
          <Text style={styles.centerText}>Reading the local fare configuration.</Text>
        </View>
      );
    }
    if (loadError !== null) {
      return (
        <View style={styles.centerBlock} accessibilityLiveRegion="polite">
          <Text style={styles.centerTitle} accessibilityRole="header">
            Fare settings unavailable
          </Text>
          <Text style={styles.centerText}>{loadError}</Text>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back to settings"
            style={({ pressed }) => [styles.goBackButton, pressed && styles.pressed]}
          >
            <Text style={styles.goBackLabel}>GO BACK</Text>
          </Pressable>
        </View>
      );
    }
    return null;
  }, [isLoading, loadError, onBack, styles, theme]);

  return (
    <View style={styles.screen}>
      <SectionChrome
        title="FARE CONFIGURATION"
        subtitle={subtitle}
        titleMinHeight={56}
        insets={insets}
        onBack={onBack}
        // The previous screen is Settings, so the label names it.
        backLabel="Back to settings"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'android' ? undefined : 'padding'}
          style={styles.flex}
          pointerEvents="box-none"
        >
          {body ?? (
            <>
              <ScrollView
                contentContainerStyle={[
                  styles.column,
                  // The action bar is a sibling now, so the scroll's own tail
                  // is just the gutter.
                  { paddingBottom: space(5) },
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                // No rubber-band past the last card, and no glow on Android.
                bounces={false}
                overScrollMode="never"
              >
                {/* 1. What it costs. The reference leads with the answer, not
                    the inputs: the conductor set these numbers to charge a
                    fare, and this is the fare. Two distances, because the two
                    floors bind on the short one and never on the long one. */}
                <View style={styles.preview} testID="fc-preview">
                  <View style={styles.previewHead}>
                    <Text
                      style={styles.eyebrow}
                      accessibilityRole="header"
                      accessibilityLabel="WHAT IT COSTS"
                    >
                      WHAT IT COSTS
                    </Text>
                    <Text style={styles.previewCaption}>{SAMPLE_TRIP.caption}</Text>
                  </View>
                  {blankCalc.length === 0 ? (
                    <View style={styles.previewFigures}>
                      {FIGURES.map((figure) => {
                        const priced = priceAt(SAMPLE_TRIP.distanceMilli, true, figure.type);
                        if (!priced) return null;
                        return (
                          <View key={figure.type} style={styles.previewFigure}>
                            <Text style={styles.previewLabel}>{figure.label}</Text>
                            <Text style={styles.previewValue}>
                              {formatPeso(priced.perPassengerCentavos)}
                            </Text>
                            <Text style={styles.previewSub}>
                              {`${formatRate(priced.rateCentavos)} / km → ${formatKm(
                                priced.billableMilli,
                              )}${figure.type === 'STUDENT' ? ', express way rate' : ''}`}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <View style={styles.previewBlank}>
                      <Text style={styles.previewValueNone}>No fare to show yet</Text>
                      <Text style={styles.previewSub}>
                        {blankCalc.length === 1
                          ? `One of the ${CALC_KEYS.length} numbers a fare is worked out from is still empty.`
                          : `${blankCalc.length} of the ${CALC_KEYS.length} numbers a fare is worked out from are still empty.`}
                      </Text>
                    </View>
                  )}
                  {/* The short hop is the second distance the price card
                      prints: 3.2 km sits inside the minimum distance, so it is
                      the only row on the screen that shows the floor binding. */}
                  {hop ? (
                    <View style={styles.previewGap}>
                      <Row
                        label={`${SAMPLE_HOP.label}, ${formatKm(
                          SAMPLE_HOP.distanceMilli,
                        )}, ordinary road`}
                        value={`${formatPeso(hop.perPassengerCentavos)}${
                          hop.fareFloorApplied ? ' lowest fare' : ''
                        }`}
                      />
                    </View>
                  ) : null}
                  <Text style={styles.previewNote}>{previewNote}</Text>
                </View>

                {/* 2. One banner: a count and the list of which fields. */}
                {banner}

                {/* 3. The two floors — the only two numbers here that do not
                    scale with distance, and the only two with an order. */}
                <View>
                  <View style={styles.secHead}>
                    <Text
                      style={styles.sectionHeading}
                      accessibilityRole="header"
                      accessibilityLabel="MINIMUM CHARGES"
                    >
                      MINIMUM CHARGES
                    </Text>
                  </View>
                  <GlassCard style={styles.sectionCard}>
                    <View style={styles.fxGrid}>
                      {FLOOR_FIELDS.map(({ label, cell }) => {
                        const def = FIELD_BY_KEY.get(cell.key);
                        if (!def) return null;
                        return (
                          <View key={cell.key} style={styles.fxCell}>
                            <Field
                              field={def}
                              label={label}
                              unit={cell.unit}
                              testID={cell.testID}
                              value={values[cell.key]}
                              error={fieldErrors[cell.key] ?? null}
                              disabled={isSaving}
                              off={false}
                              onChangeText={(text) => editField(cell.key, text)}
                            />
                          </View>
                        );
                      })}
                    </View>
                    <Text style={styles.sectionNote}>{FLOORS_NOTE}</Text>
                  </GlassCard>
                </View>

                {/* 4. The four rates, as the 2×2 the schema already is. The
                    switch rides in the head of the grid it belongs to. */}
                <View>
                  <View style={styles.secHead}>
                    <Text
                      style={styles.sectionHeading}
                      accessibilityRole="header"
                      accessibilityLabel="FARE PER KM"
                    >
                      FARE PER KM
                    </Text>
                    <Pressable
                      onPress={onToggleDeluxe}
                      accessibilityRole="switch"
                      accessibilityLabel="Deluxe fares"
                      accessibilityState={{ checked: deluxeEnabled }}
                      testID="fc-deluxe-toggle"
                      style={({ pressed }) => [
                        styles.dtToggle,
                        deluxeEnabled && styles.dtToggleOn,
                        pressed && styles.dtPressed,
                      ]}
                    >
                      <Text
                        style={[styles.dtLabel, deluxeEnabled && styles.dtLabelOn]}
                      >
                        DELUXE
                      </Text>
                      <View style={[styles.dtState, deluxeEnabled && styles.dtStateOn]}>
                        <Text style={deluxeEnabled ? styles.dtStateOnText : styles.dtStateText}>
                          {deluxeEnabled ? 'ON' : 'OFF'}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                  <GlassCard style={styles.sectionCard}>
                    <MatrixGrid
                      rows={RATE_ROWS}
                      values={values}
                      fieldErrors={fieldErrors}
                      disabled={isSaving}
                      deluxeEnabled={deluxeEnabled}
                      onEdit={editField}
                    />
                    <Text style={styles.sectionNote}>
                      {'Read the two the app charges from, down the Regular row. Both are multiplied by the distance, so an express way trip is always the more expensive half. '}
                      {deluxeEnabled
                        ? 'The Deluxe row is saved with the rest but nothing charges from it yet.'
                        : 'Deluxe is off: those two rates are not read, not counted and not saved while it is.'}
                    </Text>
                  </GlassCard>
                </View>

                {/* 5. The same 2×2 again, for the discounted fares. The rows
                    and columns are named identically on purpose: an operator
                    setting both should not have to re-learn the shape
                    halfway down the screen. */}
                <View>
                  <View style={styles.secHead}>
                    <Text
                      style={styles.sectionHeading}
                      accessibilityRole="header"
                      accessibilityLabel="DISCOUNTED FARE PER KM"
                    >
                      DISCOUNTED FARE PER KM
                    </Text>
                  </View>
                  <GlassCard style={styles.sectionCard}>
                    <MatrixGrid
                      rows={CONCESSION_ROWS}
                      values={values}
                      fieldErrors={fieldErrors}
                      disabled={isSaving}
                      deluxeEnabled={deluxeEnabled}
                      onEdit={editField}
                    />
                    <Text style={styles.sectionNote}>
                      {'PWD, Student and Senior passengers all use these four, between them. Each one is the whole discounted rate, not a reduction of the fare above it, so the column is chosen by the road the trip runs on. '}
                      {deluxeEnabled
                        ? 'The Deluxe row is saved with the rest and nothing charges from it yet, for the same reason as the row above.'
                        : 'Deluxe is off here too — the switch on the grid above covers both grids.'}
                    </Text>
                  </GlassCard>
                </View>

                {/* 6. The offline statement is metadata, not a module: it
                    loses the card and keeps the lock and the copy. */}
                <View style={styles.noteLock} testID="fc-storage">
                  <Icon name="lock" size={16} color={theme.glass.onGlassVariant} />
                  <View style={styles.noteLockText}>
                    <Text style={styles.noteLabel}>SAVED ON THIS DEVICE</Text>
                    <Text style={styles.noteBody}>
                      Your fares are saved on this device and keep working without internet.
                    </Text>
                  </View>
                </View>
              </ScrollView>

              {/* 7. A sibling of the scroll, so it never scrolls away: the
                  one committing action, and the reason it is live or dead. */}
              <View
                style={[styles.actionBar, { paddingBottom: insets.bottom + space(9) }]}
              >
                <Pressable
                  onPress={saveEnabled ? onSave : undefined}
                  disabled={!saveEnabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Save. ${saveReason || 'The configuration is valid as it stands.'}`}
                  accessibilityState={{ disabled: !saveEnabled, busy: isSaving }}
                  testID="fc-save"
                  style={({ pressed }) => [
                    styles.saveBtn,
                    !saveEnabled && styles.saveBtnIdle,
                    pressed && saveEnabled && styles.pressed,
                  ]}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color={onPrimarySolid} />
                  ) : (
                    <Icon
                      name="contentSave"
                      size={20}
                      color={saveEnabled ? onPrimarySolid : theme.palette.onSurfaceVariant}
                    />
                  )}
                  <Text style={saveEnabled ? styles.saveLabel : styles.saveLabelIdle}>
                    {isSaving ? 'SAVING…' : 'SAVE'}
                  </Text>
                </Pressable>
                <Text style={styles.saveCount} testID="fc-save-count">
                  {saveReason}
                </Text>
              </View>
            </>
          )}
        </KeyboardAvoidingView>
      </SectionChrome>
    </View>
  );
}

/** One label/value line in the preview card's hop row. */
function Row({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewRowLabel}>{label}</Text>
      <Text style={styles.previewRowValue}>{value}</Text>
    </View>
  );
}

/**
 * One input: its label above it (when the caller has one — a matrix cell is
 * named by its aria-label instead), the field, the unit inside it, the error
 * under it. The reference's `.fx`, with the ordinary/express columns where
 * this system charges them.
 */
function Field({
  field,
  label,
  unit,
  value,
  error,
  disabled,
  off,
  testID,
  onChangeText,
}: {
  field: FareFieldDef;
  label?: string;
  unit: string;
  value: string;
  error: string | null;
  disabled: boolean;
  off: boolean;
  testID?: string;
  onChangeText: (text: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const base = label ?? field.label;
  return (
    <View style={styles.fx}>
      {label !== undefined ? (
        <Text style={[styles.fxLabel, off && styles.dimmed]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.fxWrap,
          error !== null && styles.fxWrapBad,
          off && styles.fxWrapOff,
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          accessibilityLabel={`${base}${
            error !== null ? ', invalid' : off ? ', Deluxe fares are off' : ''
          }`}
          accessibilityValue={{ text: value === '' ? 'Empty' : value }}
          editable={!disabled && !off}
          testID={testID}
          style={[styles.fxIn, error !== null && styles.fxInBad, off && styles.fxInOff]}
        />
        <Text style={[styles.fxUnit, error !== null && styles.fxInBad, off && styles.fxUnitOff]}>
          {unit}
        </Text>
      </View>
      {error !== null ? <Text style={styles.fxErr}>{error}</Text> : null}
    </View>
  );
}

/** The 2×2: two roads across, Regular and Deluxe down, one grid, two of them. */
function MatrixGrid({
  rows,
  values,
  fieldErrors,
  disabled,
  deluxeEnabled,
  onEdit,
}: {
  rows: MxRowSpec[];
  values: FareValues;
  fieldErrors: FareFieldErrors;
  disabled: boolean;
  deluxeEnabled: boolean;
  onEdit: (key: FareFieldKey, text: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.mx}>
      <View style={styles.mxHeadRow}>
        <View style={styles.mxLabelSlot} />
        <Text style={styles.mxHead}>ORDINARY ROAD</Text>
        <Text style={styles.mxHead}>EXPRESS WAY</Text>
      </View>
      {rows.map((row) => {
        const rowOff = !deluxeEnabled && row.cells.every((cell) => DELUXE_KEYS.includes(cell.key));
        return (
          <View key={row.label} style={styles.mxRow}>
            <Text style={[styles.mxRowLabel, rowOff && styles.dimmed]}>{row.label}</Text>
            {row.cells.map((cell) => {
              const def = FIELD_BY_KEY.get(cell.key);
              if (!def) return null;
              return (
                <View key={cell.key} style={styles.fxCell}>
                  <Field
                    field={def}
                    unit={cell.unit}
                    testID={cell.testID}
                    value={values[cell.key]}
                    error={fieldErrors[cell.key] ?? null}
                    disabled={disabled}
                    off={rowOff}
                    onChangeText={(text) => onEdit(cell.key, text)}
                  />
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.88 },
  screen: { flex: 1 },
  dimmed: { opacity: 0.55 },

  column: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: space(4),
    paddingTop: space(2),
    gap: space(5),
  },

  // ── the preview ─────────────────────────────────────────────────────────
  //
  // SOLID AMBER, and deliberately the one card on this screen that is not
  // glass: it is the screen's answer, and in this app amber is the colour of
  // the thing you came to read. A translucent panel inside a translucent
  // stack would leave the figure to be worked out rather than seen.
  //
  // The ink is the `onAmber` ramp, which exists for exactly this shape of card
  // — "a calculator is a table of four kinds of line" — so the headline figure,
  // its supporting rows, the separators and the footnote each get a step rather
  // than four greys on yellow.
  preview: {
    padding: space(5),
    backgroundColor: theme.palette.secondary,
    borderRadius: radius.glass,
    ...cardShadowFor(theme),
    // Only the shadow's colour follows the mode — the geometry is the card's.
    shadowColor: theme.glass.shadow,
  },
  previewHead: { gap: space(0.5) },
  eyebrow: { ...type.labelSmall, color: onAmber.muted },
  previewCaption: { ...type.bodySmall, color: onAmber.detail },
  previewFigures: {
    flexDirection: 'row',
    gap: space(3),
    marginTop: space(4),
  },
  previewFigure: { flex: 1, gap: space(0.5), minWidth: 0 },
  previewLabel: { ...type.labelSmall, color: onAmber.muted },
  previewValue: { ...type.headlineSmall, color: onAmber.primary, fontVariant: ['tabular-nums'] },
  previewValueNone: { ...type.titleMedium, color: onAmber.detail },
  previewBlank: { marginTop: space(4), gap: space(1) },
  previewSub: { ...type.bodySmall, color: onAmber.detail },
  previewGap: {
    marginTop: space(4),
    paddingTop: space(4),
    borderTopWidth: 1,
    borderTopColor: amberSurface.rule,
    gap: space(2),
  },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space(3) },
  previewRowLabel: { ...type.bodySmall, color: onAmber.detail, flex: 1 },
  previewRowValue: {
    ...type.labelSmall,
    color: onAmber.primary,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  previewNote: { ...type.bodySmall, color: onAmber.faint, marginTop: space(3) },

  // ── banner ──────────────────────────────────────────────────────────────
  // --surface-high is the token theme.palette.surfaceContainerHigh resolves to.
  banner: {
    padding: space(4),
    borderRadius: radius.large,
    backgroundColor: theme.palette.surfaceContainerHigh,
    gap: space(1),
  },
  bannerLead: { ...type.titleMedium, color: theme.palette.onSurface },
  bannerLeadBad: { color: theme.palette.error },
  bannerCount: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(1) },
  bannerItem: { ...type.bodySmall, color: theme.palette.onSurfaceVariant },
  bannerItemName: { ...type.bodySmall, color: theme.palette.onSurface, fontWeight: '600' },

  // ── sections ────────────────────────────────────────────────────────────
  secHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(2),
    marginTop: space(1),
    marginBottom: space(3),
  },
  // The reference's `.sec-title`: glass-on-variant, not an accent — the
  // section is structure, not an action.
  sectionHeading: { ...type.labelSmall, color: theme.glass.onGlassVariant },
  sectionCard: { padding: space(4) },
  sectionNote: { ...type.bodySmall, color: theme.glass.onGlassVariant, marginTop: space(3) },

  // ── the fields ──────────────────────────────────────────────────────────
  fxGrid: { flexDirection: 'row', gap: space(3) },
  fxCell: { flex: 1, minWidth: 0 },
  fx: { gap: space(2), minWidth: 0 },
  fxLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: theme.palette.onSurfaceVariant,
  },
  fxWrap: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    borderRadius: radius.large,
    borderWidth: 1,
    // --outline, not its variant: the variant is a 1.7:1 hairline on this
    // field and the ten inputs lose their structure.
    borderColor: theme.palette.outline,
    backgroundColor: theme.glass.tintStrong,
    paddingHorizontal: space(3),
  },
  // The bad box takes the error surface outright — border, fill and ink —
  // rather than a red line under a field that still looks fine.
  fxWrapBad: { borderColor: theme.palette.error, backgroundColor: theme.palette.errorContainer },
  // Off drops the fill instead of fading it: opacity drags an already-dark
  // value under AA on a fill that is still light.
  fxWrapOff: { backgroundColor: theme.palette.surfaceContainer, borderColor: theme.palette.outlineVariant },
  fxIn: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    paddingVertical: space(3),
    // align-self: stretch hands the whole 48px to the tap target; the
    // wrapper's centering does the rest.
    color: theme.glass.onGlass,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  fxInBad: { color: theme.palette.onErrorContainer },
  fxInOff: { color: theme.palette.onSurfaceVariant },
  fxUnit: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: theme.palette.onSurfaceVariant,
  },
  fxUnitOff: { color: theme.palette.outline },
  // 11/16, not the app's 12/18: it fits under a 48px input without pushing
  // the grid row, and it is the only 11px red text on the screen.
  fxErr: { fontSize: 11, lineHeight: 16, color: theme.palette.error },

  // ── the 2×2 matrices ────────────────────────────────────────────────────
  mx: { gap: space(3) },
  // The heads sit on the top line of the cells; the row word centres against
  // the row track, exactly as the reference's `align-self: center` does.
  mxHeadRow: { flexDirection: 'row', gap: space(2.5), alignItems: 'flex-start' },
  mxRow: { flexDirection: 'row', gap: space(2.5), alignItems: 'flex-start' },
  mxLabelSlot: { width: 58 },
  mxHead: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: theme.palette.onSurfaceVariant,
  },
  mxRowLabel: {
    width: 58,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: theme.palette.onSurface,
    // The cells are top-aligned; the row word centres against the row track,
    // exactly as the reference's `align-self: center` does.
    alignSelf: 'center',
  },

  // ── the Deluxe switch ───────────────────────────────────────────────────
  // The state word rides alongside it: pressed-ness shown as a fill alone is
  // a state nobody who cannot see the fill can read.
  dtToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    minHeight: 44,
    paddingLeft: 14,
    paddingRight: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: theme.palette.outline,
    backgroundColor: 'transparent',
  },
  dtToggleOn: { backgroundColor: theme.palette.primarySolid, borderColor: theme.palette.primarySolid },
  dtPressed: { opacity: 0.88 },
  dtLabel: { ...type.labelSmall, color: theme.glass.onGlassVariant },
  dtLabelOn: { color: onPrimarySolid },
  dtState: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radius.full,
    backgroundColor: theme.palette.surfaceContainer,
  },
  // The ON word is a chip punched out of the solid track: a WHITE chip with
  // the brand step on it. The inverse pairing (`onPrimary` fill,
  // `primarySolid` ink) is a light-mode accident — in dark `onPrimary` becomes
  // #4E2200 and the pair drops to 2.8:1. `primarySolid` is the same step in
  // either mode, so white-over-it is 5.2:1 in both.
  dtStateOn: { backgroundColor: onPrimarySolid },
  dtStateText: { ...type.labelSmall, color: theme.palette.onSurfaceVariant },
  dtStateOnText: { ...type.labelSmall, color: theme.palette.primarySolid },

  // ── the storage note ────────────────────────────────────────────────────
  noteLock: { flexDirection: 'row', gap: space(2), marginTop: space(1) },
  noteLockText: { flex: 1, gap: space(0.5) },
  noteLabel: { ...type.labelSmall, color: theme.glass.onGlassVariant },
  noteBody: { ...type.bodySmall, color: theme.glass.onGlassVariant },

  // ── the action bar: the one committing action ───────────────────────────
  // Solid, and the only solid primary in the viewport — --primary-solid, not
  // amber: amber on these screens means a trip is already RUNNING, and this
  // is the screen that makes one. The disabled fill drops rather than
  // fading, for the reason `.end-btn:disabled` says: opacity drags the white
  // label under AA on a fill that is already the darkest thing here.
  actionBar: {
    // `flexShrink: 0`, and never `flex: 0`. The bar is a SIBLING of the
    // scroll, so it is the one thing in this screen that must keep its natural
    // height: `flex: 0` sets a zero basis, which sized the bar to its button
    // alone and let the count line under it fall past the bottom of the frame.
    // Nothing scrolls that over — the page itself is deliberately unscrollable
    // — so SAVE, the screen's one committing action, was cut off at every
    // height. Zero shrink instead keeps the bar whole and lets the ScrollView
    // beside it absorb the difference, which is the arrangement
    // `CurrentTripScreen.actionBar` already uses.
    flexShrink: 0,
    paddingHorizontal: space(5),
    paddingTop: space(3),
    gap: space(2),
    backgroundColor: 'transparent',
  },
  saveBtn: {
    width: '100%',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  saveBtnIdle: { backgroundColor: theme.palette.surfaceContainer },
  saveLabel: { ...type.labelLarge, color: onPrimarySolid, letterSpacing: 0.8 },
  saveLabelIdle: { ...type.labelLarge, color: theme.palette.onSurfaceVariant, letterSpacing: 0.8 },
  saveCount: { ...type.bodySmall, color: theme.glass.onGlassVariant, textAlign: 'center' },

  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(5),
    gap: space(2),
  },
  centerTitle: { ...type.titleMedium, color: theme.palette.onSurface },
  centerText: { ...type.bodyMedium, color: theme.palette.onSurfaceVariant, textAlign: 'center' },
  goBackButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
    paddingHorizontal: space(6),
    marginTop: space(5),
  },
  goBackLabel: { ...type.labelLarge, color: onPrimarySolid, letterSpacing: 0.8 },
});
