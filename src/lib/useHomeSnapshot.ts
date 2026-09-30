import { useEffect, useMemo, useState } from 'react';
import {
  fetchHistorySummary,
  fetchHistoryTotals,
  fetchLastCompletedTrip,
  type HistorySummary,
  type HistoryTotals,
  type LastCompletedTrip,
} from '../data/historyStore';
import { fetchTripBoard, subscribeToTrips } from '../data/tripTicketsStore';
import { startOfLocalDay } from './historyState';
import { useNow } from './useNow';

/** The running trip, as the home hero needs it. */
export type HomeActiveTrip = {
  id: number;
  trip_number: string;
  origin: string;
  destination: string;
  startedAt: number;
};

export type HomeSnapshot = {
  status: 'loading' | 'ready' | 'error';
  today: HistorySummary;
  yesterdayEarnings: number;
  totals: HistoryTotals;
  activeTrip: HomeActiveTrip | null;
  lastCompleted: LastCompletedTrip | null;
};

const ZERO_SUMMARY: HistorySummary = {
  tripCount: 0,
  ticketCount: 0,
  passengerCount: 0,
  earnings: 0,
  distance_km_milli: 0,
};

const ZERO_TOTALS: HistoryTotals = {
  tripCount: 0,
  ticketCount: 0,
  dayCount: 0,
};

/**
 * Everything the home screen shows, in one read.
 *
 * Four queries, not one: today's window, yesterday's, the all-time totals for
 * the storage note, and the trip board for the running trip plus the last run.
 * They are issued together and repainted together, because a home screen whose
 * hero and whose tiles disagree about today is worse than a slow one.
 *
 * The store's own change notification re-runs all of it, so recording a fare
 * or ending a trip repaints the page without a manual refresh.
 */
export function useHomeSnapshot(): HomeSnapshot {
  const now = useNow();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [today, setToday] = useState<HistorySummary>(ZERO_SUMMARY);
  const [yesterdayEarnings, setYesterdayEarnings] = useState(0);
  const [totals, setTotals] = useState<HistoryTotals>(ZERO_TOTALS);
  const [activeTrip, setActiveTrip] = useState<HomeActiveTrip | null>(null);
  const [lastCompleted, setLastCompleted] = useState<LastCompletedTrip | null>(null);

  // Local midnights, counted on the local calendar — the same rule every window
  // in this app uses. A UTC day would file an evening fare under tomorrow.
  const todayStart = useMemo(() => startOfLocalDay(now.getTime()), [now]);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      Promise.all([
        fetchHistorySummary({ start: todayStart, endExclusive: todayStart + 86_400_000 }),
        fetchHistorySummary({ start: todayStart - 86_400_000, endExclusive: todayStart }),
        fetchHistoryTotals(),
        fetchLastCompletedTrip(),
        fetchTripBoard(),
      ])
        .then(([todayRow, yesterdayRow, totalsRow, lastTrip, board]) => {
          if (cancelled) return;
          setToday(todayRow);
          setYesterdayEarnings(yesterdayRow.earnings);
          setTotals(totalsRow);
          setLastCompleted(lastTrip);
          setActiveTrip(
            board.active
              ? {
                  id: board.active.id,
                  trip_number: board.active.trip_number,
                  origin: board.active.origin_location_snapshot,
                  destination: board.active.destination_location_snapshot,
                  startedAt: board.active.started_at,
                }
              : null,
          );
          setStatus('ready');
        })
        .catch(() => {
          if (!cancelled) setStatus('error');
        });

    run();
    const unsubscribe = subscribeToTrips(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [todayStart]);

  return {
    status,
    today,
    yesterdayEarnings,
    totals,
    activeTrip,
    lastCompleted,
  };
}
