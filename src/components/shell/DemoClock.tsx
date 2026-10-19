import { useState } from 'react';
import { clockIST, dayIST } from '../../../shared/time';
import { api } from '../../api/client';
import { useLive } from '../../api/live';
import { useAuth } from '../../auth/AuthContext';
import { useSimNow } from '../../hooks/useSimNow';

const SPEEDS = [1, 15, 60] as const;

/** Simulated time for the demo, with pause and speed controls (the twin's world runs on this clock). */
export function DemoClock() {
  const { health, me, refreshHealth, applyClock } = useAuth();
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useSimNow();

  // Someone else changed the clock (another tab, the care team, a demo restart).
  useLive((e) => {
    if (e.type === 'clock') void refreshHealth();
  });
  if (!health || now == null) return null;
  const state = health.clock;

  const update = async (body: { speed?: number; paused?: boolean }) => {
    setError(null);
    try {
      applyClock(await api.clock(body));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the clock.'); }
  };

  return (
    <div className="dclock" role="group" aria-label="Demo clock">
      <span className="dclock__time mono" title="Simulated time (IST)">
        <span className="sr-only">Simulated time </span>
        {dayIST(now)} · {clockIST(now)}
      </span>
      <button type="button" className="dclock__btn hit" aria-pressed={state.paused} onClick={() => void update({ paused: !state.paused })}>
        {state.paused ? 'Play' : 'Pause'}
      </button>
      <span className="sr-only" id="speed-l">
        Clock speed
      </span>
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          className="dclock__btn hit"
          aria-pressed={!state.paused && state.speed === s}
          aria-describedby="speed-l"
          onClick={() => void update({ speed: s, paused: false })}
        >
          {s}×
        </button>
      ))}
      {me?.user.role === 'clinician' ? (
        <button
          type="button"
          className="dclock__btn hit"
          disabled={resetting}
          onClick={async () => {
            if (!window.confirm('Restart the demo at 21:40? This erases everything done since, and signs everyone out.')) return;
            setResetting(true);
            setError(null);
            try {
              await api.resetDemo();
              window.location.assign('/login');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not restart the demo.');
              setResetting(false);
            }
          }}
        >
          {resetting ? 'Restarting…' : 'Restart demo'}
        </button>
      ) : null}
      {error ? <span className="form-error" role="alert">{error}</span> : null}
    </div>
  );
}
