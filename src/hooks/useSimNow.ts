import { useEffect, useState } from 'react';
import { simNow, useAuth } from '../auth/AuthContext';

/** The demo clock's simulated time (epoch minutes), re-rendering every `everyMs`. Null before the clock is known. */
export function useSimNow(everyMs = 1000): number | null {
  const { health, healthAt } = useAuth();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return simNow(health, healthAt);
}
