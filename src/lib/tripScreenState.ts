import { centavos } from './tripTicketsFormat';
import type { TripRowRecord } from '../data/schema';

/**
 * Pure Trip screen logic.
 *
 * No React, no SQLite: the branch the screen renders and the two display rules
 * that are easy to get wrong live here, where plain `tsx` can check them.
 * The screen renders these facts; it does not re-derive them.
 *
 * Two rules with teeth:
 * - "No trip running" and "nothing ever recorded" are different screens. A
 *   driver between runs and a driver on a fresh install are both missing an
 *   active trip, and only one of them has a history to look back at.
 * - A missing number prints a word, never a zero. A trip that took nothing
 *   reads `—`, and a route nobody measured reads "Distance not recorded" —
 *   a `0.000 km` would be a claim the data does not make.
 */

/** Which trip card the screen shows. All three are reachable in the field. */
export type TripBoardState = 'running' | 'idle' | 'empty';

export function tripBoardState(
  active: TripRowRecord | null | undefined,
  recentCompleted: TripRowRecord[],
): TripBoardState {
  if (active) return 'running';
  return recentCompleted.length > 0 ? 'idle' : 'empty';
}

const DASH = '\u2014';

/** Centavos on a card or a row: the peso, or a dash when nothing was taken. */
export function collectedLabel(earnings: number): string {
  return earnings > 0 ? centavos(earnings) : DASH;
}

/**
 * Thousandths of a km as the screen's distance line, never a bare zero.
 *
 * One decimal, the same reading `format.ts`'s `km()` gives Dashboard: a trip
 * that measures 4 400 m must not read "4.400 km" here and "4.4 km" there.
 * Config screens that print a stored value exactly keep `distanceKm`.
 */
export function distanceLabel(distanceKmMilli: number): string {
  return distanceKmMilli > 0
    ? `${(distanceKmMilli / 1000).toFixed(1)} km`
    : 'Distance not recorded';
}

/** "1 fare" / "4 fares" — the count beside the money on a recent row. */
export function pluralFares(count: number): string {
  return `${count} fare${count === 1 ? '' : 's'}`;
}
