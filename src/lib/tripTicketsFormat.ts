/**
 * Formatters for the Trip Tickets screen.
 *
 * The store's units become text here and nowhere else: centavos → pesos,
 * thousandths of a km → three decimals, epoch millis → the two timestamp
 * shapes the screen uses. Every formatter is built once per pattern and cached
 * — constructing `Intl` formatters inside a row's render is the classic ledger
 * jank, and a FlatList re-rendering on scroll would pay it repeatedly.
 *
 * `php()` from `format.ts` is deliberately not used on this screen: it is the
 * app's pinned display format, while the spec here asks for the platform
 * currency formatter over en-PH. The two produce the same reading — ₱ and two
 * decimals — so nothing drifts visibly while both exist.
 */

const PESO = 'php';
const HEADER_STAMP = 'headerStamp';
const ROW_STAMP = 'rowStamp';
const ROW_DATETIME_STAMP = 'rowDateTimeStamp';
const WEEKDAY_STAMP = 'weekdayStamp';

/** One formatter per pattern, per locale. Never per row. */
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function numberFormatter(key: string, options: Intl.NumberFormatOptions) {
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-PH', options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

function dateFormatter(key: string, options: Intl.DateTimeFormatOptions) {
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-PH', options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

/** Centavos → ₱ through the platform currency formatter, en-PH. */
export function centavos(value: number) {
  return numberFormatter(PESO, {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

/** "Sep 26, 2026" — the header timestamp shape (MMM d, yyyy). */
export function formatHeaderStamp(millis: number) {
  return dateFormatter(HEADER_STAMP, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(millis);
}

/**
 * "6:30 AM" — the ledger row timestamp shape (h:mm a).
 * The meridiem is held to its time by a non-breaking space: a plain space
 * lets the meta line break "7:30" and "AM" onto two lines.
 */
export function formatRowStamp(millis: number) {
  return dateFormatter(ROW_STAMP, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(millis)
    .replace(/ (AM|PM)$/i, '\u00A0$1');
}

/**
 * "Sep 26, 2026, 6:30 AM" — date and time together, for lists that span more
 * than one day, where a bare time cannot place a row. Same cached formatter
 * discipline as the two stamps above.
 */
export function formatDateTimeStamp(millis: number) {
  return dateFormatter(ROW_DATETIME_STAMP, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(millis);
}

/**
 * "7:45 AM · Mon, Sep 28" — the receipt half of the stamp pair: the clock
 * first, the date holding the meridiem to the time so a meta line reads as one
 * phrase. Built from the cached clock above, never a formatter inside render.
 */
export function formatReceiptStamp(millis: number) {
  const day = dateFormatter(WEEKDAY_STAMP, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(millis);
  return `${formatRowStamp(millis)} · ${day}`;
}

/**
 * Integer thousandths of a km → "86.200 km", three decimals, always.
 *
 * Registry-grade precision: config screens print a stored distance exactly as
 * recorded (`Registered KM 228.000 km`). Lists that sit next to Dashboard's
 * `km()` output go through `distanceLabel` instead, which rounds for reading.
 */
export function distanceKm(milliKm: number) {
  return `${(milliKm / 1000).toFixed(3)} km`;
}

/**
 * Passenger type label: underscores become spaces, lower-cased after the first
 * word — SENIOR_CITIZEN reads "Senior citizen", not the all-caps acronym a
 * screen reader would spell out letter by letter. PWD is exempt: it *is* an
 * acronym, and the reference labels it PWD everywhere it appears.
 */
export function passengerTypeLabel(type: string) {
  // Both spellings of the acronym pass through here: the store's passenger_type
  // (`PWD`) and its derived category (`Pwd`). The reference labels it PWD
  // everywhere it appears.
  if (type === 'PWD' || type === 'Pwd') return 'PWD';
  return type
    .split('_')
    .map((word, index) =>
      index === 0 ? word.charAt(0) + word.slice(1).toLowerCase() : word.toLowerCase(),
    )
    .join(' ');
}
