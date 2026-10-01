import { formatScaled, SCALE_PESO } from './fareFormat';
import { km, php } from './format';
import type { PassengerType, TicketRowRecord, TripRowRecord } from '../data/schema';

/** Re-exported: the screen names passenger types from here. */
export type { PassengerType };

/**
 * Pure Add-ticket screen logic.
 *
 * No React, no SQLite. Two reasons it is a module rather than a screen body:
 * the fare is arithmetic over stored integers, and the commit button's refusal
 * is the store's contract reproduced word for word — both are the parts a
 * second implementation gets subtly wrong, and both are testable under plain
 * `tsx`.
 *
 * The fare is an **output**. Nothing here accepts an authored price, and the
 * store is handed `farePerPassengerCentavos` already derived. An input a rule
 * can contradict is how one shift gets counted twice.
 *
 * Units are the store's own: money in centavos, distance in milli-km
 * (thousandths of a kilometre). Every division rounds half-up on integers.
 */

// ── Bounds ──────────────────────────────────────────────────────────────────

/** A group runs 1 to 20. Twenty is the coach; beyond it is two boardings. */
export const QTY_MAX = 20;
export const QTY_MIN = 1;

/**
 * How many committed tickets the screen lists.
 *
 * The section is the receipt for the press that just happened, not the ledger:
 * the full list is Trip tickets' job, and a seventh row would push the commit
 * button off a phone screen. The cap states itself, so nobody waits for a row
 * that is not coming.
 */
export const RECENT_LIMIT = 6;

/**
 * The four fare keys, and the words the chips wear.
 *
 * The label is prose and the key is the column: the chip says "Senior" because
 * that is the vocabulary the driver uses, and the store is written
 * `SENIOR_CITIZEN` — second `I`. An invented key silently prices at the
 * standard rate, so the two never live in the same string.
 */
export const PASSENGER_TYPES: { key: PassengerType; label: string }[] = [
  { key: 'REGULAR', label: 'Regular' },
  { key: 'STUDENT', label: 'Student' },
  { key: 'SENIOR_CITIZEN', label: 'Senior' },
  { key: 'PWD', label: 'PWD' },
];

/** Everything except REGULAR takes the special rate. */
export function takesSpecialRate(type: PassengerType): boolean {
  return type !== 'REGULAR';
}

// ── The rules ───────────────────────────────────────────────────────────────

/** The stored fare configuration in the units the calculator reads. */
export type FareConfigRow = {
  minimum_fare: number;
  minimum_distance_milli: number;
  rate_per_km: number;
  express_rate_per_km?: number;
  special_rate_per_km: number;
  special_express_rate_per_km?: number;
};

export type FareRules = {
  minimumFareCentavos: number;
  minimumDistanceMilli: number;
  ratePerKmCentavos: number;
  expressRatePerKmCentavos: number;
  specialRatePerKmCentavos: number;
  specialExpressRatePerKmCentavos: number;
};

/**
 * Projects the stored fare row onto the calculator's inputs.
 *
 * The express-way columns fall back to their ordinary counterparts **only when
 * the column is absent entirely** — `??`, not `||`. A device whose database
 * predates the express-way naming still has the old `express_rate_per_km` value
 * in its row and the migration copies it across, but until that lands, falling
 * back keeps the device charging what it always charged. A `0` a conductor
 * actually entered is a real value and is never substituted: `||` would make
 * the cell quietly read as a different rate than the one on the form.
 */
export function toFareRules(fare: FareConfigRow): FareRules {
  return {
    minimumFareCentavos: fare.minimum_fare,
    minimumDistanceMilli: fare.minimum_distance_milli,
    ratePerKmCentavos: fare.rate_per_km,
    expressRatePerKmCentavos: fare.express_rate_per_km ?? fare.rate_per_km,
    specialRatePerKmCentavos: fare.special_rate_per_km,
    specialExpressRatePerKmCentavos:
      fare.special_express_rate_per_km ?? fare.special_rate_per_km,
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Milli-km → "86.2 km". Always one decimal: the rates are pesos per km. */
export function formatKm(milli: number): string {
  return km(milli / 1000);
}

/** Centavos per km → "₱2.25". Trailing zeros trimmed, like every rate here. */
export function formatRate(centavos: number): string {
  return `₱${formatScaled(centavos, SCALE_PESO)}`;
}

/** Centavos → the app's pinned peso string. Two decimals, always. */
export function formatPeso(centavos: number): string {
  return php(centavos / 100);
}

// ── The calculator ──────────────────────────────────────────────────────────

export type FareBreakdown = {
  distanceMilli: number;
  billableMilli: number;
  rateCentavos: number;
  rateLabel: string;
  perPassengerCentavos: number;
  rawCentavos: number;
  totalCentavos: number;
  distanceFloorApplied: boolean;
  fareFloorApplied: boolean;
};

export type PriceInput = {
  distanceMilli: number | null;
  usesExpressWay: boolean;
  passengerType: PassengerType;
  quantity: number;
  rules: FareRules;
};

/**
 * The one function the fare card runs.
 *
 * The order is the rule and is not negotiable: the **distance floor applies
 * first**, and the **fare floor applies after** rounding. Nothing is added to
 * the distance between the two, so get either floor wrong and the minimum
 * stops binding on exactly the short hops where it exists to bind.
 *
 * Half-up rounding is integer: `floor((rate × billable + 500) / 1000)`. No
 * floats, so 86.2 km × ₱2.25 is ₱193.95 on every device rather than ₱193.94 on
 * the one with a different FPU.
 *
 * The rate is picked by TWO tests: whether the passenger is discounted, and
 * which road the trip runs on. Before, the discounted branch ignored the road
 * and every PWD, student and senior paid the ordinary rate even on the express
 * way, because the schema had one discounted column for both roads. It now has
 * two, and a conductor who charges the express way differently for a
 * concessionaire can say so.
 */
export function priceTicket(input: PriceInput): FareBreakdown | null {
  const { rules } = input;
  if (input.distanceMilli === null) return null;

  const discount = takesSpecialRate(input.passengerType);
  const onExpress = input.usesExpressWay;

  const rateCentavos = discount
    ? onExpress
      ? rules.specialExpressRatePerKmCentavos
      : rules.specialRatePerKmCentavos
    : onExpress
      ? rules.expressRatePerKmCentavos
      : rules.ratePerKmCentavos;

  const rateLabel = discount
    ? onExpress
      ? 'Special express way rate per km'
      : 'Special rate per km'
    : onExpress
      ? 'Express way rate per km'
      : 'Ordinary rate per km';

  const distanceFloorApplied = input.distanceMilli < rules.minimumDistanceMilli;
  const billableMilli = distanceFloorApplied ? rules.minimumDistanceMilli : input.distanceMilli;
  const rawCentavos = Math.floor((rateCentavos * billableMilli + 500) / 1000);
  const fareFloorApplied = rawCentavos < rules.minimumFareCentavos;
  const perPassengerCentavos = fareFloorApplied ? rules.minimumFareCentavos : rawCentavos;
  const quantity = clampQuantity(input.quantity);

  return {
    distanceMilli: input.distanceMilli,
    billableMilli,
    rateCentavos,
    rateLabel,
    perPassengerCentavos,
    rawCentavos,
    totalCentavos: perPassengerCentavos * quantity,
    distanceFloorApplied,
    fareFloorApplied,
  };
}

/** The stepper's bound, in one place — the buttons and the maths share it. */
export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return QTY_MIN;
  return Math.min(QTY_MAX, Math.max(QTY_MIN, Math.trunc(quantity)));
}

/**
 * Which minimum bound this fare, said in the words the ticket sheet reuses.
 *
 * Both can bind, and on a provincial route the fare floor is the normal case —
 * a design that only ever renders the linear one has not tested the hop that
 * matters. A peso read back months later has to be explicable by the rules, not
 * by whatever the rates say today.
 */
export function minimumNotes(breakdown: FareBreakdown, rules: FareRules): string[] {
  const notes: string[] = [];
  if (breakdown.distanceFloorApplied) {
    notes.push(
      `The barangays are ${formatKm(breakdown.distanceMilli)} apart, so ` +
        `${formatKm(breakdown.billableMilli)} is billed against the ` +
        `${formatKm(rules.minimumDistanceMilli)} minimum distance.`,
    );
  }
  if (breakdown.fareFloorApplied) {
    notes.push(
      `That works out under the ${formatPeso(rules.minimumFareCentavos)} minimum fare, so ` +
        `${formatPeso(breakdown.perPassengerCentavos)} per passenger is charged.`,
    );
  }
  return notes;
}

/**
 * The same explanation for a ticket that is already in the ledger.
 *
 * A stored ticket carries no distance column, so a leg fare is read from what
 * the ticket recorded rather than re-derived from a route that may have been
 * edited since. Where the leg is the trip's own distance — a rider who stayed
 * on for the whole way — the floors are re-derived and printed, because that
 * case can be, and the trip's road is applied because it prices every ticket
 * the trip recorded.
 */
export function ticketFareNote(input: {
  distanceMilli: number | null;
  usesExpressWay: boolean;
  farePerPassengerCentavos: number;
  rules: FareRules;
}): string {
  if (input.distanceMilli === null) {
    return (
      `This ticket recorded ${formatPeso(input.farePerPassengerCentavos)} per passenger. ` +
      'The leg distance is not stored with the ticket, so the fare is read from the amount ' +
      'recorded on it rather than re-derived from a route that may have changed.'
    );
  }

  const breakdown = priceTicket({
    distanceMilli: input.distanceMilli,
    // The road is a setting on the trip, so it prices every ticket the trip
    // recorded — including the one being read back.
    usesExpressWay: input.usesExpressWay,
    passengerType: 'REGULAR',
    quantity: QTY_MIN,
    rules: input.rules,
  });
  const notes = breakdown ? minimumNotes(breakdown, input.rules) : [];
  if (notes.length === 0) {
    return (
      `${formatKm(input.distanceMilli)} at ${formatRate(breakdown?.rateCentavos ?? 0)} is ` +
      `${formatPeso(input.farePerPassengerCentavos)} per passenger. Neither minimum applied.`
    );
  }
  return notes.join(' ');
}

// ── Commit refusal ──────────────────────────────────────────────────────────

/** A terminal row as this screen reads it. */
export type TerminalRow = {
  id: number;
  name: string;
  km_marker: number;
  is_active: number;
};

/**
 * Why the commit button is disabled, or null when the ticket can be recorded.
 *
 * All five store sentences appear verbatim and in the store's own order
 * (`startTrip`, `tripTicketsStore.ts:823-843`): a missing row first, then a row
 * that is still there but deactivated, then the same terminal twice, then an
 * unconfigured KM marker, then a zero distance. A screen that paraphrases them
 * lets a driver compose a ticket the store then throws away, and the difference
 * is invisible until the write fails.
 *
 * The two "not usable" sentences are not duplicates. `no longer exists` is a
 * row that is gone; `was deactivated` is a row that is still on file and
 * `is_active !== 1`. They are told apart here, which is why `terminals` is the
 * device's whole terminal list rather than the active subset: an active-only
 * read cannot tell the two apart, and collapsing them would tell a driver
 * something the store would not.
 */
export function commitBlockReason(input: {
  board: TerminalRow | null;
  drop: TerminalRow | null;
  terminals: TerminalRow[];
  rules: FareRules | null;
}): string | null {
  const { board, drop, terminals, rules } = input;
  if (!board) return 'Choose a boarding point.';
  if (!drop) return 'Choose a destination.';

  const onFile = (terminal: TerminalRow) =>
    terminals.find((candidate) => candidate.id === terminal.id);
  const boardRow = onFile(board);
  const dropRow = onFile(drop);

  if (!boardRow || !dropRow) {
    return 'A selected barangay no longer exists. Re-choose the route.';
  }
  if (boardRow.is_active !== 1 || dropRow.is_active !== 1) {
    return 'A selected barangay was deactivated. Re-choose the route.';
  }
  if (board.id === drop.id) {
    return 'The boarding point and the destination are the same barangay.';
  }
  // The marker and the distance are read off the file rows, not the selection:
  // the store re-reads both terminals inside its own check, so a selection
  // carrying a stale KM would refuse here and accept there.
  if (boardRow.km_marker < 0 || dropRow.km_marker < 0) {
    return 'A barangay KM marker is not configured.';
  }
  if (Math.abs(dropRow.km_marker - boardRow.km_marker) <= 0) {
    return 'The route distance is zero. Choose different barangays.';
  }
  if (rules === null) {
    return 'This device has no fare rules yet, so a ticket cannot be priced.';
  }
  return null;
}

/**
 * Whether a terminal row can be picked on this screen.
 *
 * Same terminal as the other end, or deactivated on the device — the two cases
 * the sheet marks rather than hides, because a driver has to see why a row will
 * not take a tap.
 */
export function terminalPickState(
  terminal: TerminalRow,
  other: TerminalRow | null,
): { selectable: boolean; reason: 'inactive' | 'inUse' | null } {
  if (terminal.is_active !== 1) return { selectable: false, reason: 'inactive' };
  if (other !== null && other.id === terminal.id) return { selectable: false, reason: 'inUse' };
  return { selectable: true, reason: null };
}

/** The driven distance between the two ends, or null while a side is unchosen. */
export function routeDistanceMilli(
  board: TerminalRow | null,
  drop: TerminalRow | null,
): number | null {
  if (!board || !drop) return null;
  if (board.km_marker < 0 || drop.km_marker < 0) return null;
  return Math.abs(drop.km_marker - board.km_marker);
}

// ── The ledger ──────────────────────────────────────────────────────────────

/** A committed ticket, as the ledger reads it back. */
export type LedgerTicket = TicketRowRecord;

export type LedgerFold = {
  head: { totalCentavos: number; passengers: number; count: number };
  recent: LedgerTicket[];
  hidden: number;
};

/**
 * Folds one trip's committed tickets into the head figure and the short list.
 *
 * Newest first, by `created_at` then `id` — the same order the store's query
 * returns, repeated here so the fold does not depend on its caller's sort. The
 * head counts the **whole** ledger while the list shows six, and the two are
 * never added together: a running fare that reads as a collected one is how a
 * shift gets double-counted.
 */
export function foldLedger(tickets: LedgerTicket[]): LedgerFold {
  const ordered = [...tickets].sort(
    (a, b) => b.created_at - a.created_at || b.id - a.id,
  );
  const head = ordered.reduce(
    (acc, ticket) => ({
      totalCentavos: acc.totalCentavos + ticket.total_fare,
      passengers: acc.passengers + ticket.passenger_quantity,
      count: acc.count + 1,
    }),
    { totalCentavos: 0, passengers: 0, count: 0 },
  );
  return {
    head,
    recent: ordered.slice(0, RECENT_LIMIT),
    hidden: ordered.length - RECENT_LIMIT,
  };
}

/**
 * The line under the list, when there is one. Null while everything fits —
 * a cap note on a list that is not capped is noise.
 */
export function ledgerCapLine(fold: LedgerFold): string | null {
  if (fold.hidden <= 0) return null;
  return (
    `Showing the ${RECENT_LIMIT} most recent of ${fold.head.count} recorded on this trip · ` +
    `${fold.head.passengers} passengers carried`
  );
}

/** "Regular · 2 passengers" — the composition, above the table. */
export function compositionLabel(type: PassengerType, quantity: number): string {
  const chip = PASSENGER_TYPES.find((entry) => entry.key === type);
  const noun = clampQuantity(quantity) === 1 ? 'passenger' : 'passengers';
  return `${chip?.label ?? type} · ${clampQuantity(quantity)} ${noun}`;
}

// ── View state ──────────────────────────────────────────────────────────────

/** The trip row this screen needs: everything the fare card reads off it. */
export type AddTicketTrip = TripRowRecord;

export type AddTicketView =
  | { kind: 'error'; message: string }
  | { kind: 'loading' }
  | { kind: 'notrips' }
  | { kind: 'nofares'; trip: AddTicketTrip; tickets: LedgerTicket[]; terminals: TerminalRow[] }
  | {
      kind: 'ready';
      trip: AddTicketTrip;
      tickets: LedgerTicket[];
      terminals: TerminalRow[];
      rules: FareRules;
    };

/**
 * The single fold from an observation to a branch.
 *
 * Error outranks loading so a failed read shows its retry rather than a
 * spinner that never resolves. `nofares` is a state of its own, not an error:
 * a fresh install has no rules, the route is still true, and the screen's job
 * is to say a price cannot be derived rather than to store a wrong one.
 */
export function computeAddTicketView(input: {
  error: string | null;
  loading: boolean;
  trip: AddTicketTrip | null;
  tickets: LedgerTicket[];
  terminals: TerminalRow[];
  fare: FareConfigRow | null;
}): AddTicketView {
  if (input.error !== null) return { kind: 'error', message: input.error };
  if (input.loading) return { kind: 'loading' };
  if (input.trip === null) return { kind: 'notrips' };
  if (input.fare === null) {
    return {
      kind: 'nofares',
      trip: input.trip,
      tickets: input.tickets,
      terminals: input.terminals,
    };
  }
  return {
    kind: 'ready',
    trip: input.trip,
    tickets: input.tickets,
    terminals: input.terminals,
    rules: toFareRules(input.fare),
  };
}
