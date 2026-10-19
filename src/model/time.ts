/** "HH:MM" for t minutes after a start clock (minutes since midnight). Wraps past midnight. */
export function clock(startClock: number, t: number): string {
  const m = (((startClock + Math.round(t)) % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Warning lead time: 150 → "2 h 30 min", 60 → "1 h", 0 → "0 min". */
export function formatLead(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
