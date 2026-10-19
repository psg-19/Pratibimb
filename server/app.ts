import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import type { AiService } from './ai/client';
import { SESSION_COOKIE, userForToken } from './auth';
import { config } from './config';
import type { DB } from './db/db';
import { aiRoutes } from './routes/ai';
import { authRoutes } from './routes/auth';
import { careRoutes } from './routes/care';
import { patientRoutes } from './routes/patient';
import { systemRoutes } from './routes/system';
import type { Bus } from './services/bus';
import type { Clock } from './services/clock';
import type { TwinService } from './services/twin';

export interface Ctx {
  db: DB;
  clock: Clock;
  bus: Bus;
  twins: TwinService;
  ai: AiService;
}

export async function buildApp(ctx: Ctx, opts: { logger?: boolean; serveStatic?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false, bodyLimit: 12 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = userForToken(ctx.db, req.cookies[SESSION_COOKIE]);
  });

  systemRoutes(app, ctx);
  authRoutes(app, ctx);
  patientRoutes(app, ctx);
  careRoutes(app, ctx);
  aiRoutes(app, ctx);

  if (opts.serveStatic && existsSync(config.staticDir)) {
    // Files are looked up per request, so a rebuilt bundle is served without a restart.
    await app.register(fastifyStatic, { root: config.staticDir, wildcard: true });
    // Single-page app: unknown routes get index.html. A missing file (e.g. an old hashed bundle
    // requested by a tab opened before a redeploy) is a real 404, not HTML posing as JavaScript.
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0];
      if (path.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      if (/\.[a-z0-9]+$/i.test(path)) return reply.code(404).type('text/plain').send('Not found');
      return reply.sendFile('index.html');
    });
  }
  return app;
}
