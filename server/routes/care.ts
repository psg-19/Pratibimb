import type { FastifyInstance } from 'fastify';
import type { CarePatientDTO, ReviewStatus } from '../../shared/api';
import { canAccessPatient, requireUser } from '../auth';
import type { Ctx } from '../app';
import { sendMessage } from './patient';

const MESSAGES: Record<string, (first: string, extra: string) => string> = {
  snack: () => 'Your twin expects a low tonight while you sleep. Please have a small snack before bed — a glass of milk or a banana.',
  call: (_f, at) => `I will call you at ${at} to go over your sick-day plan. Keep drinking water and check your glucose before then.`,
  reminder: () => 'A reminder to take your evening metformin tonight. Your twin sees your glucose staying high when it is missed.',
  checkin: () => 'How are you feeling tonight? Your twin expects your glucose to stay high for a while. Tell me what you had for dinner — a short walk can help.',
  sensor: (_f, at) => `Your CGM sensor expires at ${at}. Please change it before bed so your twin can keep watching overnight.`,
};

export function careRoutes(app: FastifyInstance, ctx: Ctx) {
  const t = ctx.twins;

  app.get('/api/care', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (user.role !== 'clinician') return reply.code(403).send({ error: 'forbidden', message: 'Care-team view only.' });
    return t.patients().filter((p) => canAccessPatient(user, p.id, ctx.db)).map((p) => t.careEntry(p.id)).filter((x): x is CarePatientDTO => !!x);
  });

  app.post<{ Params: { id: string }; Body: { status: ReviewStatus } }>('/api/care/:id/review', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (user.role !== 'clinician') return reply.code(403).send({ error: 'forbidden', message: 'Care-team only.' });
    const id = req.params.id;
    if (!canAccessPatient(user, id, ctx.db)) return reply.code(403).send({ error: 'forbidden', message: 'This patient has not enabled care-team sharing.' });
    const entry = t.careEntry(id);
    if (!entry) return reply.code(404).send({ error: 'not_found', message: 'No such patient.' });
    const status = req.body?.status;
    if (!['new', 'reviewed', 'acted'].includes(status)) return reply.code(400).send({ error: 'invalid', message: 'Unknown status.' });
    const night = t.nightKey();
    const now = ctx.clock.now();
    const prev = ctx.db.prepare('SELECT status, note FROM reviews WHERE patient_id = ? AND night = ?').get(id, night) as { status: ReviewStatus; note: string | null } | undefined;
    if (prev?.status === status) return entry;

    let note: string | null = null;
    if (status === 'acted') {
      const a = entry.action;
      note = a.done;
      const first = entry.patient.firstName;
      if (a.effect === 'snack') {
        const eventId = t.planSnack(id);
        const open = ctx.db.prepare(`SELECT id FROM alerts WHERE patient_id = ? AND kind = 'predicted-low' AND status = 'open' ORDER BY issued_at DESC LIMIT 1`).get(id) as { id: number } | undefined;
        if (open) ctx.db.prepare(`UPDATE alerts SET status = 'snack', handled_at = ?, snack_event_id = ? WHERE id = ?`).run(now, eventId, open.id);
        sendMessage(ctx, id, { sender: 'clinician', author: user.name, body: MESSAGES.snack(first, ''), language: entry.patient.language, kind: 'nudge' });
      } else if (a.effect === 'call' || a.effect === 'reminder' || a.effect === 'checkin' || a.effect === 'sensor') {
        const at = /\d\d:\d\d/.exec(a.done)?.[0] ?? /\d\d:\d\d/.exec(entry.facts.join(' '))?.[0] ?? '';
        sendMessage(ctx, id, { sender: 'clinician', author: user.name, body: MESSAGES[a.effect](first, at), language: entry.patient.language });
      }
    } else if (status === 'reviewed') {
      note = `Marked reviewed · ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now * 60_000))}`;
    } else if (prev?.status === 'acted') {
      // Undo a snack suggestion that hasn't been eaten yet.
      const snack = t.plannedSnack(id);
      if (snack) {
        t.cancelSnack(id, snack.id);
        ctx.db.prepare(`UPDATE alerts SET status = 'open', handled_at = NULL, snack_event_id = NULL WHERE patient_id = ? AND status = 'snack' AND snack_event_id = ?`).run(id, snack.id);
      }
    }
    ctx.db
      .prepare(`INSERT INTO reviews (patient_id, night, status, note, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(patient_id, night) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`)
      .run(id, night, status, note, now);
    t.touch(id);
    ctx.bus.publish({ type: 'review', patientId: id });
    return t.careEntry(id);
  });
}
