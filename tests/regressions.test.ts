import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isoDate } from '../server/ai/client';
import { config } from '../server/config';
import type { TwinDashboardDTO } from '../shared/api';
import { parseCgmCsv, parseTimestamp } from '../shared/importers/cgmCsv';
import { istMidnight, istTime } from '../shared/time';
import { createTestApp, multipart } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let patient: string;
let doctor: string;
beforeAll(async () => {
  t = await createTestApp();
  patient = (await t.login('suresh@pratibimb.demo')).cookie;
  doctor = (await t.login('doctor@pratibimb.demo')).cookie;
}, 120_000);
beforeEach(() => {
  t.clock.set({ to: config.demoStart, paused: true });
  t.db.exec('SAVEPOINT regression');
});
afterEach(() => {
  t.db.exec('ROLLBACK TO regression; RELEASE regression;');
  t.twins.touchAll();
});
afterAll(async () => { await t.app.close(); t.db.close(); });
const get = (url: string, cookie = patient) => t.app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, payload: object, cookie = patient) => t.app.inject({ method: 'POST', url, payload, headers: { cookie } });
const consent = (body: object, cookie = patient) => t.app.inject({ method: 'PUT', url: '/api/patients/suresh/consents', payload: body, headers: { cookie } });

describe('consent and connected sources', () => {
  it('withdrawn care sharing removes triage and prevents direct reads and actions', async () => {
    expect((await consent({ care: false })).statusCode).toBe(200);
    expect((await get('/api/care', doctor)).json().some((r: { patient: { id: string } }) => r.patient.id === 'suresh')).toBe(false);
    for (const route of ['dashboard', 'forecast', 'messages', 'records', 'chat']) {
      expect((await get(`/api/patients/suresh/${route}`, doctor)).statusCode).toBe(403);
    }
    expect((await post('/api/care/suresh/review', { status: 'acted' }, doctor)).statusCode).toBe(403);
    expect((await get('/api/patients/suresh/dashboard')).statusCode).toBe(200);
    await consent({ care: true });
    expect((await get('/api/patients/suresh/dashboard', doctor)).statusCode).toBe(200);
  });
  it('a clinician cannot grant or revoke the patient’s consent', async () => {
    expect((await consent({ care: false }, doctor)).statusCode).toBe(403);
  });
  it('withdrawn build consent stops forecasts, fitting, alerts and new collection', async () => {
    await consent({ build: false });
    expect((await get('/api/patients/suresh/forecast')).statusCode).toBe(409);
    expect(await t.twins.refit('suresh')).toBeNull();
    expect(t.twins.currentAlert('suresh')).toBeNull();
    const before = t.twins.latestReading('suresh')!.t;
    t.clock.set({ to: t.clock.now() + 15 });
    await t.live.tick();
    expect(t.twins.latestReading('suresh')!.t).toBe(before);
    await consent({ build: true });
    expect((await get('/api/patients/suresh/forecast')).statusCode).toBe(200);
  });
  it('disconnecting CGM pauses collection and reconnecting resumes it', async () => {
    await post('/api/patients/suresh/sources/cgm', { connected: false });
    expect((await get('/api/patients/suresh/forecast')).statusCode).toBe(409);
    const before = t.twins.latestReading('suresh')!.t;
    t.clock.set({ to: t.clock.now() + 15 });
    await t.live.tick();
    expect(t.twins.latestReading('suresh')!.t).toBe(before);
    await post('/api/patients/suresh/sources/cgm', { connected: true });
    t.clock.set({ to: t.clock.now() + 15 });
    await t.live.tick();
    expect(t.twins.latestReading('suresh')!.t).toBeGreaterThan(before);
  });
  it('rejects unknown source names and non-boolean connection values', async () => {
    expect((await post('/api/patients/suresh/sources/toString', { connected: true })).statusCode).toBe(400);
    expect((await post('/api/patients/suresh/sources/watch', { connected: 'false' })).statusCode).toBe(400);
  });
});

describe('alerts and care actions', () => {
  function lowAlert() {
    const now = t.clock.now();
    t.db.prepare("INSERT INTO alerts (patient_id, kind, issued_at, status, lowest, drivers) VALUES ('suresh', 'cgm-low', ?, 'open', 62, '[]')").run(now - 20);
    t.db.prepare("INSERT OR REPLACE INTO readings (patient_id, t, mgdl) VALUES ('suresh', ?, ?)").run(now, 120);
  }
  it('does not describe a recovered glucose reading as low now', () => {
    lowAlert();
    expect(t.twins.currentAlert('suresh')?.kind).not.toBe('cgm-low');
  });
  it('shows the latest low value while a low is still current', () => {
    lowAlert();
    t.db.prepare("UPDATE readings SET mgdl = 58 WHERE patient_id = 'suresh' AND t = ?").run(t.clock.now());
    expect(t.twins.currentAlert('suresh')).toMatchObject({ kind: 'cgm-low', lowest: 58 });
  });
  it('does not keep showing an expired predicted risk window', () => {
    t.db.prepare("UPDATE alerts SET window_to = ? WHERE patient_id = 'suresh'").run(t.clock.now() - 1);
    expect(t.twins.currentAlert('suresh')).toBeNull();
  });
  it('a predicted high ends with its forecast window instead of lingering all night', () => {
    const a = t.twins.currentAlert('arjun');
    expect(a?.kind).toBe('predicted-high');
    expect(a!.windowTo).toBeGreaterThan(a!.issuedAt);
    t.clock.set({ to: a!.windowTo! + 1, paused: true });
    expect(t.twins.currentAlert('arjun')).toBeNull();
  });
  it('alerts stored without a window still expire after the 6-hour horizon', () => {
    t.db.prepare("UPDATE alerts SET window_to = NULL WHERE patient_id = 'arjun'").run();
    const a = t.twins.currentAlert('arjun')!;
    t.clock.set({ to: a.issuedAt + 361, paused: true });
    expect(t.twins.currentAlert('arjun')).toBeNull();
  });
  it('a check-in is suggested for a high with no clear cause, and sends a check-in rather than a dose reminder', async () => {
    const high = { kind: 'high', level: 'High', probability: 0.8, title: 'High glucose likely to persist', short: 'High persists', window: 'Above 180 mg/dL for most of the night' } as const;
    const action = t.twins.suggestAction('arjun', high, [], []);
    expect(action.effect).toBe('checkin');
    const original = t.twins.suggestAction;
    t.twins.suggestAction = () => action;
    try {
      await post('/api/care/arjun/review', { status: 'acted' }, doctor);
    } finally {
      t.twins.suggestAction = original;
    }
    const latest = (await get('/api/patients/arjun/messages', doctor)).json()[0];
    expect(latest.body).toMatch(/How are you feeling/);
    expect(latest.body).not.toMatch(/metformin/i);
  });
  it('the dashboard carries the twin’s current risk and the connected sources', async () => {
    const d = (await get('/api/patients/suresh/dashboard')).json() as TwinDashboardDTO;
    expect(d.risk).toMatchObject({ kind: 'low' });
    expect(d.sources).toMatchObject({ cgm: true, meals: true });
  });
  it('repeating a care action does not duplicate a message', async () => {
    await post('/api/care/arjun/review', { status: 'acted' }, doctor);
    const before = (await get('/api/patients/arjun/messages', doctor)).json().length;
    await post('/api/care/arjun/review', { status: 'acted' }, doctor);
    expect((await get('/api/patients/arjun/messages', doctor)).json()).toHaveLength(before);
  });
  it('undo cancels the snack even after the forecast/action changes', async () => {
    await post('/api/care/suresh/review', { status: 'acted' }, doctor);
    expect(t.twins.plannedSnack('suresh')).toBeDefined();
    await post('/api/care/suresh/review', { status: 'new' }, doctor);
    expect(t.twins.plannedSnack('suresh')).toBeUndefined();
    expect(t.twins.currentAlert('suresh')?.status).toBe('open');
  });
});

describe('records, imports and messages', () => {
  it('rejects impossible dates and blank lab values', async () => {
    for (const record of [{ date: '2026-02-31', value: 7 }, { date: '2026-10-01', value: null }]) {
      expect((await post('/api/patients/suresh/records', { records: [{ ...record, kind: 'lab', name: 'HbA1c' }] })).statusCode).toBe(400);
    }
  });
  it('saved manual results update the outlook even with lowercase names', async () => {
    expect((await post('/api/patients/suresh/records', { records: [{ date: '2026-10-12', kind: 'lab', name: 'hba1c', value: 7.3, unit: '%' }] })).statusCode).toBe(201);
    expect((await get('/api/patients/suresh/dashboard')).json().outlook.labs.at(-1).value).toBe(7.3);
  });
  it('replacement imports invalidate the old twin, alerts and saved forecasts', async () => {
    await post('/api/patients/suresh/events', { kind: 'meal', carbs: 30, speed: 1, label: 'Keep manual meal', source: 'logged' });
    const file = multipart('file', 'test.csv', 'text/csv', 'timestamp,glucose mg/dL\n2026-10-12T20:00,120\n2026-10-12T20:05,125');
    const result = await t.app.inject({ method: 'POST', url: '/api/patients/suresh/import', payload: file.body, headers: { cookie: patient, ...file.headers } });
    expect(result.statusCode).toBe(200);
    expect(result.json().state.hasTwin).toBe(false);
    expect(t.twins.currentAlert('suresh')).toBeNull();
    expect((await get('/api/patients/suresh/forecast')).statusCode).toBe(409);
    const events = t.db.prepare("SELECT label FROM events WHERE patient_id = 'suresh'").all();
    expect(events).toEqual([{ label: 'Keep manual meal' }]);
  });
  it('patient replies are available to the clinician and can be marked read', async () => {
    expect((await post('/api/patients/suresh/messages', { body: 'Synthetic test reply', language: 'en' })).statusCode).toBe(201);
    expect((await get('/api/patients/suresh/messages', doctor)).json()[0]).toMatchObject({ sender: 'patient', read: false, body: 'Synthetic test reply' });
    await post('/api/patients/suresh/messages/read', {}, doctor);
    expect((await get('/api/patients/suresh/messages', doctor)).json()[0].read).toBe(true);
  });
  it('rejects empty plans', async () => {
    expect((await post('/api/patients/suresh/plan', { text: '   ' })).statusCode).toBe(400);
  });
  it('the simulated watch has data after midnight', async () => {
    await post('/api/patients/suresh/sources/watch', { connected: true });
    t.clock.set({ to: istMidnight(t.clock.now()) + 1440 + 8 * 60 });
    await t.live.tick();
    expect(t.twins.today('suresh').steps).not.toBeNull();
  });
  it('the simulated routine continues beyond the initial three days without duplication', async () => {
    const day = istMidnight(t.clock.now()) + 4 * 1440;
    const row = t.db.prepare("SELECT checkpoint FROM truth WHERE patient_id = 'suresh'").get() as { checkpoint: string };
    const checkpoint = JSON.parse(row.checkpoint);
    checkpoint.t = day;
    t.db.prepare("UPDATE truth SET checkpoint = ? WHERE patient_id = 'suresh'").run(JSON.stringify(checkpoint));
    t.clock.set({ to: day + 5 });
    await t.live.tick();
    const count = () => (t.db.prepare("SELECT COUNT(*) AS n FROM events WHERE patient_id = 'suresh' AND kind = 'meal' AND t >= ? AND t < ?").get(day, day + 1440) as { n: number }).n;
    const meals = count();
    expect(meals).toBeGreaterThanOrEqual(4);
    t.clock.set({ to: day + 10 });
    await t.live.tick();
    expect(count()).toBe(meals);
  });
});

describe('sign-up and record input', () => {
  const signup = (body: object) => t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { name: 'Asha Rao', email: 'asha@example.com', password: 'long-enough', ...body } });
  it('explains invalid sign-up fields in plain words', async () => {
    for (const age of [12, null, 40.5]) {
      const res = await signup({ age });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('Age must be a whole number from 18 to 110.');
    }
    expect((await signup({ password: 'short' })).json().message).toBe('Use a password of at least 8 characters.');
    expect((await signup({ email: 'not-an-email' })).json().message).toBe('Enter a valid email address.');
  });
  it('normalises dates read from reports, including day-first Indian formats', () => {
    expect(isoDate('2026-10-01')).toBe('2026-10-01');
    expect(isoDate('01/10/2026')).toBe('2026-10-01');
    expect(isoDate('1-9-2026')).toBe('2026-09-01');
    expect(isoDate('31/02/2026')).toBeNull();
    expect(isoDate('October 2026')).toBeNull();
    expect(isoDate(null)).toBeNull();
  });
});

describe('CGM parsing edge cases', () => {
  it('does not convert explicitly mg/dL low readings into high readings', () => {
    expect(parseCgmCsv('timestamp,glucose mg/dL\n2026-10-01 12:00,20').readings[0].mgdl).toBe(40);
  });
  it('preserves LOW/HIGH markers in mmol/L exports', () => {
    expect(parseCgmCsv('timestamp,glucose mmol/L\n2026-10-01 12:00,LOW\n2026-10-01 12:05,HIGH').readings.map((r) => r.mgdl)).toEqual([40, 400]);
  });
  it('supports separate date/time columns and a metadata line before semicolon headers', () => {
    expect(parseCgmCsv('Synthetic export\nDate;Time;Glucose mg/dL\n2026-10-01;12:00;123').readings[0].mgdl).toBe(123);
  });
  it('rejects impossible timestamps', () => {
    for (const stamp of ['2026-02-31 12:00', '2026-01-01 25:00', '31/02/2026 12:00', '13/10/2026 14:00 PM']) expect(parseTimestamp(stamp)).toBeNull();
  });
  it('honours explicit timezone offsets and unambiguous day-first dates', () => {
    expect(parseTimestamp('2026-10-01T12:00:00Z')).toBe(istTime(2026, 10, 1, 17, 30));
    expect(parseTimestamp('13/10/2026 21:40', false)).toBe(istTime(2026, 10, 13, 21, 40));
  });
});
