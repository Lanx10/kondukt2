/**
 * Formatters for the Trip screen.
 *
 * Same discipline as `tripTicketsFormat.ts`: one `Intl` instance per pattern,
 * cached at module scope, never per row. This screen adds the elapsed clock —
 * `HH:MM:SS` over a millisecond delta, clamped at zero so a backwards device
 * clock cannot render a negative duration.
 */

const HEADER_DATE = 'headerDate';
const SHORT_TIME = 'shortTime';

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(key: string, options: Intl.DateTimeFormatOptions) {
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-PH', options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

/** "Sep 26, 2026" — the header's medium date. */
export function formatMediumDate(millis: number) {
  return dateFormatter(HEADER_DATE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(millis);
}

/** "6:30 AM" — short device-locale time. */
export function formatShortTime(millis: number) {
  return dateFormatter(SHORT_TIME, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(millis);
}

/**
 * Milliseconds → "HH:MM:SS", hours unbounded (a trip past midnight reads
 * 01:20:00, not 25:20:00 folded into 01). Negative deltas clamp to zero:
 * elapsed time derived against a device clock that jumped backwards must
 * never read as a negative duration.
 */
export function formatElapsed(millis: number) {
  const totalSeconds = Math.max(0, Math.floor(millis / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Milliseconds → "1h 18m", or "45m" under an hour. The reference's compact
 * duration for glances — the home pill and the hero's "… running" line — as
 * opposed to `formatElapsed`'s stopwatch readout. Negative deltas clamp to 0.
 */
export function formatDurationShort(millis: number) {
  const minutes = Math.max(0, Math.round(millis / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
    : `${minutes}m`;
}
