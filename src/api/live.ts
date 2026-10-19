/** One shared Server-Sent Events connection; components subscribe to the events they care about. */
import { useEffect, useRef } from 'react';
import type { LiveEventDTO } from '../../shared/live';

type Listener = (e: LiveEventDTO) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function ensure() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/stream', { withCredentials: true });
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as LiveEventDTO;
    for (const l of listeners) l(e);
  };
  source.onerror = () => {
    // The browser reconnects automatically; if we were signed out, stop trying.
    if (source?.readyState === EventSource.CLOSED) source = null;
  };
}

export function closeLive() {
  source?.close();
  source = null;
}

// Close the stream whenever the page goes away (reload, navigation, back/forward cache) and
// reopen it if the page is restored. A stream left open by an old page keeps holding one of the
// browser's six connections per host, so a few reloads would stall every request.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', closeLive);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && listeners.size) ensure();
  });
}

/** Calls `fn` for live events (optionally only for one patient). */
export function useLive(fn: Listener, patientId?: string | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ensure();
    const l: Listener = (e) => {
      if (patientId && 'patientId' in e && e.patientId !== patientId) return;
      ref.current(e);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [patientId]);
}
