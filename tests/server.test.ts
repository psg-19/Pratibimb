import { beforeAll, describe, expect, it } from 'vitest';
import type { AlertDTO, CarePatientDTO, ForecastDTO, SavedScenarioDTO, SourceStateDTO, TwinDashboardDTO } from '../shared/api';
import { clockIST } from '../shared/time';
import { createTestApp, multipart } from './helpers';

type T = Awaited<ReturnType<typeof createTestApp>>;
let t: T;
let suresh: string;
let doctor: string;
let arjun: string;

beforeAll(async () => {
  t = await createTestApp();
  suresh = (await t.login('suresh@pratibimb.demo')).cookie;
  doctor = (await t.login('doctor@pratibimb.demo')).cookie;
  arjun = (await t.login('arjun@pratibimb.demo')).cookie;
}, 120_000);

const get = (url: string, cookie?: string) => t.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
const post = (url: string, payload: unknown, cookie?: string) => t.app.inject({ method: 'POST', url, payload: payload as object, headers: cookie ? { cookie } : {} });

describe('auth and access', () => {
  it('rejects a wrong password and reports no session as null', async () => {
    expect((await t.login('suresh@pratibimb.demo', 'nope')).status).toBe(401);
    const me = await get('/api/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toBeNull();
  });

  it('signs in a patient with their twin', async () => {
    const me = (await get('/api/me', suresh)).json();
    expect(me.user.role).toBe('patient');
    expect(me.patient.id).toBe('suresh');
    expect(me.patient.hasTwin).toBe(true);
  });

  it('keeps patients to their own data', async () => {
    expect((await get('/api/patients/arjun/forecast', suresh)).statusCode).toBe(403);
    expect((await get('/api/care', suresh)).statusCode).toBe(403);
    expect((await get('/api/patients/suresh/forecast')).statusCode).toBe(401);
    expect((await get('/api/patients/nobody/forecast', doctor)).statusCode).toBe(404);
  });
});

describe('forecast', () => {
  it('returns history, the twin’s forecast and tonight’s risk window', async () => {
    const f = (await get('/api/patients/suresh/forecast?horizon=360', suresh)).json() as ForecastDTO;
    expect(f.measured.length).toBeGreaterThan(60);
    expect(f.median[0].t).toBe(f.now);
    expect(f.end - f.now).toBe(360);
    expect(f.band.every((b) => b.lo <= b.hi)).toBe(true);
    expect(f.readout.lowest.v).toBeLessThan(75);
    expect(f.riskWindow).not.toBeNull();
    expect(f.meals.map((m) => m.label)).toContain('Dinner · 20:15');
    expect(f.walks[0].label).toBe('Walk · 45 min');
  });

  it('honours the 2 / 6 / 12 hour horizons', async () => {
    const short = (await get('/api/patients/suresh/forecast?horizon=120', suresh)).json() as ForecastDTO;
    const long = (await get('/api/patients/suresh/forecast?horizon=720', suresh)).json() as ForecastDTO;
    expect(short.end - short.now).toBe(120);
    expect(long.end - long.now).toBe(720);
    expect(long.meals.some((m) => m.planned && /breakfast/i.test(m.label))).toBe(true);
  });
});

describe('alert state machine (through the API)', () => {
  const dash = async () => (await get('/api/patients/suresh/dashboard', suresh)).json() as TwinDashboardDTO;
  const act = (id: number, action: string) => post(`/api/patients/suresh/alerts/${id}`, { action }, suresh);

  it('starts with an open predicted-low alert carrying the twin’s drivers', async () => {
    const d = await dash();
    expect(d.alert?.kind).toBe('predicted-low');
    expect(d.alert?.status).toBe('open');
    expect(d.alert?.drivers[0].text).toBe('A 45-minute walk straight after dinner');
    expect(clockIST(d.alert!.issuedAt)).toBe('21:40');
  });

  it('snack → plans a snack the forecast plays; undo removes it', async () => {
    const id = (await dash()).alert!.id;
    const a = (await act(id, 'snack')).json() as AlertDTO;
    expect(a.status).toBe('snack');
    expect(a.snackAt).not.toBeNull();
    const f = (await get('/api/patients/suresh/forecast?horizon=360', suresh)).json() as ForecastDTO;
    expect(f.scenario).not.toBeNull();
    expect(f.riskWindow).toBeNull();
    // Snack scenario stays higher than the baseline overnight.
    expect(Math.min(...f.scenario!.map((p) => p.v))).toBeGreaterThan(Math.min(...f.median.map((p) => p.v)));
    // A second action is refused while handled.
    expect((await act(id, 'team')).statusCode).toBe(409);
    const u = (await act(id, 'undo')).json() as AlertDTO;
    expect(u.status).toBe('open');
    const f2 = (await get('/api/patients/suresh/forecast?horizon=360', suresh)).json() as ForecastDTO;
    expect(f2.scenario).toBeNull();
  });

  it('team and dismiss, each undoable; unknown actions rejected', async () => {
    const id = (await dash()).alert!.id;
    expect(((await act(id, 'team')).json() as AlertDTO).status).toBe('team');
    expect(((await act(id, 'undo')).json() as AlertDTO).status).toBe('open');
    expect(((await act(id, 'dismiss')).json() as AlertDTO).status).toBe('dismissed');
    expect(((await act(id, 'undo')).json() as AlertDTO).status).toBe('open');
    expect((await act(id, 'explode')).statusCode).toBe(400);
  });

  it('sends the snack nudge to the patient’s messages', async () => {
    const msgs = (await get('/api/patients/suresh/messages', suresh)).json();
    expect(msgs.some((m: { body: string }) => /snack before bed/.test(m.body))).toBe(true);
  });
});

describe('events', () => {
  it('validates and logs meals; the timeline shows them', async () => {
    expect((await post('/api/patients/suresh/events', { kind: 'meal', carbs: 900 }, suresh)).statusCode).toBe(400);
    const res = await post('/api/patients/suresh/events', { kind: 'meal', carbs: 15, label: 'Banana', source: 'logged' }, suresh);
    expect(res.statusCode).toBe(201);
    const d = (await get('/api/patients/suresh/dashboard', suresh)).json() as TwinDashboardDTO;
    const item = d.timeline.find((e) => e.title.includes('Banana'));
    expect(item).toBeDefined();
    expect((await t.app.inject({ method: 'DELETE', url: `/api/patients/suresh/events/${item!.id}`, headers: { cookie: suresh } })).statusCode).toBe(200);
  });
});

describe('what-if and saved scenarios', () => {
  const req = (walk: number) => ({ meal: { carbs: 75, speed: 1.35 }, portion: 1, walk, sleep: 7, med: 'taken' });

  it('simulates on the fitted twin', async () => {
    const r = (await post('/api/patients/suresh/whatif', req(0), suresh)).json();
    const walked = (await post('/api/patients/suresh/whatif', req(30), suresh)).json();
    expect(r.result.pts).toHaveLength(181);
    expect(walked.result.peak).toBeLessThan(r.result.peak);
    expect(r.usualLabel).toBe('His usual: rice plate, no walk');
    expect((await post('/api/patients/suresh/whatif', { ...req(0), portion: 9 }, suresh)).statusCode).toBe(400);
  });

  it('keeps the newest four scenarios', async () => {
    for (const w of [0, 10, 20, 30, 40]) await post('/api/patients/suresh/scenarios', req(w), suresh);
    const list = (await get('/api/patients/suresh/scenarios', suresh)).json() as SavedScenarioDTO[];
    expect(list.map((s) => s.input.walk)).toEqual([40, 30, 20, 10]);
  });
});

describe('care team', () => {
  it('ranks patients by their twins’ forecasts', async () => {
    const care = (await get('/api/care', doctor)).json() as CarePatientDTO[];
    const byId = Object.fromEntries(care.map((c) => [c.patient.id, c]));
    expect(byId.suresh.risk.kind).toBe('low');
    expect(byId.arjun.risk.kind).toBe('high');
    expect(byId.arjun.drivers[0]).toMatch(/^Fever/);
    expect(byId.arjun.action.effect).toBe('call');
  });

  it('acting sends the patient a message; undo clears the action', async () => {
    const r = (await post('/api/care/arjun/review', { status: 'acted' }, doctor)).json() as CarePatientDTO;
    expect(r.review).toBe('acted');
    expect(r.reviewNote).toMatch(/^Call scheduled for \d\d:\d\d$/);
    const inbox = (await get('/api/patients/arjun/messages', arjun)).json();
    expect(inbox[0].body).toMatch(/sick-day plan/);
    expect(inbox[0].sender).toBe('clinician');
    const u = (await post('/api/care/arjun/review', { status: 'new' }, doctor)).json() as CarePatientDTO;
    expect(u.review).toBe('new');
    expect((await post('/api/care/arjun/review', { status: 'acted' }, suresh)).statusCode).toBe(403);
  });
});

describe('AI endpoints without a key fall back or explain', () => {
  it('meal text uses the food table', async () => {
    const r = (await post('/api/patients/suresh/ai/meal-text', { text: '3 idli and sambar' }, suresh)).json();
    expect(r.by).toBe('offline');
    expect(r.totalCarbs).toBe(60);
  });

  it('photo, records and chat need the AI service', async () => {
    const mp = multipart('file', 'meal.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff]));
    expect((await t.app.inject({ method: 'POST', url: '/api/patients/suresh/ai/meal-photo', payload: mp.body, headers: { ...mp.headers, cookie: suresh } })).statusCode).toBe(503);
    expect((await post('/api/patients/suresh/chat', { message: 'hi' }, suresh)).statusCode).toBe(503);
  });

  it('explanations, briefs and drafts use templates built from the twin', async () => {
    const ex = (await get('/api/patients/suresh/ai/explain?lang=en', suresh)).json();
    expect(ex.by).toBe('offline');
    expect(ex.text).toMatch(/walk/);
    expect((await get('/api/patients/suresh/ai/brief', suresh)).statusCode).toBe(403);
    const brief = (await get('/api/patients/suresh/ai/brief', doctor)).json();
    expect(brief.text).toMatch(/^S: /);
    const d = (await post('/api/patients/suresh/ai/draft', { intent: 'snack', language: 'kn' }, doctor)).json();
    expect(d.message).toMatch(/ಹಾಲು/);
  });

  it('the planner ranks built-in dinners on the twin', async () => {
    const r = (await post('/api/patients/suresh/ai/plan', {}, suresh)).json();
    expect(r.by).toBe('offline');
    const above = r.options.map((o: { aboveMin: number }) => o.aboveMin);
    expect([...above].sort((a, b) => a - b)).toEqual(above);
  });
});

describe('a new patient: sign up → connect → build', () => {
  let cookie: string;
  let id: string;

  it('creates an account', async () => {
    const res = await post('/api/auth/signup', { name: 'Asha Rao', email: 'asha@example.com', password: 'long-password-1', age: 50, medsLong: 'Metformin 500 mg twice daily' });
    expect(res.statusCode).toBe(201);
    cookie = String(res.headers['set-cookie']).split(';')[0];
    id = res.json().patient.id;
    expect(res.json().patient.hasTwin).toBe(false);
    expect((await post('/api/auth/signup', { name: 'Asha', email: 'asha@example.com', password: 'long-password-1' })).statusCode).toBe(409);
  });

  it('cannot build without a CGM', async () => {
    expect((await post(`/api/patients/${id}/build`, {}, cookie)).statusCode).toBe(409);
  });

  it('connecting the demo CGM backfills two weeks', async () => {
    const s = (await post(`/api/patients/${id}/sources/cgm`, { connected: true }, cookie)).json() as SourceStateDTO;
    expect(s.dataMode).toBe('synthetic');
    expect(s.readings).toBeGreaterThan(3500);
    expect(s.readiness).toBe(35);
  });

  it('builds a twin that forecasts', async () => {
    await post(`/api/patients/${id}/sources/meals`, { connected: true }, cookie);
    const b = await post(`/api/patients/${id}/build`, {}, cookie);
    expect(b.statusCode).toBe(200);
    expect(b.json().twin.days).toBeGreaterThanOrEqual(13);
    const f = (await get(`/api/patients/${id}/forecast`, cookie)).json() as ForecastDTO;
    expect(f.median.length).toBeGreaterThan(60);
  });

  it('imports a CGM export and replays it onto today', async () => {
    const lines = ['Index,Timestamp (YYYY-MM-DDThh:mm:ss),Event Type,Glucose Value (mg/dL)'];
    for (let i = 0; i < 400; i++) {
      const d = new Date(Date.UTC(2026, 8, 1, 0, 0) + i * 5 * 60_000);
      lines.push(`${i},${d.toISOString().slice(0, 19)},EGV,${120 + Math.round(30 * Math.sin(i / 20))}`);
    }
    const mp = multipart('file', 'clarity.csv', 'text/csv', lines.join('\n'));
    const res = await t.app.inject({ method: 'POST', url: `/api/patients/${id}/import`, payload: mp.body, headers: { ...mp.headers, cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(400);
    expect(res.json().state.dataMode).toBe('imported');
  });
});

describe('live loop and clock', () => {
  it('new CGM readings arrive as simulated time passes', async () => {
    const before = t.twins.latestReading('suresh')!.t;
    t.advance(60_000); // one real minute at 15× = 15 simulated minutes
    await t.live.tick();
    const after = t.twins.latestReading('suresh')!.t;
    expect(after - before).toBeGreaterThanOrEqual(10);
  });

  it('can be paused by a signed-in user', async () => {
    const res = await post('/api/clock', { paused: true }, doctor);
    expect(res.json().paused).toBe(true);
    const health = (await get('/api/health')).json();
    expect(health.clock.paused).toBe(true);
    expect(health.ai).toBe(false);
  });
});

describe('demo reset', () => {
  it('is care-team only, and restarts the story at the demo start', async () => {
    expect((await post('/api/demo/reset', {}, suresh)).statusCode).toBe(403);
    const res = await post('/api/demo/reset', {}, doctor);
    expect(res.statusCode).toBe(200);
    // Everyone is signed out; sign in again and the evening starts over.
    expect((await get('/api/me', doctor)).json()).toBeNull();
    const again = (await t.login('suresh@pratibimb.demo')).cookie;
    const d = (await get('/api/patients/suresh/dashboard', again)).json() as TwinDashboardDTO;
    expect(d.alert?.kind).toBe('predicted-low');
    expect(d.alert?.status).toBe('open');
    expect(clockIST(t.clock.now())).toBe('21:40');
    expect((await get('/api/care', (await t.login('doctor@pratibimb.demo')).cookie)).json()).toHaveLength(6);
  }, 120_000);
});
