import type { FastifyInstance } from 'fastify';
import type { Health } from '../../shared/api';
import { canAccessPatient, requireUser, SESSION_COOKIE, userForToken } from '../auth';
import { config } from '../config';
import type { Ctx } from '../app';
import { resetDb, seed } from '../db/seed';
import type { LiveEvent } from '../services/bus';

export function systemRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/health', async (): Promise<Health> => ({ ok: true, ai: ctx.ai.enabled, aiModel: config.aiModel, clock: ctx.clock.state() }));

  app.post<{ Body: { speed?: number; paused?: boolean; reset?: boolean } }>('/api/clock', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const b = req.body ?? {};
    const speed = typeof b.speed === 'number' ? Math.max(0, Math.min(240, b.speed)) : undefined;
    if (b.reset) {
      // Resetting simulated time cannot rewind data, so it only re-anchors the clock forward.
      ctx.clock.set({ paused: false, speed: config.demoSpeed });
    } else {
      ctx.clock.set({ speed, paused: b.paused });
    }
    ctx.bus.publish({ type: 'clock' });
    return ctx.clock.state();
  });

  /** Restarts the demo story: wipes all data, reseeds the six patients at the demo start time. Care team only. */
  app.post('/api/demo/reset', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (user.role !== 'clinician') return reply.code(403).send({ error: 'forbidden', message: 'Care-team only.' });
    if (ctx.twins.resetting) return reply.code(409).send({ error: 'busy', message: 'A reset is already running.' });
    ctx.twins.resetting = true;
    try {
      resetDb(ctx.db);
      ctx.clock.set({ to: ctx.clock.demoStart, paused: true });
      await seed(ctx.db, ctx.twins);
      ctx.clock.set({ paused: false, speed: config.demoSpeed });
      ctx.twins.touchAll();
    } finally {
      ctx.twins.resetting = false;
    }
    ctx.bus.publish({ type: 'clock' });
    return { ok: true };
  });

  /** Server-Sent Events: readings, alerts, twin refits and messages for the patients this user may see. */
  app.get('/api/stream', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (e: LiveEvent | { type: 'hello' | 'ping' }) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: 'hello' });
    const off = ctx.bus.subscribe((e) => {
      if (!userForToken(ctx.db, req.cookies[SESSION_COOKIE])) { res.end(); return; }
      if ('patientId' in e && !canAccessPatient(user, e.patientId, ctx.db)) return;
      send(e);
    });
    const ping = setInterval(() => send({ type: 'ping' }), 15_000);
    res.on('close', () => {
      clearInterval(ping);
      off();
    });
  });
}
