import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as z from 'zod/v4';
import type { MessageDTO, RecordDTO, SavedScenarioDTO, SourceStateDTO, TwinDashboardDTO, WhatIfRequest } from '../../shared/api';
import { parseCgmCsv } from '../../shared/importers/cgmCsv';
import { generateHistory } from '../../shared/synth/generate';
import { personaForNewPatient } from '../../shared/synth/template';
import { hashSeed } from '../../shared/rng';
import { clockIST, istMidnight, minuteOfDayIST } from '../../shared/time';
import { canAccessPatient, requireUser } from '../auth';
import { insertEvent, type AlertRow, type EventRow, type UserRow } from '../db/db';
import type { Ctx } from '../app';

const WEIGHTS: Record<string, number> = { cgm: 35, abha: 25, watch: 20, meals: 15, bp: 5 };

const MealIn = z.object({
  kind: z.literal('meal'),
  t: z.number().int().optional(),
  carbs: z.number().min(0).max(300),
  speed: z.number().min(0.4).max(2).default(1),
  label: z.string().trim().max(200).default('Meal'),
  source: z.enum(['logged', 'photo', 'voice']).default('logged'),
  note: z.string().max(200).optional(),
});
const WalkIn = z.object({ kind: z.literal('walk'), t: z.number().int().optional(), duration: z.number().int().min(1).max(300), steps: z.number().int().optional() });
const MedIn = z.object({ kind: z.literal('med'), t: z.number().int().optional(), drug: z.enum(['metformin', 'glimepiride', 'sitagliptin']), dose: z.number().positive() });
const IllnessIn = z.object({ kind: z.literal('illness'), t: z.number().int().optional(), duration: z.number().int().min(60).max(7 * 1440).default(1440), severity: z.number().min(0.1).max(1).default(0.6), label: z.string().max(100).default('Feeling unwell') });
const EventIn = z.discriminatedUnion('kind', [MealIn, WalkIn, MedIn, IllnessIn]);

const WhatIfIn = z.object({
  meal: z.object({ carbs: z.number().min(0).max(300), speed: z.number().min(0.4).max(2), label: z.string().max(120).optional() }),
  portion: z.number().min(0.25).max(2),
  walk: z.number().int().min(0).max(120),
  sleep: z.number().min(3).max(12),
  med: z.enum(['taken', 'missed']),
});

export function patientGuard(ctx: Ctx) {
  return (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): UserRow | null => {
    const user = requireUser(req, reply);
    if (!user) return null;
    if (!ctx.twins.patient(req.params.id)) {
      void reply.code(404).send({ error: 'not_found', message: 'No such patient.' });
      return null;
    }
    if (!canAccessPatient(user, req.params.id, ctx.db)) {
      void reply.code(403).send({ error: 'forbidden', message: user.role === 'clinician' ? 'This patient has not enabled care-team sharing.' : 'You can only see your own twin.' });
      return null;
    }
    return user;
  };
}

export function messageDTO(r: { id: number; sender: MessageDTO['sender']; author: string; body: string; language: MessageDTO['language']; kind: string; sent_at: number; read: number }): MessageDTO {
  return { id: r.id, sender: r.sender, author: r.author, body: r.body, language: r.language, kind: r.kind, sentAt: r.sent_at, read: !!r.read };
}

export function sendMessage(ctx: Ctx, patientId: string, m: { sender: MessageDTO['sender']; author: string; body: string; language?: string; kind?: string }) {
  const r = ctx.db
    .prepare('INSERT INTO messages (patient_id, sender, author, body, language, kind, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(patientId, m.sender, m.author, m.body, m.language ?? 'en', m.kind ?? 'message', ctx.clock.now());
  ctx.bus.publish({ type: 'message', patientId });
  return Number(r.lastInsertRowid);
}

export function sourceState(ctx: Ctx, id: string): SourceStateDTO {
  const t = ctx.twins;
  const src = t.sourceFlags(id) as SourceStateDTO['sources'];
  const cons = Object.fromEntries((ctx.db.prepare('SELECT consent, granted FROM consents WHERE patient_id = ?').all(id) as { consent: string; granted: number }[]).map((c) => [c.consent, !!c.granted])) as SourceStateDTO['consents'];
  const stats = ctx.db.prepare('SELECT COUNT(*) AS n, MIN(t) AS first FROM readings WHERE patient_id = ? AND t <= ?').get(id, ctx.clock.now()) as { n: number; first: number | null };
  const p = t.patient(id)!;
  return {
    sources: src,
    consents: { build: !!cons.build, care: !!cons.care, research: !!cons.research },
    readiness: Object.entries(src).reduce((a, [k, on]) => a + (on ? (WEIGHTS[k] ?? 0) : 0), 0),
    dataMode: p.data_mode,
    hasTwin: !!t.twin(id),
    readings: stats.n,
    days: stats.first ? Math.floor((ctx.clock.now() - stats.first) / 1440) : 0,
  };
}

export function patientRoutes(app: FastifyInstance, ctx: Ctx) {
  const guard = patientGuard(ctx);
  const t = ctx.twins;
  type P = { Params: { id: string } };

  app.get<P>('/api/patients/:id/dashboard', async (req, reply) => {
    if (!guard(req, reply)) return;
    const id = req.params.id;
    const unread = ctx.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE patient_id = ? AND read = 0 AND sender != 'patient'`).get(id) as { n: number };
    const dto: TwinDashboardDTO = {
      patient: t.summary(id)!,
      alert: t.currentAlert(id),
      risk: t.riskAndDrivers(id)?.risk ?? null,
      sources: t.sourceFlags(id) as TwinDashboardDTO['sources'],
      today: t.today(id),
      twin: t.twinSummary(id),
      outlook: t.outlook(id),
      timeline: t.timeline(id),
      unread: unread.n,
    };
    return dto;
  });

  app.get<P & { Querystring: { horizon?: string } }>('/api/patients/:id/forecast', async (req, reply) => {
    if (!guard(req, reply)) return;
    const horizon = [120, 360, 720].includes(Number(req.query.horizon)) ? Number(req.query.horizon) : 360;
    const fc = t.forecastDTO(req.params.id, horizon);
    if (!fc) return reply.code(409).send({ error: 'no_twin', message: 'This twin has not been built yet.' });
    return fc;
  });

  app.post<P & { Params: { id: string; alertId: string }; Body: { action: string } }>('/api/patients/:id/alerts/:alertId', async (req, reply) => {
    const user = guard(req, reply);
    if (!user) return;
    const id = req.params.id;
    const a = ctx.db.prepare('SELECT * FROM alerts WHERE id = ? AND patient_id = ?').get(Number(req.params.alertId), id) as AlertRow | undefined;
    if (!a) return reply.code(404).send({ error: 'not_found', message: 'No such alert.' });
    const action = String(req.body?.action ?? '');
    const now = ctx.clock.now();
    const p = t.patient(id)!;
    if (action === 'undo') {
      if (a.status === 'open') return t.alertDTO(a);
      if (a.status === 'snack') {
        const snack = a.snack_event_id ? (ctx.db.prepare('SELECT t FROM events WHERE id = ?').get(a.snack_event_id) as { t: number } | undefined) : undefined;
        if (snack && snack.t <= now) return reply.code(409).send({ error: 'too_late', message: 'The snack time has already passed.' });
        t.cancelSnack(id, a.snack_event_id);
      }
      ctx.db.prepare(`UPDATE alerts SET status = 'open', handled_at = NULL, snack_event_id = NULL WHERE id = ?`).run(a.id);
    } else if (a.status !== 'open') {
      return reply.code(409).send({ error: 'handled', message: 'This alert has already been handled.' });
    } else if (action === 'snack') {
      const eventId = t.planSnack(id);
      ctx.db.prepare(`UPDATE alerts SET status = 'snack', handled_at = ?, snack_event_id = ? WHERE id = ?`).run(now, eventId, a.id);
      sendMessage(ctx, id, { sender: 'twin', author: 'Your twin', kind: 'nudge', language: p.language, body: 'Have a small snack before bed — a glass of milk or a banana. Your twin will check again at 23:00.' });
    } else if (action === 'team') {
      ctx.db.prepare(`UPDATE alerts SET status = 'team', handled_at = ? WHERE id = ?`).run(now, a.id);
      ctx.bus.publish({ type: 'review', patientId: id });
    } else if (action === 'dismiss') {
      ctx.db.prepare(`UPDATE alerts SET status = 'dismissed', handled_at = ? WHERE id = ?`).run(now, a.id);
    } else {
      return reply.code(400).send({ error: 'invalid', message: 'Unknown action.' });
    }
    t.touch(id);
    ctx.bus.publish({ type: 'alert', patientId: id, alertId: a.id });
    return t.alertDTO(ctx.db.prepare('SELECT * FROM alerts WHERE id = ?').get(a.id) as AlertRow);
  });

  /* ---------- events ---------- */

  app.post<P>('/api/patients/:id/events', async (req, reply) => {
    if (!guard(req, reply)) return;
    const body = EventIn.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', message: body.error.issues[0]?.message ?? 'Invalid event.' });
    const now = ctx.clock.now();
    const e = body.data;
    const time = Math.min(e.t ?? now, now + 6 * 60);
    const id = req.params.id;
    const eventId =
      e.kind === 'meal'
        ? insertEvent(ctx.db, id, { kind: 'meal', t: time, carbs: e.carbs, trueCarbs: e.carbs, speed: e.speed, label: e.label, source: e.source, note: e.note })
        : e.kind === 'walk'
          ? insertEvent(ctx.db, id, { kind: 'walk', t: time, duration: e.duration, steps: e.steps ?? e.duration * 95, source: 'logged' })
          : e.kind === 'med'
            ? insertEvent(ctx.db, id, { kind: 'med', t: time, drug: e.drug, dose: e.dose, source: 'logged' })
            : insertEvent(ctx.db, id, { kind: 'illness', t: time, duration: e.duration, severity: e.severity, label: e.label, source: 'logged' });
    t.touch(id);
    ctx.bus.publish({ type: 'events', patientId: id });
    t.evaluateAlerts(id);
    return reply.code(201).send({ id: eventId });
  });

  app.patch<{ Params: { id: string; eventId: string }; Body: { confirm?: boolean; carbs?: number } }>('/api/patients/:id/events/:eventId', async (req, reply) => {
    if (!guard(req, reply)) return;
    const ev = ctx.db.prepare('SELECT * FROM events WHERE id = ? AND patient_id = ?').get(Number(req.params.eventId), req.params.id) as EventRow | undefined;
    if (!ev || ev.hidden) return reply.code(404).send({ error: 'not_found', message: 'No such event.' });
    if (req.body?.confirm && ev.source === 'inferred') ctx.db.prepare(`UPDATE events SET source = 'logged', label = 'Meal (confirmed)' WHERE id = ?`).run(ev.id);
    if (typeof req.body?.carbs === 'number' && ev.kind === 'meal') ctx.db.prepare('UPDATE events SET carbs = ? WHERE id = ?').run(Math.max(0, Math.min(300, req.body.carbs)), ev.id);
    t.touch(req.params.id);
    ctx.bus.publish({ type: 'events', patientId: req.params.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; eventId: string } }>('/api/patients/:id/events/:eventId', async (req, reply) => {
    if (!guard(req, reply)) return;
    const ev = ctx.db.prepare('SELECT * FROM events WHERE id = ? AND patient_id = ?').get(Number(req.params.eventId), req.params.id) as EventRow | undefined;
    if (!ev || ev.hidden || ev.source === 'device') return reply.code(404).send({ error: 'not_found', message: 'This event cannot be deleted.' });
    ctx.db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
    t.touch(req.params.id);
    ctx.bus.publish({ type: 'events', patientId: req.params.id });
    return { ok: true };
  });

  /* ---------- what-if ---------- */

  app.post<P>('/api/patients/:id/whatif', async (req, reply) => {
    if (!guard(req, reply)) return;
    const body = WhatIfIn.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', message: 'Invalid scenario.' });
    const r = t.whatIf(req.params.id, body.data as WhatIfRequest);
    if (!r) return reply.code(409).send({ error: 'no_twin', message: 'This twin has not been built yet.' });
    return r;
  });

  app.get<P>('/api/patients/:id/scenarios', async (req, reply) => {
    if (!guard(req, reply)) return;
    const rows = ctx.db.prepare('SELECT * FROM scenarios WHERE patient_id = ? ORDER BY id DESC LIMIT 4').all(req.params.id) as { id: number; input: string; peak: number; above_min: number; created_at_ms: number }[];
    return rows.map((r): SavedScenarioDTO => ({ id: r.id, input: JSON.parse(r.input), peak: r.peak, aboveMin: r.above_min, createdAt: r.created_at_ms }));
  });

  app.post<P>('/api/patients/:id/scenarios', async (req, reply) => {
    if (!guard(req, reply)) return;
    const body = WhatIfIn.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', message: 'Invalid scenario.' });
    const r = t.whatIf(req.params.id, body.data as WhatIfRequest);
    if (!r) return reply.code(409).send({ error: 'no_twin', message: 'This twin has not been built yet.' });
    const id = req.params.id;
    ctx.db.prepare('INSERT INTO scenarios (patient_id, input, peak, above_min, created_at_ms) VALUES (?, ?, ?, ?, ?)').run(id, JSON.stringify(body.data), Math.round(r.result.peak), r.result.aboveMin, Date.now());
    // Keep the newest four.
    ctx.db.prepare('DELETE FROM scenarios WHERE patient_id = ? AND id NOT IN (SELECT id FROM scenarios WHERE patient_id = ? ORDER BY id DESC LIMIT 4)').run(id, id);
    return reply.code(201).send({ ok: true });
  });

  app.post<P & { Body: { text: string } }>('/api/patients/:id/plan', async (req, reply) => {
    const user = guard(req, reply);
    if (!user) return;
    const text = String(req.body?.text ?? '').trim().slice(0, 400);
    if (!text) return reply.code(400).send({ error: 'invalid', message: 'Nothing to send.' });
    const p = t.patient(req.params.id)!;
    sendMessage(ctx, req.params.id, user.role === 'clinician' ? { sender: 'clinician', author: user.name, body: text, kind: 'plan', language: p.language } : { sender: 'twin', author: 'Your twin', body: text, kind: 'plan', language: p.language });
    return { ok: true, sentAt: ctx.clock.now() };
  });

  /* ---------- messages ---------- */

  app.get<P>('/api/patients/:id/messages', async (req, reply) => {
    if (!guard(req, reply)) return;
    const rows = ctx.db.prepare('SELECT * FROM messages WHERE patient_id = ? ORDER BY sent_at DESC, id DESC LIMIT 50').all(req.params.id) as Parameters<typeof messageDTO>[0][];
    return rows.map(messageDTO);
  });

  app.post<P & { Body: { body: string; language?: string } }>('/api/patients/:id/messages', async (req, reply) => {
    const user = guard(req, reply);
    if (!user) return;
    const body = String(req.body?.body ?? '').trim().slice(0, 1000);
    if (!body) return reply.code(400).send({ error: 'invalid', message: 'Message is empty.' });
    const lang = ['en', 'hi', 'kn'].includes(String(req.body?.language)) ? String(req.body?.language) : 'en';
    const id = sendMessage(ctx, req.params.id, { sender: user.role === 'clinician' ? 'clinician' : 'patient', author: user.name, body, language: lang });
    return reply.code(201).send({ id });
  });

  app.post<P>('/api/patients/:id/messages/read', async (req, reply) => {
    const user = guard(req, reply);
    if (!user) return;
    ctx.db.prepare(`UPDATE messages SET read = 1 WHERE patient_id = ? AND sender != ?`).run(req.params.id, user.role === 'clinician' ? 'clinician' : 'patient');
    return { ok: true };
  });

  /* ---------- records ---------- */

  app.get<P>('/api/patients/:id/records', async (req, reply) => {
    if (!guard(req, reply)) return;
    return ctx.db.prepare('SELECT id, date, kind, name, value, unit, detail, source FROM records WHERE patient_id = ? ORDER BY date DESC, id DESC').all(req.params.id) as RecordDTO[];
  });

  const RecordsIn = z.object({
    records: z
      .array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
            const date = new Date(`${value}T00:00:00Z`);
            return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
          }, 'Enter a valid calendar date.'),
          kind: z.enum(['lab', 'medication']),
          name: z.string().trim().min(1).max(80),
          value: z.number().nullable().default(null),
          unit: z.string().max(20).nullable().default(null),
          detail: z.string().max(200).nullable().default(null),
        }).refine((record) => record.kind !== 'lab' || record.value !== null, 'A lab result needs a numeric value.'),
      )
      .min(1)
      .max(50),
    source: z.string().max(80).default('Uploaded report'),
  });

  app.post<P>('/api/patients/:id/records', async (req, reply) => {
    if (!guard(req, reply)) return;
    const body = RecordsIn.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', message: body.error.issues[0]?.message ?? 'Invalid records.' });
    const ins = ctx.db.prepare('INSERT INTO records (patient_id, date, kind, name, value, unit, detail, source, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    ctx.db.transaction(() => {
      for (const r of body.data.records) ins.run(req.params.id, r.date, r.kind, r.name, r.value, r.unit, r.detail, body.data.source, Date.now());
    })();
    t.touch(req.params.id);
    return reply.code(201).send({ ok: true, count: body.data.records.length });
  });

  /* ---------- sources, consent, build, import ---------- */

  app.get<P>('/api/patients/:id/sources', async (req, reply) => {
    if (!guard(req, reply)) return;
    return sourceState(ctx, req.params.id);
  });

  app.post<{ Params: { id: string; source: string }; Body: { connected: boolean } }>('/api/patients/:id/sources/:source', async (req, reply) => {
    if (!guard(req, reply)) return;
    const { id, source } = req.params;
    if (!Object.hasOwn(WEIGHTS, source)) return reply.code(400).send({ error: 'invalid', message: 'Unknown source.' });
    if (typeof req.body?.connected !== 'boolean') return reply.code(400).send({ error: 'invalid', message: 'Choose whether to connect the source.' });
    const connected = !!req.body?.connected;
    ctx.db.prepare('UPDATE sources SET connected = ?, updated_at_ms = ? WHERE patient_id = ? AND source = ?').run(connected ? 1 : 0, Date.now(), id, source);
    const p = t.patient(id)!;
    // First CGM connection for a new account: attach the demo sensor and backfill two weeks.
    if (source === 'cgm' && connected && p.data_mode === 'empty') {
      const persona = personaForNewPatient({ id, name: p.name, medsLong: p.meds_long });
      const now = ctx.clock.now();
      const h = generateHistory(persona, now, { days: 14 });
      ctx.db.transaction(() => {
        ctx.db.prepare('INSERT OR REPLACE INTO truth (patient_id, params, checkpoint, seed, sensor_end) VALUES (?, ?, ?, ?, NULL)').run(id, JSON.stringify(h.params), JSON.stringify(h.checkpoint), hashSeed(`new:${id}`));
        for (const e of h.events) insertEvent(ctx.db, id, e);
        const ins = ctx.db.prepare('INSERT OR IGNORE INTO readings (patient_id, t, mgdl) VALUES (?, ?, ?)');
        for (const r of h.readings) ins.run(id, r.t, r.mgdl);
        const vit = ctx.db.prepare('INSERT OR REPLACE INTO vitals (patient_id, day, steps, resting_hr) VALUES (?, ?, ?, ?)');
        for (const v of h.vitals) vit.run(id, v.day, v.steps, v.restingHr);
        ctx.db.prepare(`UPDATE patients SET data_mode = 'synthetic', synthetic = 1 WHERE id = ?`).run(id);
      })();
    }
    t.touch(id);
    ctx.bus.publish({ type: 'events', patientId: id });
    return sourceState(ctx, id);
  });

  app.put<P & { Body: Partial<Record<'build' | 'care' | 'research', boolean>> }>('/api/patients/:id/consents', async (req, reply) => {
    const user = guard(req, reply);
    if (!user) return;
    if (user.role !== 'patient') return reply.code(403).send({ error: 'forbidden', message: 'Only the patient can change their consent.' });
    const upd = ctx.db.prepare('UPDATE consents SET granted = ?, updated_at_ms = ? WHERE patient_id = ? AND consent = ?');
    for (const k of ['build', 'care', 'research'] as const) {
      if (typeof req.body?.[k] === 'boolean') upd.run(req.body[k] ? 1 : 0, Date.now(), req.params.id, k);
    }
    t.touch(req.params.id);
    // A global notification lets a care-team view remove a patient whose sharing was revoked.
    ctx.bus.publish({ type: 'clock' });
    return sourceState(ctx, req.params.id);
  });

  app.post<P>('/api/patients/:id/build', async (req, reply) => {
    if (!guard(req, reply)) return;
    const id = req.params.id;
    const s = sourceState(ctx, id);
    if (!s.sources.cgm) return reply.code(409).send({ error: 'no_cgm', message: 'Connect a glucose monitor to continue.' });
    if (!s.consents.build) return reply.code(409).send({ error: 'no_consent', message: 'Allow the twin to use your data to continue.' });
    if (s.readings < 288) return reply.code(409).send({ error: 'not_enough_data', message: 'The twin needs at least a day of CGM readings.' });
    if (t.isRefitting(id)) return reply.code(409).send({ error: 'busy', message: 'Your twin is already being fitted. Try again shortly.' });
    const tw = await t.refit(id);
    if (!tw) return reply.code(409).send({ error: 'not_enough_data', message: 'The twin needs a day of recent CGM readings and permission to use them.' });
    t.evaluateAlerts(id);
    return { ok: true, twin: t.twinSummary(id), fitted: !!tw };
  });

  app.post<P>('/api/patients/:id/import', async (req, reply) => {
    if (!guard(req, reply)) return;
    const id = req.params.id;
    if (t.isRefitting(id)) return reply.code(409).send({ error: 'busy', message: 'Wait for the current fit to finish before importing new data.' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'invalid', message: 'Attach a CSV export.' });
    const text = (await file.toBuffer()).toString('utf8');
    let parsed;
    try {
      parsed = parseCgmCsv(text);
    } catch (err) {
      return reply.code(400).send({ error: 'invalid', message: err instanceof Error ? err.message : 'Could not read this file.' });
    }
    // Replay the export so its last day lands on the demo day (keeping times of day).
    const now = ctx.clock.now();
    const last = parsed.readings[parsed.readings.length - 1].t;
    let shift = istMidnight(now) - istMidnight(last);
    if (minuteOfDayIST(last) > minuteOfDayIST(now)) shift -= 1440;
    ctx.db.transaction(() => {
      if (t.patient(id)?.data_mode === 'synthetic') {
        // Keep manually added entries; discard generated context from the old demo sensor.
        // The timestamp match recognises seeded entries in databases created before provenance tagging.
        ctx.db.prepare(`DELETE FROM events WHERE patient_id = ? AND (meta = '{"synthetic":true}' OR hidden = 1 OR source = 'device'
          OR created_at_ms IN (SELECT created_at_ms FROM users WHERE patient_id = ?))`).run(id, id);
        ctx.db.prepare('DELETE FROM vitals WHERE patient_id = ?').run(id);
        ctx.db.prepare("DELETE FROM records WHERE patient_id = ? AND source LIKE '%Synthetic%'").run(id);
      }
      ctx.db.prepare('DELETE FROM readings WHERE patient_id = ?').run(id);
      ctx.db.prepare('DELETE FROM truth WHERE patient_id = ?').run(id);
      // Models and predictions fitted to the previous sensor must not survive a replacement import.
      ctx.db.prepare('DELETE FROM twins WHERE patient_id = ?').run(id);
      ctx.db.prepare('DELETE FROM alerts WHERE patient_id = ?').run(id);
      ctx.db.prepare('DELETE FROM reviews WHERE patient_id = ?').run(id);
      ctx.db.prepare('DELETE FROM scenarios WHERE patient_id = ?').run(id);
      ctx.db.prepare("DELETE FROM events WHERE patient_id = ? AND source IN ('inferred', 'suggested')").run(id);
      const ins = ctx.db.prepare('INSERT OR REPLACE INTO readings (patient_id, t, mgdl) VALUES (?, ?, ?)');
      for (const r of parsed.readings) ins.run(id, r.t + shift, r.mgdl);
      ctx.db.prepare(`UPDATE patients SET data_mode = 'imported', synthetic = 0 WHERE id = ?`).run(id);
      ctx.db.prepare(`UPDATE sources SET connected = 1, updated_at_ms = ? WHERE patient_id = ? AND source = 'cgm'`).run(Date.now(), id);
    })();
    t.touch(id);
    ctx.bus.publish({ type: 'events', patientId: id });
    return {
      ok: true,
      format: parsed.format,
      count: parsed.readings.length,
      skipped: parsed.skipped,
      days: Math.round((last - parsed.readings[0].t) / 1440),
      lastReading: clockIST(last + shift),
      state: sourceState(ctx, id),
    };
  });
}
