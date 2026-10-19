import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ClockState, Health, Me } from '../../shared/api';
import { api, ApiError } from '../api/client';
import { closeLive } from '../api/live';

interface AuthValue {
  me: Me | null;
  health: Health | null;
  /** Wall-clock ms when `health.clock` was read, so simulated time can be extrapolated from it. */
  healthAt: number;
  ready: boolean;
  login: (email: string, password: string) => Promise<Me>;
  signup: (body: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Re-reads the server clock (after someone changes its speed, pauses it or restarts the demo). */
  refreshHealth: () => Promise<void>;
  /** Applies a clock state the server just returned. */
  applyClock: (clock: ClockState) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthAt, setHealthAt] = useState(() => Date.now());
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      setMe(null);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth(h);
      setHealthAt(Date.now());
    } catch {
      // Keep the last known clock; the next clock event or reload tries again.
    }
  }, []);

  const applyClock = useCallback((clock: ClockState) => {
    setHealth((h) => (h ? { ...h, clock } : h));
    setHealthAt(Date.now());
  }, []);

  useEffect(() => {
    void Promise.all([refresh(), refreshHealth()]).finally(() => setReady(true));
  }, [refresh, refreshHealth]);

  const value: AuthValue = {
    me,
    health,
    healthAt,
    ready,
    login: async (email, password) => {
      const next = await api.login(email, password);
      closeLive();
      setMe(next);
      void refreshHealth();
      return next;
    },
    signup: async (body) => {
      const next = await api.signup(body);
      closeLive();
      setMe(next);
      void refreshHealth();
    },
    logout: async () => {
      await api.logout();
      closeLive();
      setMe(null);
    },
    refresh,
    refreshHealth,
    applyClock,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** Simulated time (epoch minutes) now, extrapolated from the last clock reading. */
// eslint-disable-next-line react-refresh/only-export-components
export function simNow(health: Health | null, healthAt: number): number | null {
  if (!health) return null;
  const c = health.clock;
  if (c.paused || c.speed <= 0) return c.now;
  return Math.floor((c.exact ?? c.now) + ((Date.now() - healthAt) / 60_000) * c.speed);
}
