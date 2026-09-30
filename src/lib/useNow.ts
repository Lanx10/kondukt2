import { useEffect, useState } from 'react';

/**
 * Device-local clock, re-rendered on the minute boundary.
 *
 * One hook for every screen that shows a time. It schedules against the next
 * minute boundary rather than firing every 60s, so the first paint after the
 * tick is the correct one and the interval never drifts a second out of phase.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const msToNextMinute = 60000 - (Date.now() % 60000);
    const tick = setInterval(() => setNow(new Date()), msToNextMinute);
    return () => clearInterval(tick);
  }, []);
  return now;
}
