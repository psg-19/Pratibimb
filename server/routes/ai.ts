import { ApiError, type Content } from '@google/genai';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ChatStreamEvent, Lang } from '../../shared/api';
import { AiBadOutput, AiRefused, AiUnavailable } from '../ai/client';
import type { DraftIntent } from '../ai/offline';
import type { Ctx } from '../app';
import { patientGuard } from './patient';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const langOf = (x: unknown, fallback: Lang): Lang => (x === 'en' || x === 'hi' || x === 'kn' ? x : fallback);

function aiError(reply: FastifyReply, err: unknown) {
  if (err instanceof AiUnavailable) return reply.code(503).send({ error: 'ai_unavailable', message: err.message });
  if (err instanceof AiRefused) return reply.code(422).send({ error: 'ai_refused', message: 'The AI could not help with that request.' });
  if (err instanceof AiBadOutput) return reply.code(502).send({ error: 'ai_error', message: 'The AI gave an answer we could not read. Try again.' });
  if (err instanceof ApiError) {
    if (err.status === 429) return reply.code(503).send({ error: 'ai_busy', message: 'The AI service is busy (free-tier limit). Try again in a minute.' });
    if (err.status === 400 && /api key/i.test(err.message)) return reply.code(503).send({ error: 'ai_auth', message: 'The AI key on the server is not valid.' });
    if (err.status === 401 || err.status === 403) return reply.code(503).send({ error: 'ai_auth', message: 'The AI key on the server is not valid.' });
    if (err.status >= 500) return reply.code(503).send({ error: 'ai_busy', message: 'The AI service is unavailable right now. Try again in a minute.' });
    return reply.code(502).send({ error: 'ai_error', message: 'The AI service returned an error.' });
  }
  reply.log.error(err);
  return reply.code(500).send({ error: 'server_error', message: err instanceof Error ? err.message : 'Something went wrong.' });
}

export function aiRoutes(app: FastifyInstance, ctx: Ctx) {
  const guard = patientGuard(ctx);
  const t = ctx.twins;
  type P = { Params: { id: string } };

  app.post<P & { Body: { text: string } }>('/api/patients/:id/ai/meal-text', async (req, reply) => {
    if (!guard(req, reply)) return;
    const text = String(req.body?.text ?? '').trim().slice(0, 600);
    if (!text) return reply.code(400).send({ error: 'invalid', message: 'Describe the meal first.' });
    try {
      return await ctx.ai.mealFromText(text, t.patient(req.params.id)!.language);
    } catch (err) {
      return aiError(reply, err);
    }
  });

  app.post<P>('/api/patients/:id/ai/meal-photo', async (req, reply) => {
    if (!guard(req, reply)) return;
    if (!ctx.ai.enabled) return aiError(reply, new AiUnavailable());
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'invalid', message: 'Attach a photo.' });
    const type = file.mimetype as (typeof IMAGE_TYPES)[number];
    if (!IMAGE_TYPES.includes(type)) return reply.code(400).send({ error: 'invalid', message: 'Use a JPEG, PNG, WebP or GIF photo.' });
    const data = (await file.toBuffer()).toString('base64');
    const note = typeof file.fields.note === 'object' && file.fields.note && 'value' in file.fields.note ? String(file.fields.note.value).slice(0, 300) : '';
    try {
      return await ctx.ai.mealFromPhoto(data, type, note);
    } catch (err) {
      return aiError(reply, err);
    }
  });

  app.post<P>('/api/patients/:id/ai/records', async (req, reply) => {
    if (!guard(req, reply)) return;
    if (!ctx.ai.enabled) return aiError(reply, new AiUnavailable());
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'invalid', message: 'Attach a PDF or a photo of the report.' });
    const type = file.mimetype;
    if (type !== 'application/pdf' && !IMAGE_TYPES.includes(type as (typeof IMAGE_TYPES)[number])) {
      return reply.code(400).send({ error: 'invalid', message: 'Use a PDF or an image.' });
    }
    try {
      return await ctx.ai.extractRecords((await file.toBuffer()).toString('base64'), type);
    } catch (err) {
      return aiError(reply, err);
    }
  });

  app.post<P & { Body: { preferences?: string } }>('/api/patients/:id/ai/plan', async (req, reply) => {
    if (!guard(req, reply)) return;
    if (!t.twin(req.params.id)) return reply.code(409).send({ error: 'no_twin', message: 'Build the twin first.' });
    try {
      return await ctx.ai.planDinners(req.params.id, String(req.body?.preferences ?? '').slice(0, 300));
    } catch (err) {
      return aiError(reply, err);
    }
  });

  app.get<P & { Querystring: { lang?: string } }>('/api/patients/:id/ai/explain', async (req, reply) => {
    if (!guard(req, reply)) return;
    try {
      return await ctx.ai.explain(req.params.id, langOf(req.query.lang, t.patient(req.params.id)!.language));
    } catch (err) {
      return aiError(reply, err);
    }
  });

  app.get<P>('/api/patients/:id/ai/brief', async (req, reply) => {
    const user = guard(req, reply);
    if (!user) return;
    if (user.role !== 'clinician') return reply.code(403).send({ error: 'forbidden', message: 'Care-team only.' });
    try {
      return await ctx.ai.brief(req.params.id);
    } catch (err) {
      return aiError(reply, err);
    }
  });

  app.post<P & { Body: { intent?: string; language?: string; note?: string } }>('/api/patients/:id/ai/draft', async (req, reply) => {
    const user = guard(req, reply);
    if (!user) return;
    if (user.role !== 'clinician') return reply.code(403).send({ error: 'forbidden', message: 'Care-team only.' });
    const intents: DraftIntent[] = ['snack', 'reminder', 'call', 'sensor', 'checkin', 'ack'];
    const intent = intents.includes(req.body?.intent as DraftIntent) ? (req.body!.intent as DraftIntent) : 'checkin';
    try {
      return await ctx.ai.draft(req.params.id, intent, langOf(req.body?.language, t.patient(req.params.id)!.language), String(req.body?.note ?? '').slice(0, 300));
    } catch (err) {
      return aiError(reply, err);
    }
  });

  /* ---------- Ask your twin ---------- */

  app.get<P>('/api/patients/:id/chat', async (req, reply) => {
    if (!guard(req, reply)) return;
    const rows = ctx.db.prepare('SELECT id, role, content, created_at_ms FROM chat WHERE patient_id = ? ORDER BY id DESC LIMIT 30').all(req.params.id) as { id: number; role: string; content: string; created_at_ms: number }[];
    return { enabled: ctx.ai.enabled, messages: rows.reverse().map((r) => ({ id: r.id, role: r.role, text: r.content })) };
  });

  app.delete<P>('/api/patients/:id/chat', async (req, reply) => {
    if (!guard(req, reply)) return;
    ctx.db.prepare('DELETE FROM chat WHERE patient_id = ?').run(req.params.id);
    return { ok: true };
  });

  app.post<P & { Body: { message: string } }>('/api/patients/:id/chat', async (req, reply) => {
    if (!guard(req, reply)) return;
    if (!ctx.ai.enabled) return aiError(reply, new AiUnavailable());
    const id = req.params.id;
    if (!t.twin(id)) return reply.code(409).send({ error: 'no_twin', message: 'Build the twin first.' });
    const message = String(req.body?.message ?? '').trim().slice(0, 1000);
    if (!message) return reply.code(400).send({ error: 'invalid', message: 'Type a question.' });

    const past = (ctx.db.prepare('SELECT role, content FROM chat WHERE patient_id = ? ORDER BY id DESC LIMIT 12').all(id) as { role: 'user' | 'assistant'; content: string }[]).reverse();
    // History must start with a user turn and alternate. A question whose answer failed leaves two
    // user turns in a row, so consecutive turns from the same side are merged.
    while (past.length && past[0].role !== 'user') past.shift();
    const history: Content[] = [];
    for (const m of [...past, { role: 'user' as const, content: message }]) {
      const role = m.role === 'user' ? 'user' : 'model';
      const prev = history.at(-1);
      if (prev?.role === role) prev.parts!.push({ text: m.content });
      else history.push({ role, parts: [{ text: m.content }] });
    }
    ctx.db.prepare('INSERT INTO chat (patient_id, role, content, created_at_ms) VALUES (?, ?, ?, ?)').run(id, 'user', message, Date.now());

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const emit = (e: ChatStreamEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    try {
      const answer = await ctx.ai.chat(id, history, emit);
      if (answer.trim()) ctx.db.prepare('INSERT INTO chat (patient_id, role, content, created_at_ms) VALUES (?, ?, ?, ?)').run(id, 'assistant', answer.trim(), Date.now());
      emit({ type: 'done' });
    } catch (err) {
      req.log.error(err);
      emit({
        type: 'error',
        text: err instanceof ApiError ? (err.status === 429 ? 'The AI service is busy (free-tier limit). Try again in a minute.' : 'The AI service is unavailable right now.') : 'Something went wrong.',
      });
    } finally {
      res.end();
    }
  });
}
