/**
 * The fare scales — the app's one source of truth for unit conversion.
 *
 * Every fare value is edited as human text and stored as a scaled integer:
 * money is centavos (×100), distances are thousandths of a km (×1000), and
 * percents are hundredths of a point (×100). The fare calculator and the Fare
 * Settings screen read the same conversions from here; a second implementation
 * would let a fare disagree with its own configuration.
 *
 * Conversion is string arithmetic, never float multiplication: 1.75 must
 * become 175 without a 174.99999 artefact, and 20.5 percent must become 2050
 * exactly. The parse shifts the decimal point on the digit string and rounds
 * half away from zero.
 */

export type FareScale = 2 | 3;

/** Centavos: ×100. */
export const SCALE_PESO: FareScale = 2;
/** Thousandths of a km: ×1000. */
export const SCALE_KM: FareScale = 3;
/** Hundredths of a percentage point: ×100. */
export const SCALE_PERCENT: FareScale = 2;

/**
 * Parses human text into a scaled integer, or null when the text is not a
 * plain non-negative decimal.
 *
 * Accepts only digits with at most one decimal point — the input filter
 * allows "1.2.3" to be typed, and this is where it is rejected, on save.
 * Rejects empty text and negatives (the filter already blocks a minus sign;
 * the parse is the second wall).
 */
export function parseScaled(text: string, scale: FareScale): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [wholePart, fracPart = ''] = trimmed.split('.');
  // Pad beyond the scale so the first dropped digit survives the slice — it
  // decides half-away-from-zero rounding.
  const paddedFraction = fracPart + '0'.repeat(scale + 1);
  const keptDigits = paddedFraction.slice(0, scale);
  const firstDropped = paddedFraction.charAt(scale);
  let scaled = Number(wholePart) * 10 ** scale + Number(keptDigits || '0');
  if (Number(firstDropped) >= 5) scaled += 1;
  return scaled;
}

/**
 * The inverse: a stored scaled integer back to human text with trailing
 * zeros stripped — 1000 centavos loads as "10", 175 as "1.75", 2000
 * hundredths as "20". String work again; a stored 0 renders "0".
 */
export function formatScaled(value: number, scale: FareScale): string {
  const negative = value < 0;
  const abs = Math.abs(Math.trunc(value));
  const whole = Math.floor(abs / 10 ** scale);
  const fraction = String(abs % 10 ** scale).padStart(scale, '0');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const text = trimmedFraction === '' ? `${whole}` : `${whole}.${trimmedFraction}`;
  return negative ? `-${text}` : text;
}

// ── Field definitions ───────────────────────────────────────────────────────
//
// Labels are copy, verbatim from the spec. The field key is the state slot;
// the error message rides beside the label so screen and validator agree.

export type FareFieldKey =
  | 'minimumFare'
  | 'minimumDistance'
  | 'ratePerKm'
  | 'expressRatePerKm'
  | 'deluxeRatePerKm'
  | 'expressDeluxeRatePerKm'
  | 'specialRate'
  | 'specialExpressRate'
  | 'specialDeluxeRate'
  | 'specialExpressDeluxeRate';

export type FareFieldDef = {
  key: FareFieldKey;
  label: string;
  scale: FareScale;
  /** The save-time error, verbatim. */
  error: string;
  /** Renders the "%" suffix and enforces the 0–100 range. */
  percent: boolean;
  /** Icons are resolved in the screen; the key is stable across both. */
  icon:
    | 'fare'
    | 'route'
    | 'terminal'
    | 'wallet'
    | 'settings'
    | 'person'
    | 'ticket'
    | 'history'
    | 'grid';
};

export const FARE_FIELDS: FareFieldDef[] = [
  {
    key: 'minimumFare',
    label: 'Minimum fare (PHP)',
    scale: SCALE_PESO,
    error: 'Enter a valid minimum fare.',
    percent: false,
    icon: 'fare',
  },
  {
    key: 'minimumDistance',
    label: 'Minimum distance (km)',
    scale: SCALE_KM,
    error: 'Enter a valid minimum distance.',
    percent: false,
    icon: 'route',
  },
  {
    key: 'ratePerKm',
    label: 'Regular rate per km (PHP)',
    scale: SCALE_PESO,
    error: 'Enter a valid rate per km.',
    percent: false,
    icon: 'terminal',
  },
  {
    key: 'expressRatePerKm',
    label: 'SCTEX rate per km (PHP)',
    scale: SCALE_PESO,
    error: 'Enter a valid SCTEX rate per km.',
    percent: false,
    icon: 'wallet',
  },
  {
    key: 'deluxeRatePerKm',
    label: 'Deluxe rate per km (PHP)',
    scale: SCALE_PESO,
    error: 'Enter a valid Deluxe rate per km.',
    percent: false,
    icon: 'ticket',
  },
  {
    key: 'expressDeluxeRatePerKm',
    label: 'SCTEX Deluxe rate per km (PHP)',
    scale: SCALE_PESO,
    error: 'Enter a valid SCTEX Deluxe rate per km.',
    percent: false,
    icon: 'settings',
  },
  {
    key: 'specialRate',
    label: 'PWD / Student / Senior rate per km (PHP)',
    scale: SCALE_PESO,
    error: 'Enter a valid passenger rate per km.',
    percent: false,
    icon: 'person',
  },  {
    key: 'specialExpressRate',
    label: 'PWD / Student / Senior express way rate per km (PHP)',
    scale: SCALE_PESO,
    error: 'Enter a valid passenger rate per km.',
    percent: false,
    icon: 'fare',
  },
  {
    key: 'specialDeluxeRate',
    label: 'PWD / Student / Senior Deluxe rate per km (PHP)',
    scale: SCALE_PESO,
    error: 'Enter a valid passenger rate per km.',
    percent: false,
    icon: 'fare',
  },
  {
    key: 'specialExpressDeluxeRate',
    label: 'PWD / Student / Senior Deluxe express way rate per km (PHP)',
    scale: SCALE_PESO,
    error: 'Enter a valid passenger rate per km.',
    percent: false,
    icon: 'fare',
  },
];

export type FareValues = Record<FareFieldKey, string>;
export type FareFieldErrors = Partial<Record<FareFieldKey, string>>;

/**
 * The input filter: a keystroke survives only if the resulting text is still
 * digits and decimal points. Everything else — minus, comma, currency,
 * letters, whitespace — is dropped, and the field keeps its previous text.
 * Multiple decimal points CAN be typed ("1.2.3" sits in the field) and are
 * rejected at save; silently rewriting text the user is still editing is
 * worse than a visible error.
 */
export function applyFareInputFilter(current: string, next: string): string {
  if (!/^[\d.]*$/.test(next)) return current;
  return next;
}

/**
 * Validates every field on a save attempt. All errors at once — never the
 * first failure alone. Returns null when the whole form is clean.
 */
export function validateFareFields(
  values: FareValues,
): FareFieldErrors | null {
  const errors: FareFieldErrors = {};
  let any = false;
  for (const field of FARE_FIELDS) {
    const parsed = parseScaled(values[field.key], field.scale);
    let message: string | null = null;
    if (parsed === null) {
      message = field.error;
    } else if (field.percent && (parsed < 0 || parsed > 100 * 10 ** SCALE_PERCENT)) {
      message = field.error;
    }
    if (message !== null) {
      errors[field.key] = message;
      any = true;
    }
  }
  return any ? errors : null;
}

/** Converts every field to its stored scaled integer. Call after validation. */
export function toStoredFareValues(values: FareValues): Record<FareFieldKey, number> {
  const stored = {} as Record<FareFieldKey, number>;
  for (const field of FARE_FIELDS) {
    stored[field.key] = parseScaled(values[field.key], field.scale) ?? 0;
  }
  return stored;
}

/** Derives the load-time field text from two stored rows. Trailing zeros stripped. */
export function fareTextFromStored(
  fare: {
    minimum_fare: number;
    minimum_distance_milli: number;
    rate_per_km: number;
    express_rate_per_km?: number;
    deluxe_rate_per_km: number;
    express_deluxe_rate_per_km?: number;
    special_rate_per_km: number;
    special_express_rate_per_km?: number;
    special_deluxe_rate_per_km?: number;
    special_express_deluxe_rate_per_km?: number;
  } | null,
): FareValues {
  const values = {} as FareValues;
  if (fare === null) {
    // fareStore creates the table and seeds no rows, so a fresh install has
    // nothing at all. Every field is blank: nothing is pre-seeded, because a
    // field showing a value the device never chose is a claim the data does
    // not make.
    for (const field of FARE_FIELDS) values[field.key] = '';
    return values;
  }
  values.minimumFare = formatScaled(fare.minimum_fare, SCALE_PESO);
  values.minimumDistance = formatScaled(fare.minimum_distance_milli, SCALE_KM);
  values.ratePerKm = formatScaled(fare.rate_per_km, SCALE_PESO);
  values.expressRatePerKm = formatScaled(
    fare.express_rate_per_km ?? fare.rate_per_km,
    SCALE_PESO,
  );
  values.deluxeRatePerKm = formatScaled(fare.deluxe_rate_per_km, SCALE_PESO);
  values.expressDeluxeRatePerKm = formatScaled(
    fare.express_deluxe_rate_per_km ?? fare.deluxe_rate_per_km,
    SCALE_PESO,
  );
  values.specialRate = formatScaled(fare.special_rate_per_km, SCALE_PESO);
  values.specialExpressRate = formatScaled(
    fare.special_express_rate_per_km ?? fare.special_rate_per_km,
    SCALE_PESO,
  );
  values.specialDeluxeRate = formatScaled(
    fare.special_deluxe_rate_per_km ?? fare.special_rate_per_km,
    SCALE_PESO,
  );
  values.specialExpressDeluxeRate = formatScaled(
    fare.special_express_deluxe_rate_per_km ?? fare.special_rate_per_km,
    SCALE_PESO,
  );
  return values;
}
