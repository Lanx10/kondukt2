/**
 * Formatters shared by every screen.
 *
 * The Android build has a `Formatters.kt` with `php()`, `km()` and
 * `duration()`, and the reason it exists is the reason these exist here: money,
 * distance and time must read identically on Home, Dashboard, Trip and History,
 * or a value looks like a different number depending on where you met it.
 *
 * `php()` is written out rather than delegated to `Intl.NumberFormat`. Intl
 * would work, but its output moves with the platform's ICU version, which is the
 * exact inconsistency this module exists to prevent — the peso sign, the
 * thousands separator and the decimal count are all pinned here instead.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Two decimals, always — a peso amount is never shown bare — with the
 * thousands separator this module's own doc claims to pin. `centavos()`
 * (Intl, en-PH) already groups; `php` did not, so the same ₱1,030.09 read
 * "₱1030.09" on the Add-ticket sheet and "₱1,030.09" on Home.
 */
export function php(amount: number) {
  const negative = amount < 0;
  const [whole, decimals] = Math.abs(amount).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}₱${grouped}.${decimals}`;
}

/** Takes kilometres. Storage holds metres — see `konduktStore`. */
export function km(value: number) {
  return `${value.toFixed(1)} km`;
}

/** Takes metres, the unit distance is stored in. */
export function metresAsKm(metres: number) {
  return km(metres / 1000);
}

/** "Sat, Sep 26" — the compact form the Home clock uses. */
export function formatDate(date: Date) {
  return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** "Sep 26" — the compact day stamp the History period control uses. */
export function formatShortDate(date: Date) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** "Sep 26, 2026" — for headings that need the year. */
export function formatDateLong(date: Date) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function formatDayName(date: Date) {
  return LONG_DAYS[date.getDay()];
}

/**
 * 12-hour clock with a folded hour. 0 and 12 are both the 12 o'clock hour, so
 * `hours % 12` is folded rather than padded: midnight reads 12:00 AM, noon
 * reads 12:00 PM.
 */
export function formatTime(date: Date) {
  const hours = date.getHours();
  const hours12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hours12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Midnight on the given day — the lower bound for any "records from today" query. */
export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Money in this module is peso floats seeded from fixed records, so the only
 * rounding that matters is at the display boundary. The Android build keeps
 * integer centavos end-to-end; that guarantee lives in its FareCalculator, which
 * this repository does not have.
 */
export function round2(value: number) {
  return Math.round(value * 100) / 100;
}
