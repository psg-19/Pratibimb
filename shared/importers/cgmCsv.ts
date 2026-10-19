/**
 * Parses CGM exports into readings: Dexcom Clarity CSV, LibreView CSV, or any CSV with a
 * timestamp column and a glucose column. Times are read as IST wall-clock time; mmol/L
 * values are converted to mg/dL.
 */
import { istTime } from '../time';

export interface ParsedCgm {
  format: 'dexcom' | 'libreview' | 'generic';
  readings: { t: number; mgdl: number }[];
  skipped: number;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === sep && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Accepts 2026-10-13T21:40:00, 2026-10-13 21:40, 13-10-2026 21:40, 13/10/2026 09:40 PM, 10/13/2026 21:40. */
export function parseTimestamp(s: string, dayFirst = true): number | null {
  const t = s.trim();
  const valid = (year: number, month: number, day: number, hour: number, minute: number) => {
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day && hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(t);
  if (m) {
    if (!valid(+m[1], +m[2], +m[3], +m[4], +m[5])) return null;
    if (m[6]) { const time = Date.parse(t); return Number.isFinite(time) ? Math.floor(time / 60_000) : null; }
    return istTime(+m[1], +m[2], +m[3], +m[4], +m[5]);
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(t);
  if (m) {
    let [a, b] = [+m[1], +m[2]];
    if (b > 12 || (!dayFirst && a <= 12)) [a, b] = [b, a];
    let h = +m[4];
    if (m[6]) {
      if (h < 1 || h > 12) return null;
      const pm = m[6].toUpperCase() === 'PM';
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return valid(+m[3], b, a, h, +m[5]) ? istTime(+m[3], b, a, h, +m[5]) : null;
  }
  return null;
}

export function parseCgmCsv(text: string): ParsedCgm {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  let sep = ',';
  // Find the header row: the first line naming a time column and a glucose column.
  let headerIdx = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    sep = (lines[i].match(/;/g)?.length ?? 0) > (lines[i].match(/,/g)?.length ?? 0) ? ';' : ',';
    const cells = splitCsvLine(lines[i], sep).map((c) => c.toLowerCase());
    if (cells.some((c) => /time|date/.test(c)) && cells.some((c) => /glucose|mg\/dl|mmol|sgv|egv/.test(c))) {
      headerIdx = i;
      header = cells;
      break;
    }
  }
  if (headerIdx < 0) throw new Error('Could not find timestamp and glucose columns in this file.');

  const format: ParsedCgm['format'] = header.some((h) => h.startsWith('glucose value')) ? 'dexcom' : header.some((h) => h.includes('historic glucose')) ? 'libreview' : 'generic';
  const timeCol =
    format === 'dexcom'
      ? header.findIndex((h) => h.startsWith('timestamp'))
      : format === 'libreview'
        ? header.findIndex((h) => h.includes('device timestamp'))
        : header.findIndex((h) => /time|date/.test(h));
  const glucoseCols =
    format === 'dexcom'
      ? [header.findIndex((h) => h.startsWith('glucose value'))]
      : format === 'libreview'
        ? [header.findIndex((h) => h.includes('historic glucose')), header.findIndex((h) => h.includes('scan glucose'))]
        : [header.findIndex((h) => /glucose|sgv|egv|mg\/dl|mmol/.test(h))];
  const typeCol = header.findIndex((h) => h === 'event type' || h === 'record type');
  const mmol = glucoseCols.some((c) => c >= 0 && header[c].includes('mmol'));
  const explicitMgdl = glucoseCols.some((c) => c >= 0 && /mg\s*\/\s*dl/.test(header[c]));
  const separateTimeCol = header[timeCol] === 'date' ? header.findIndex((h) => h === 'time') : -1;
  const dayFirst = format !== 'generic' || !text.includes('/');

  const seen = new Map<number, number>();
  let skipped = 0;
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitCsvLine(line, sep);
    if (typeCol >= 0 && format === 'dexcom' && cells[typeCol] && cells[typeCol].toUpperCase() !== 'EGV') continue;
    if (typeCol >= 0 && format === 'libreview' && cells[typeCol] && !['0', '1'].includes(cells[typeCol])) continue;
    const stamp = separateTimeCol >= 0 ? `${cells[timeCol]} ${cells[separateTimeCol]}` : cells[timeCol] ?? '';
    const t = parseTimestamp(stamp, dayFirst);
    const raw = glucoseCols.map((c) => (c >= 0 ? cells[c] : '')).find((v) => v && v.length > 0) ?? '';
    const lowHigh = /^low$/i.test(raw) ? 40 : /^high$/i.test(raw) ? 400 : null;
    let v = lowHigh ?? Number(raw.replace(',', '.'));
    if (t == null || !Number.isFinite(v) || v <= 0) {
      skipped++;
      continue;
    }
    if (lowHigh === null && (mmol || (!explicitMgdl && v < 35))) v = v * 18.016;
    // Snap to the 5-minute grid used everywhere else.
    const snapped = Math.round(t / 5) * 5;
    seen.set(snapped, Math.round(Math.min(400, Math.max(40, v))));
  }
  const readings = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([t, mgdl]) => ({ t, mgdl }));
  if (readings.length === 0) throw new Error('No glucose readings found in this file.');
  return { format, readings, skipped };
}
