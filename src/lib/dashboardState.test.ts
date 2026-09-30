import { buildDashboardState, type Window } from './dashboardState';
import { startOfDay } from './format';
import type { Ticket, Trip } from '../data/konduktStore';

/**
 * Self-check for the Dashboard's hero gating and window scoping.
 *
 * Run with: npx tsx src/lib/dashboardState.test.ts
 *
 * The regression this guards: `activeTrip` was gated on the *day* window only,
 * so Week/Month periods reported "No trip running" while a trip was running.
 * A running trip is a fact about now — every window containing the present
 * moment must surface it; only fully-past windows may report null.
 */

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok ${name}`);
  }
}

const place = { barangay: 'Olongapo', municipality: 'Olongapo' };
// Mid-day Wednesday so every window below brackets it unambiguously.
const now = new Date(2026, 8, 30, 12, 0, 0);
const todayStart = startOfDay(now).getTime();
const DAY = 86_400_000;

function activeTrip(): Trip {
  return {
    id: 'trip-1',
    origin: place,
    destination: place,
    startedAt: todayStart + 9 * 3_600_000,
    endedAt: null,
    distanceMetres: 4_400,
    status: 'ACTIVE',
  };
}

function ticketOn(tripId: string): Ticket {
  return {
    id: 'tkt-1',
    tripId,
    issuedAt: now.getTime(),
    from: place,
    to: place,
    category: 'Pwd',
    qty: 2,
    fareEach: 5_000,
  };
}

const dayWindow: Window = { start: todayStart, endExclusive: todayStart + DAY };
// A standard Monday–Sunday-style week that reaches into today.
const weekWindow: Window = { start: todayStart - 6 * DAY, endExclusive: todayStart + DAY };
// Fully in the past: yesterday and earlier.
const pastWindow: Window = { start: todayStart - 2 * DAY, endExclusive: todayStart - DAY };

const trips = [activeTrip()];
const tickets = [ticketOn('trip-1')];

// 1. Day window containing now: hero shows the running trip (old behaviour kept).
const day = buildDashboardState(trips, tickets, dayWindow, now);
check('day window surfaces active trip', day.activeTrip?.id, 'trip-1');
check('day window live totals', [day.activeTicketCount, day.activePassengerCount, day.activeCollected], [1, 2, 10_000]);
check('day window is today', day.isToday, true);

// 2. Week window containing now: must ALSO surface it (the regression).
const week = buildDashboardState(trips, tickets, weekWindow, now);
check('week window surfaces active trip', week.activeTrip?.id, 'trip-1');
check('week window live totals', [week.activeTicketCount, week.activeCollected], [1, 10_000]);
check('week window is not day-today', week.isToday, false);

// 3. A window fully in the past: null, and the card reports a closed period.
const past = buildDashboardState(trips, tickets, pastWindow, now);
check('past window hides active trip', past.activeTrip, null);
check('past window is closed', past.isClosed, true);

// 4. The active trip's tickets count toward the window total even though the
//    trip itself has no endedAt to scope it — the money has been collected.
check('week window counts active-trip tickets', week.ticketCount, 1);
check('week window total earnings', week.totalEarnings, 10_000);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
