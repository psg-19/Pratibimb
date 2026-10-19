/**
 * Time helpers. The engine works in whole minutes since the Unix epoch (UTC);
 * everything user-facing is shown in India Standard Time.
 */
export const TZ = 'Asia/Kolkata';
export const MIN = 60_000;
export const IST_OFFSET_MIN = 330;

export const toMin = (ms: number) => Math.floor(ms / MIN);
export const toMs = (min: number) => min * MIN;

const hm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });

/** "21:40" in IST for an epoch minute. */
export function clockIST(min: number): string {
  return hm.format(new Date(toMs(min)));
}

/** "13 Oct" in IST. */
export function dayIST(min: number): string {
  return dayFmt.format(new Date(toMs(min)));
}

/** Minutes since local (IST) midnight for an epoch minute. */
export function minuteOfDayIST(min: number): number {
  return (((min + IST_OFFSET_MIN) % 1440) + 1440) % 1440;
}

/** Epoch minute of local (IST) midnight on the day containing `min`. */
export function istMidnight(min: number): number {
  return min - minuteOfDayIST(min);
}

/** Epoch minute for an IST calendar time. */
export function istTime(year: number, month: number, day: number, hour: number, minute: number): number {
  return toMin(Date.UTC(year, month - 1, day, hour, minute)) - IST_OFFSET_MIN;
}

/** "2 h 30 min" style durations. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
