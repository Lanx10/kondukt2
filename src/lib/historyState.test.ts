import {
  averageEarnings,
  breakdownByType,
  customPeriod,
  emptyHistoryMessage,
  filterDailyRowsBySearch,
  groupDailyEarnings,
  mergePage,
  resolveCustom,
  resolvePeriod,
  resolvePreset,
  SEARCH_PLACEHOLDERS,
  startOfLocalDay,
} from './historyState';
import type { PassengerBreakdownRow } from '../data/historyStore';

/**
 * Self-check for the History screen's date math, pagination dedup, and daily
 * grouping.
 *
 * Run with: npx tsx src/lib/historyState.test.ts
 *
 * The date boundaries are the fragile part: local midnights, an exclusive end,
 * and a seven-day preset that includes today. A UTC slip here silently files
 * records under the wrong day.
 */

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'pass' : 'FAIL'}  ${name}${
      ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`
    }`,
  );
}

// A fixed local noon, so no test straddles midnight by accident.
const NOON = new Date(2026, 8, 26, 12, 0, 0).getTime();
const DAY = 86_400_000;
const fmt = () => 'range';

// ── boundaries ──────────────────────────────────────────────────────────────
check('startOfLocalDay lands on midnight', startOfLocalDay(NOON), new Date(2026, 8, 26).getTime());

const today = resolvePreset('today', NOON, fmt);
check('today starts at local midnight', today.startMillis, new Date(2026, 8, 26).getTime());
check('today ends exclusive at the next midnight', today.endExclusiveMillis, new Date(2026, 8, 27).getTime());

const yesterday = resolvePreset('yesterday', NOON, fmt);
check('yesterday is the previous local day', yesterday.startMillis, new Date(2026, 8, 25).getTime());

const last7 = resolvePreset('last7', NOON, fmt);
check('last7 begins six days ago', last7.startMillis, new Date(2026, 8, 20).getTime());
check('last7 includes today (exclusive end is tomorrow)', last7.endExclusiveMillis, new Date(2026, 8, 27).getTime());

const month = resolvePreset('month', NOON, fmt);
check('month starts on the first', month.startMillis, new Date(2026, 8, 1).getTime());
check('month ends exclusive tomorrow', month.endExclusiveMillis, new Date(2026, 8, 27).getTime());

// ── period control ─────────────────────────────────────────────────────────────
const id = (m: number) => String(m);
const periodDay = resolvePeriod('day', 0, NOON, id, id, id, id);
check('period day starts at local midnight', periodDay.startMillis, new Date(2026, 8, 26).getTime());
check('period day scope is TODAY', periodDay.scope, 'TODAY');
check('period day cannot step forward at present', periodDay.canNext, false);

const periodYesterday = resolvePeriod('day', -1, NOON, id, id, id, id);
check('period day -1 labels Yesterday', periodYesterday.label, 'Yesterday');
check('period day -1 can step forward', periodYesterday.canNext, true);
check('period day -1 scope is YESTERDAY', periodYesterday.scope, 'YESTERDAY');

const periodWeek = resolvePeriod('week', 0, NOON, id, id, id, id);
check('period week is seven days ending today', periodWeek.endExclusiveMillis - periodWeek.startMillis, 7 * DAY);
check('period week scope is LAST 7 DAYS', periodWeek.scope, 'LAST 7 DAYS');

const periodWeekBack = resolvePeriod('week', -1, NOON, id, id, id, id);
check('period week -1 ends before this week starts', periodWeekBack.endExclusiveMillis <= periodWeek.startMillis, true);

const periodMonth = resolvePeriod('month', 0, NOON, id, id, id, id);
check('period month starts on the 1st', periodMonth.startMillis, new Date(2026, 8, 1).getTime());
check('period month covers 30 Septembers days', periodMonth.endExclusiveMillis - periodMonth.startMillis, 30 * DAY);
check('period month scope is THIS MONTH', periodMonth.scope, 'THIS MONTH');

const custom = customPeriod(new Date(2026, 8, 10).getTime(), new Date(2026, 8, 14).getTime() + DAY, id, id);
check('custom period is custom', custom.isCustom, true);
check('custom period cannot step', custom.canPrev || custom.canNext, false);

// ── custom range ────────────────────────────────────────────────────────────
const ok = resolveCustom(new Date(2026, 8, 10).getTime(), new Date(2026, 8, 14).getTime(), fmt);
check('custom resolves ok', ok.ok, true);
if (ok.ok) {
  check('custom end is exclusive next midnight', ok.range.endExclusiveMillis, new Date(2026, 8, 15).getTime());
}
const bad = resolveCustom(new Date(2026, 8, 14).getTime(), new Date(2026, 8, 10).getTime(), fmt);
check('end before start is rejected', bad.ok, false);
check('rejection names the problem', !bad.ok && bad.message.includes('end date'), true);

// ── averages and breakdown ─────────────────────────────────────────────────
check('average guards on zero trips', averageEarnings(500_00, 0), 0);
check('average floors to the cent', averageEarnings(101_00, 2), 5050);

const breakdown: PassengerBreakdownRow[] = [
  { passenger_type: 'REGULAR', passenger_count: 92, earnings: 0 },
  { passenger_type: 'PWD', passenger_count: 13, earnings: 0 },
];
const slots = breakdownByType(breakdown);
check('breakdown slots present types', slots.regular, 92);
check('breakdown absent types are zero', slots.student, 0);
check('breakdown senior from SENIOR_CITIZEN', slots.senior, 0);

// ── daily grouping ──────────────────────────────────────────────────────────
const grouped = groupDailyEarnings(
  [
    { created_at: new Date(2026, 8, 25, 9).getTime(), total_fare: 100_00 },
    { created_at: new Date(2026, 8, 25, 17).getTime(), total_fare: 50_00 },
    { created_at: new Date(2026, 8, 26, 8).getTime(), total_fare: 200_00 },
  ],
  () => 'day',
);
check('two distinct local days', grouped.length, 2);
check('newest day first', grouped[0].label, 'day');
check('same-day rows sum', grouped[1].earnings, 150_00);
check('next-day rows separate', grouped[0].earnings, 200_00);

// ── pagination dedup ────────────────────────────────────────────────────────
const page1 = [{ id: 1 }, { id: 2 }, { id: 3 }];
const page2 = [{ id: 3 }, { id: 4 }];
check('merge dedups by id', mergePage(page1, page2 as { id: number }[]).map((r) => r.id), [1, 2, 3, 4]);
check('merge of a resent page adds nothing', mergePage(page1, page1 as { id: number }[]).length, 3);

// ── search ────────────────────────────────────────────────────────────
check(
  'placeholders per tab',
  [SEARCH_PLACEHOLDERS.trips, SEARCH_PLACEHOLDERS.tickets, SEARCH_PLACEHOLDERS.earnings],
  ['Search trips', 'Search tickets', 'Search earnings'],
);

const daily = [
  { dayStart: 2, label: 'Sep 26, 2026', earnings: 1 },
  { dayStart: 1, label: 'Sep 25, 2026', earnings: 2 },
];
check(
  'daily search matches the label',
  filterDailyRowsBySearch(daily, 'sep 26').length,
  1,
);
check('daily search trims and case-folds', filterDailyRowsBySearch(daily, '  sep ').length, 2);
check('blank daily search keeps all', filterDailyRowsBySearch(daily, '   ').length, 2);
check('daily search miss keeps none', filterDailyRowsBySearch(daily, 'march').length, 0);

check(
  'empty copy names the needle',
  emptyHistoryMessage('trips', '  subic  ', false),
  'No trips match “subic”. Clear the search to see all records.',
);
check(
  'empty copy names filters alongside the needle',
  emptyHistoryMessage('tickets', 'caloocan', true),
  'No tickets match “caloocan” and filters. Clear the search to see all records.',
);
check(
  'empty copy with filters only',
  emptyHistoryMessage('earnings', '', true),
  'No earnings match the selected filters. Clear a filter to see all records.',
);
check(
  'empty copy with neither is the date-range case',
  emptyHistoryMessage('trips', '', false),
  'No trips match the selected date range.',
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
