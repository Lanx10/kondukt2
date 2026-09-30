import {
  aggregateByMunicipality,
  defaultTrip,
  distinctMunicipalities,
  filterRowsBySearch,
  mixEntries,
  mixLabel,
  municipalityOf,
  municipalityRowKey,
  municipalityPairLabel,
  orderAvailableTrips,
  passengerFilterEntry,
  passengerSummary,
  resolveSelectedTrip,
  toSqlFilter,
  type TicketAggregateRow,
} from './passengerState';

/**
 * Self-check for the Passenger screen's aggregation, snapshot parsing, search
 * and selection fallback.
 *
 * Run with: npx tsx src/lib/passengerState.test.ts
 *
 * The fragile parts: quantity-based counting (a qty-3 ticket is three
 * passengers), the filtered denominator (category rows resolve to 100%
 * among themselves), the zero-division guard, and the stale-selection
 * fallback.
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

// ── municipality parsing ────────────────────────────────────────────────────
check('municipality from snapshot tail', municipalityOf('Santa Cruz, Olongapo'), 'Olongapo');
check('multi-comma snapshot keeps last tail', municipalityOf('Purok 3, Santa Cruz, Olongapo'), 'Olongapo');
check('bare name passes through', municipalityOf('Olongapo'), 'Olongapo');
check('null snapshot falls back', municipalityOf(null), 'Not recorded');
check('empty snapshot falls back', municipalityOf('   '), 'Not recorded');

// ── SQL filter mapping ──────────────────────────────────────────────────────
check('ALL maps to null', toSqlFilter('ALL'), null);
check('SENIOR maps to SENIOR_CITIZEN', toSqlFilter('SENIOR'), 'SENIOR_CITIZEN');
check('PWD maps to PWD', toSqlFilter('PWD'), 'PWD');

// ── aggregation ─────────────────────────────────────────────────────────────
const tickets: TicketAggregateRow[] = [
  {
    origin_location_snapshot: 'Santa Maria, Baliwag',
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    passenger_type: 'REGULAR',
    passenger_quantity: 23,
  },
  {
    origin_location_snapshot: 'Minalin, Pampanga',
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    passenger_type: 'REGULAR',
    passenger_quantity: 21,
  },
  {
    origin_location_snapshot: 'San Rafael, Bulacan',
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    passenger_type: 'STUDENT',
    passenger_quantity: 8,
  },
  {
    origin_location_snapshot: 'Minalin, Pampanga',
    destination_municipality: undefined as never, // shape guard
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    passenger_type: 'STUDENT',
    passenger_quantity: 13,
  },
] as TicketAggregateRow[];

const agg = aggregateByMunicipality(tickets);
check('pairs merge across categories', agg.rows.length, 3);
check('same pair sums quantities', agg.rows[0].passengerCount, 34);
check('newest… actually: count descending order', agg.rows.map((r) => r.passengerCount), [34, 23, 8]);
check('total is the sum of quantities', agg.totalPassengers, 65);
check(
  'percentage uses the unfiltered total',
  agg.rows[0].percentage,
  (34 / 65) * 100,
);
check(
  'rows resolve to 100 among themselves',
  Math.round(agg.rows.reduce((sum, row) => sum + row.percentage, 0)),
  100,
);

// ── group facts: mix, distinct municipalities ───────────────────────────────
check(
  'mix line reads in chip words',
  mixLabel({ REGULAR: 3, SENIOR_CITIZEN: 2, PWD: 1 }),
  '3 regular · 2 senior · 1 PWD',
);
check('mix skips absent types', mixLabel({ STUDENT: 4 }), '4 student');
check('empty mix is empty', mixLabel({}), '');
check('missing byType is empty', mixLabel(undefined), '');
check(
  'mix entries carry share of group',
  mixEntries({ REGULAR: 3, PWD: 1 }),
  [
    { label: 'Regular', qty: 3, pct: 75 },
    { label: 'PWD', qty: 1, pct: 25 },
  ],
);
const timed = aggregateByMunicipality([
  {
    origin_location_snapshot: 'Poblacion, Iba',
    destination_location_snapshot: 'Poblacion, Olongapo',
    passenger_type: 'REGULAR',
    passenger_quantity: 1,
    created_at: 500,
  },
  {
    origin_location_snapshot: 'Poblacion, Iba',
    destination_location_snapshot: 'Poblacion, Olongapo',
    passenger_type: 'STUDENT',
    passenger_quantity: 2,
    created_at: 900,
  },
]);
check('group keeps raw snapshots as stored', timed.rows[0].originSnapshot, 'Poblacion, Iba');
check('first boarded is the earliest stamp', timed.rows[0].firstBoardedAt, 500);
check('last boarded is the latest stamp', timed.rows[0].lastBoardedAt, 900);
check('fares counts ticket rows', timed.rows[0].fares, 2);
check(
  'distinct counts boarding municipalities only',
  distinctMunicipalities(agg.rows.map((r) => ({ ...r }))),
  3,
);
check(
  'distinct dedupes repeated origins',
  distinctMunicipalities([
    { originMunicipality: 'Iba', destinationMunicipality: 'Olongapo', passengerCount: 1, percentage: 50 },
    { originMunicipality: 'Iba', destinationMunicipality: 'Subic', passengerCount: 1, percentage: 50 },
  ]),
  1,
);
check(
  'filter entry carries short label and full scope',
  [passengerFilterEntry('PWD').label, passengerFilterEntry('PWD').scope],
  ['PWD', 'person with a disability'],
);

// ── summary sentence ─────────────────────────────────────────────────────────
check(
  'ALL states the denominator noun',
  passengerSummary({ filter: 'ALL', denom: 65, filtered: 3, tripGroups: 3, hasQuery: false }),
  "All 5 fare types · 3 groups shown · each bar is that group's share of the 65 passengers on this trip.",
);
check(
  'scoped chip names its full scope',
  passengerSummary({ filter: 'SENIOR', denom: 12, filtered: 2, tripGroups: 5, hasQuery: false }),
  "Senior citizen only · 2 of 5 groups shown · each bar is that group's share of the 12 senior citizens on this trip.",
);
check(
  'query appends the shares note',
  passengerSummary({ filter: 'ALL', denom: 65, filtered: 1, tripGroups: 3, hasQuery: true }).endsWith(
    ' The search hides rows; it does not change the shares.',
  ),
  true,
);
check(
  'zero denominator, ALL',
  passengerSummary({ filter: 'ALL', denom: 0, filtered: 0, tripGroups: 0, hasQuery: false }),
  'No boarding groups on this trip yet.',
);
check(
  'zero denominator, scoped',
  passengerSummary({ filter: 'PWD', denom: 0, filtered: 0, tripGroups: 0, hasQuery: false }),
  'Person with a disability only · no boarding groups on this trip yet.',
);

const none = aggregateByMunicipality([]);
check('empty ledger yields no rows', none.rows, []);
check('zero total, zero rows', none.totalPassengers, 0);

const zeroGuard = aggregateByMunicipality([
  {
    origin_location_snapshot: null as never,
    destination_location_snapshot: 'Caloocan, Kalakhang Maynila',
    passenger_type: 'REGULAR',
    passenger_quantity: 2,
  },
] as TicketAggregateRow[]);
check('null origin falls back to Not recorded', zeroGuard.rows[0].originMunicipality, 'Not recorded');

// ── search ──────────────────────────────────────────────────────────────────
const searchable = [
  { originMunicipality: 'Olongapo', destinationMunicipality: 'Caloocan', passengerCount: 10, percentage: 50 },
  { originMunicipality: 'Iba', destinationMunicipality: 'Olongapo', passengerCount: 10, percentage: 50 },
  { originMunicipality: 'Subic', destinationMunicipality: 'Masinloc', passengerCount: 10, percentage: 50 },
];
check('search matches origin', filterRowsBySearch(searchable, 'iba').length, 1);
check('search matches destination', filterRowsBySearch(searchable, 'caloocan').length, 1);
check('search is case-insensitive', filterRowsBySearch(searchable, 'OLONGAPO').length, 2);
check('search trims', filterRowsBySearch(searchable, '  olongapo  ').length, 2);
check('blank search keeps all rows', filterRowsBySearch(searchable, '   ').length, 3);
check('no match keeps none', filterRowsBySearch(searchable, 'zambales').length, 0);
check(
  'search reaches the raw stored snapshot',
  filterRowsBySearch(
    [
      {
        originMunicipality: 'Olongapo',
        destinationMunicipality: 'Iba',
        passengerCount: 1,
        percentage: 100,
        originSnapshot: 'Barangay 1, Olongapo',
        destinationSnapshot: 'Poblacion, Iba',
      },
    ],
    'barangay',
  ).length,
  1,
);

// ── trip ordering and selection ─────────────────────────────────────────────
const t = (id: number, endedAt: number | null, startedAt = 1_000) =>
  ({ id, started_at: startedAt, ended_at: endedAt, status: endedAt === null ? 'ACTIVE' : 'COMPLETED' }) as never;

const ordered = orderAvailableTrips(
  t(9, null),
  [t(3, 500), t(4, 900), t(2, 500)],
);
check('active first', ordered[0].id, 9);
check('completed by ended_at desc, id tiebreak', ordered.map((x) => x.id), [9, 4, 3, 2]);
check(
  'ended_at tiebreaks on id desc',
  orderAvailableTrips(null, [t(2, 500), t(3, 500)]).map((x) => x.id),
  [3, 2],
);
check('no active, completed only', orderAvailableTrips(null, [t(3, 500)])[0].id, 3);
check('no trips at all', orderAvailableTrips(null, []), []);

// ── selection fallback ──────────────────────────────────────────────────────
const available = [t(9, null), t(4, 900), t(3, 500)];
check('explicit selection wins', resolveSelectedTrip(available, 4)?.id, 4);
check('stale id falls back to default', resolveSelectedTrip(available, 99)?.id, 9);
check('null selection uses default', resolveSelectedTrip(available, null)?.id, 9);
check('empty list stays null', resolveSelectedTrip([], 4), null);
check('default trip of empty list', defaultTrip([]), null);

// ── display helpers ─────────────────────────────────────────────────────────
check(
  'composite key joins the pair',
  municipalityRowKey({ originMunicipality: 'Iba', destinationMunicipality: 'Olongapo', passengerCount: 1, percentage: 1 }),
  'Iba_Olongapo',
);
check(
  'pair label reads as a sentence',
  municipalityPairLabel({ originMunicipality: 'Iba', destinationMunicipality: 'Olongapo', passengerCount: 1, percentage: 1 }),
  'Iba to Olongapo',
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
