import type { TerminalRowRecord } from '../data/schema';
import { formatKm, formatPeso, type FareRules } from './addTicketFare';

/**
 * Pure route logic for the Add-trip screen.
 *
 * No React, no SQLite — the validation order and the distance arithmetic are
 * the parts a second implementation gets wrong, so they live here where plain
 * `tsx` can test them. The screen renders these facts; it does not re-derive
 * them.
 */

/**
 * Validation, in the order the spec fixes.
 *
 * The active-trip rule comes first deliberately: a user with a trip already
 * running who has not picked terminals yet must be told about the running
 * trip — telling them to choose terminals is advice that cannot fix the real
 * problem. Each failure names its actual cause; none collapse into one string.
 */
export function validateRoute(input: {
  hasActiveTrip: boolean;
  origin: TerminalRowRecord | null;
  destination: TerminalRowRecord | null;
}): string | null {
  if (input.hasActiveTrip) {
    return 'A trip is already running. End it before starting another.';
  }
  if (!input.origin) {
    return 'Choose a departure terminal.';
  }
  if (!input.destination) {
    return 'Choose a destination terminal.';
  }
  if (input.origin.id === input.destination.id) {
    return 'Origin and destination are the same terminal.';
  }
  if (input.origin.km_marker < 0 || input.destination.km_marker < 0) {
    return 'A terminal KM marker is not configured.';
  }
  const distance = routeDistance(input.origin, input.destination);
  if (distance === null || distance <= 0) {
    return 'The route distance is zero. Choose different terminals.';
  }
  return null;
}

/**
 * Distance the route will produce, in integer thousandths of a km.
 *
 * Absolute — the route works in both directions. Null, not zero, when either
 * end is unselected or carries a negative marker: zero is a real value that
 * means a degenerate route, while null means "nothing to compute yet", and the
 * two render differently.
 */
export function routeDistance(
  origin: TerminalRowRecord | null,
  destination: TerminalRowRecord | null,
): number | null {
  if (!origin || !destination) return null;
  if (origin.km_marker < 0 || destination.km_marker < 0) return null;
  return Math.abs(destination.km_marker - origin.km_marker);
}

/**
 * What a chosen route will bill, in the reference's measure(): the route
 * distance, the floor applied to it, and the rate for the chosen road.
 *
 * `ok: false` carries the refusal in the app's own words — the same sentences
 * `startTrip` re-validates inside its transaction, so a conductor is never
 * shown a refusal here they cannot meet at the press.
 */
export type TripMeasure = {
  ok: boolean;
  reason: string | null;
  distMilli: number;
  flooredMilli: number;
  billableMilli: number;
  rateCentavos: number;
  minDistBinds: boolean;
};

/**
 * Measures a route against the fare rules, integer end to end.
 *
 * The order is the rule: the minimum distance is applied to the ROUTE
 * distance, and that floored distance is what bills — nothing is added to it
 * on any road, so this card and the boarding screen always quote the same
 * billable figure for the same pair of terminals.
 */
export function measureTrip(input: {
  origin: TerminalRowRecord | null;
  destination: TerminalRowRecord | null;
  usesSctex: boolean;
  rules: FareRules;
}): TripMeasure {
  const { origin, destination, usesSctex, rules } = input;
  const fail = (reason: string): TripMeasure => ({
    ok: false,
    reason,
    distMilli: 0,
    flooredMilli: 0,
    billableMilli: 0,
    rateCentavos: 0,
    minDistBinds: false,
  });
  // Not chosen yet is not a validation failure, and it must not borrow a
  // sentence about a terminal that disappeared under a filled form.
  if (!origin || !destination) return fail('Choose an origin and a destination.');
  if (origin.id === destination.id) return fail('Origin and destination are the same terminal.');
  if (origin.km_marker < 0 || destination.km_marker < 0) {
    return fail('A terminal KM marker is not configured.');
  }
  const distMilli = Math.abs(destination.km_marker - origin.km_marker);
  if (distMilli === 0) return fail('The route distance is zero. Choose different terminals.');

  const rateCentavos = usesSctex ? rules.expressRatePerKmCentavos : rules.ratePerKmCentavos;
  const flooredMilli = Math.max(distMilli, rules.minimumDistanceMilli);
  return {
    ok: true,
    reason: null,
    distMilli,
    flooredMilli,
    billableMilli: flooredMilli,
    rateCentavos,
    minDistBinds: distMilli < rules.minimumDistanceMilli,
  };
}

/**
 * The estimate card's one prose line. The minimum fare is named on every
 * branch, not only the branch where it binds: a hand-written distance table is
 * where the ₱50 minimum goes missing, and this is the one place on the screen
 * a conductor can read it without opening anything.
 */
export function estimateNote(input: {
  measure: TripMeasure;
  rules: FareRules;
}): string {
  const { measure, rules } = input;
  const minFare =
    ` The minimum fare of ${formatPeso(rules.minimumFareCentavos)} applies to every boarding on it.`;
  if (measure.minDistBinds) {
    return (
      `These two terminals are ${formatKm(measure.distMilli)} apart, so ` +
      `${formatKm(measure.flooredMilli)} is billed against the ` +
      `${formatKm(rules.minimumDistanceMilli)} minimum distance.` +
      minFare
    );
  }
  return `On this road the route distance is the billable distance.` + minFare;
}

/** Case-insensitive name filter over the terminal list, preserving order. */
export function filterTerminals(
  terminals: TerminalRowRecord[],
  query: string,
): TerminalRowRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return terminals;
  return terminals.filter((terminal) => terminal.name.toLowerCase().includes(needle));
}

/** The 24-hour clock stamp the preview shows. Cached, never per render. */
let previewTimeFormatter: Intl.DateTimeFormat | null = null;
export function formatPreviewTime(millis: number) {
  previewTimeFormatter ??= new Intl.DateTimeFormat('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return previewTimeFormatter.format(millis);
}

/** The medium date stamp the header and preview share. Cached once. */
let previewDateFormatter: Intl.DateTimeFormat | null = null;
export function formatPreviewDate(millis: number) {
  previewDateFormatter ??= new Intl.DateTimeFormat('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return previewDateFormatter.format(millis);
}
