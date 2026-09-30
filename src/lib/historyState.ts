import type {
  HistoryTab,
  PassengerBreakdownRow,
} from '../data/historyStore';
import type { PassengerType } from '../data/schema';

/**
 * Pure History logic: date presets with local-midnight boundaries, per-tab
 * pagination state, and the daily-earnings grouping. No React, no SQLite —
 * `tsx` tests the whole file.
 *
 * Boundary rule: start is local midnight; end is the start of the following
 * day, exclusive. Every window is `>= start AND < end`. Building days in UTC
 * would put a local day's records in the wrong window the moment the device
 * sits west of Greenwich, so the arithmetic runs on the local calendar.
 */

export type DatePreset = 'today' | 'yesterday' | 'last7' | 'month' | 'custom';

export type DateRange = {
  startMillis: number;
  endExclusiveMillis: number;
  label: string;
  preset: DatePreset;
};

/**
 * The period control's mode. `custom` is a hand-picked window from the
 * calendar; the other three step by Day / Week / Month.
 */
export type RangeMode = 'day' | 'week' | 'month' | 'custom';

export const RANGE_SEGMENTS: { mode: Exclude<RangeMode, 'custom'>; label: string }[] = [
  { mode: 'day', label: 'Day' },
  { mode: 'week', label: 'Week' },
  { mode: 'month', label: 'Month' },
];

const DAY_MS = 86_400_000;

/**
 * The window a mode+offset selects, plus the labels every part of the screen
 * shows. `offset` counts periods back from the present (0 = present), so
 * "next" is only possible after stepping back — the app reads stored records,
 * not the future.
 */
export type PeriodState = {
  startMillis: number;
  endExclusiveMillis: number;
  /** "Today" / "Yesterday" / "Last 7 days" / "September 2026" / "Custom range". */
  label: string;
  /** The exact dates under the label: "Sun, Sep 27" / "Sep 21 – Sep 27, 2026". */
  datesLabel: string;
  /** The summary card's scope: TODAY / LAST 7 DAYS / SEPTEMBER 2026 / custom span. */
  scope: string;
  /** True when hand-picked — the stepper is disabled and the calendar chip lit. */
  isCustom: boolean;
  canPrev: boolean;
  canNext: boolean;
};

export function rangeModePreset(mode: RangeMode): DatePreset {
  switch (mode) {
    case 'day': return 'today';
    case 'week': return 'last7';
    case 'month': return 'month';
    case 'custom': return 'custom';
  }
}

/**
 * Resolves the visible period from mode + offset.
 *
 * Week is "the last 7 days including today", stepped whole periods back — the
 * same shape as the prototype's stepper, and the same window the `last7`
 * preset selects at offset 0. Month is the calendar month. Day at offset 0 is
 * today; at -1 it relabels to Yesterday.
 */
export function resolvePeriod(
  mode: Exclude<RangeMode, 'custom'>,
  offset: number,
  now: number,
  fmtShort: (m: number) => string,
  fmtDay: (m: number) => string,
  fmtMonth: (m: number) => string,
  fmtYear: (m: number) => string,
): PeriodState {
  const todayStart = startOfLocalDay(now);
  if (mode === 'day') {
    const startMillis = todayStart + offset * DAY_MS;
    const endExclusiveMillis = startMillis + DAY_MS;
    const isYesterday = offset === -1;
    const dayLabel = fmtDay(startMillis);
    return {
      startMillis,
      endExclusiveMillis,
      label: offset === 0 ? 'Today' : isYesterday ? 'Yesterday' : dayLabel,
      datesLabel: isYesterday || offset === 0 ? dayLabel : `${dayLabel}, ${fmtYear(startMillis)}`,
      scope: offset === 0 ? 'TODAY' : isYesterday ? 'YESTERDAY' : dayLabel.toUpperCase(),
      isCustom: false,
      canPrev: true,
      canNext: offset < 0,
    };
  }
  if (mode === 'week') {
    // Weeks step as whole 7-day windows ending today — the same shape as the
    // `last7` preset at offset 0, stepped whole periods back.
    const startMillis = todayStart - 6 * DAY_MS + offset * 7 * DAY_MS;
    const endExclusiveMillis = startMillis + 7 * DAY_MS;
    const endInclusive = endExclusiveMillis - DAY_MS;
    const span = `${fmtShort(startMillis)} – ${fmtShort(endInclusive)}`;
    return {
      startMillis,
      endExclusiveMillis,
      label: offset === 0 ? 'Last 7 days' : span,
      datesLabel: `${span}, ${fmtYear(endInclusive)}`,
      scope: offset === 0 ? 'LAST 7 DAYS' : span.toUpperCase(),
      isCustom: false,
      canPrev: true,
      canNext: offset < 0,
    };
  }
  // Month mode.
  const anchor = new Date(todayStart);
  const ref = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
  const startMillis = ref.getTime();
  // Day count from the calendar, never from timestamp arithmetic — a naive
  // `+ 30 days` turns September into a 31-day month.
  const endExclusiveMillis = new Date(ref.getFullYear(), ref.getMonth() + 1, 1).getTime();
  const name = fmtMonth(startMillis);
  const year = ref.getFullYear();
  const daysInMonth = Math.round((endExclusiveMillis - startMillis) / DAY_MS);
  const mShort = fmtShort(startMillis).split(' ')[0];
  return {
    startMillis,
    endExclusiveMillis,
    label: `${name} ${year}`,
    datesLabel: `${mShort} 1 – ${mShort} ${daysInMonth}, ${year}`,
    scope: offset === 0 ? 'THIS MONTH' : `${name} ${year}`.toUpperCase(),
    isCustom: false,
    canPrev: true,
    canNext: offset < 0,
  };
}

/** A custom range as a PeriodState — the calendar modal's output. */
export function customPeriod(
  startMillis: number,
  endExclusiveMillis: number,
  fmtShort: (m: number) => string,
  fmtYear: (m: number) => string,
): PeriodState {
  const endInclusive = endExclusiveMillis - DAY_MS;
  const span = `${fmtShort(startMillis)} – ${fmtShort(endInclusive)}`;
  return {
    startMillis,
    endExclusiveMillis,
    label: 'Custom range',
    datesLabel: `${span}, ${fmtYear(endInclusive)}`,
    scope: span.toUpperCase(),
    isCustom: true,
    canPrev: false,
    canNext: false,
  };
}

export const DATE_PRESETS: { preset: Exclude<DatePreset, 'custom'>; label: string }[] = [
  { preset: 'today', label: 'Today' },
  { preset: 'yesterday', label: 'Yesterday' },
  { preset: 'last7', label: 'Last 7 days' },
  { preset: 'month', label: 'This month' },
];

/** Local midnight of the day containing `millis`. */
export function startOfLocalDay(millis: number) {
  const date = new Date(millis);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Resolves a preset to its window.
 *
 * last7 is six days ago through today inclusive — seven local days, not
 * "the past 168 hours", which would clip today's early-morning records.
 */
export function resolvePreset(
  preset: Exclude<DatePreset, 'custom'>,
  now: number,
  formatRange: (start: number, end: number) => string,
): DateRange {
  const todayStart = startOfLocalDay(now);
  const DAY = 86_400_000;
  let startMillis: number;
  let endExclusiveMillis: number;
  switch (preset) {
    case 'today':
      startMillis = todayStart;
      endExclusiveMillis = todayStart + DAY;
      break;
    case 'yesterday':
      startMillis = todayStart - DAY;
      endExclusiveMillis = todayStart;
      break;
    case 'last7':
      startMillis = todayStart - 6 * DAY;
      endExclusiveMillis = todayStart + DAY;
      break;
    case 'month':
      startMillis = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
      endExclusiveMillis = todayStart + DAY;
      break;
  }
  return {
    startMillis,
    endExclusiveMillis,
    preset,
    label: formatRange(startMillis, endExclusiveMillis - 1),
  };
}

/** A custom window. End-before-start is rejected, never silently swapped. */
export function resolveCustom(
  startMillis: number,
  endMillis: number,
  formatRange: (start: number, end: number) => string,
): { ok: true; range: DateRange } | { ok: false; message: string } {
  if (endMillis < startMillis) {
    return { ok: false, message: 'The end date is before the start date. Choose an end after it.' };
  }
  // An end date is inclusive in the UI; the query wants exclusive.
  return {
    ok: true,
    range: {
      startMillis: startOfLocalDay(startMillis),
      endExclusiveMillis: startOfLocalDay(endMillis) + 86_400_000,
      preset: 'custom',
      label: formatRange(startOfLocalDay(startMillis), startOfLocalDay(endMillis)),
    },
  };
}

/** "1 ticket" / "4 tickets" — counts read out in prose, without a bare number. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export const HISTORY_TABS: { tab: HistoryTab; label: string }[] = [
  { tab: 'trips', label: 'Trips' },
  { tab: 'tickets', label: 'Tickets' },
  { tab: 'earnings', label: 'Earnings' },
];

/** Average earnings per trip, floored to the cent, guarded on zero trips. */
export function averageEarnings(earnings: number, tripCount: number) {
  return tripCount === 0 ? 0 : Math.floor(earnings / tripCount);
}

/** The breakdown as a fixed four-slot record the screen renders directly. */
export function breakdownByType(rows: PassengerBreakdownRow[]) {
  const byType = (type: PassengerType) =>
    rows.find((row) => row.passenger_type === type)?.passenger_count ?? 0;
  return {
    regular: byType('REGULAR'),
    student: byType('STUDENT'),
    senior: byType('SENIOR_CITIZEN'),
    pwd: byType('PWD'),
  };
}

/**
 * Groups ticket rows into daily earnings, keyed by local calendar day.
 *
 * The day label goes through the same formatter the rest of the screen uses —
 * never the raw ISO form, which reads as machine output next to peso values.
 * Ticket and passenger counts ride along so the ledger row can carry the day's
 * shape, not just its total.
 */
export function groupDailyEarnings(
  rows: { created_at: number; total_fare: number; passenger_quantity?: number }[],
  formatDay: (millis: number) => string,
): { dayStart: number; label: string; earnings: number; ticketCount: number; passengerCount: number }[] {
  const days = new Map<
    number,
    { earnings: number; ticketCount: number; passengerCount: number }
  >();
  for (const row of rows) {
    const day = startOfLocalDay(row.created_at);
    const slot = days.get(day) ?? { earnings: 0, ticketCount: 0, passengerCount: 0 };
    slot.earnings += row.total_fare;
    slot.ticketCount += 1;
    slot.passengerCount += row.passenger_quantity ?? 0;
    days.set(day, slot);
  }
  return [...days.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dayStart, slot]) => ({
      dayStart,
      label: formatDay(dayStart),
      earnings: slot.earnings,
      ticketCount: slot.ticketCount,
      passengerCount: slot.passengerCount,
    }));
}

/**
 * Merges a fetched page into accumulated rows, deduplicating on row id.
 *
 * Live queries re-emit: a store write between two loads can resend rows the
 * previous page already delivered, and concatenation without dedup would show
 * them twice.
 */
export function mergePage<T extends { id: number }>(existing: T[], page: T[]): T[] {
  const seen = new Set(existing.map((row) => row.id));
  return [...existing, ...page.filter((row) => !seen.has(row.id))];
}

// ── Search ──────────────────────────────────────────────────────────────────

/** One placeholder per tab, in the spec's own wording. */
export const SEARCH_PLACEHOLDERS: Record<HistoryTab, string> = {
  trips: 'Search trips',
  tickets: 'Search tickets',
  earnings: 'Search earnings',
};

/**
 * The earnings tab's search field: it narrows the daily ledger by the
 * formatted day label — the only text a row carries. Filtering happens after
 * grouping, on the label the user actually sees.
 */
export function filterDailyRowsBySearch<
  T extends { label: string },
>(rows: T[], searchQuery: string): T[] {
  const needle = searchQuery.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter((row) => row.label.toLowerCase().includes(needle));
}

/**
 * The empty state's sentence. A bare "no results" leaves the user guessing
 * what to clear; naming the active search and filters says it. The noun is
 * the tab itself ("No trips match…", per the reference), not the search
 * placeholder — "No search trips match" reads as gibberish when no search
 * is the problem.
 */
export function emptyHistoryMessage(
  tab: HistoryTab,
  searchQuery: string,
  filtersActive: boolean,
): string {
  const needle = searchQuery.trim();
  if (needle !== '') {
    const filterNote = filtersActive ? ' and filters' : '';
    return `No ${tab} match “${needle}”${filterNote}. Clear the search to see all records.`;
  }
  if (filtersActive) {
    return `No ${tab} match the selected filters. Clear a filter to see all records.`;
  }
  return `No ${tab} match the selected date range.`;
}
