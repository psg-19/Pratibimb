import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod/v4';
import type { Me } from '../../shared/api';
import { createSession, destroySession, hashPassword, SESSION_COOKIE, setSessionCookie, verifyPassword } from '../auth';
import type { UserRow } from '../db/db';
import type { Ctx } from '../app';

const Login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
// Messages are shown to the person signing up, so each names the field and the rule.
const AGE = 'Age must be a whole number from 18 to 110.';
const YEARS = 'Years with type 2 diabetes must be a whole number from 0 to 80.';
const Signup = z.object({
  name: z.string('Enter your full name.').trim().min(2, 'Enter your full name (at least 2 characters).').max(60, 'Keep the name to 60 characters or fewer.'),
  email: z.string('Enter your email address.').trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string('Choose a password.').min(8, 'Use a password of at least 8 characters.').max(200, 'Use a password of 200 characters or fewer.'),
  age: z.number(AGE).int(AGE).min(18, AGE).max(110, AGE).optional(),
  yearsT2D: z.number(YEARS).int(YEARS).min(0, YEARS).max(80, YEARS).optional(),
  city: z.string().trim().max(60, 'Keep the city to 60 characters or fewer.').optional(),
  language: z.enum(['en', 'hi', 'kn']).default('en'),
  pronoun: z.enum(['he', 'she', 'they']).default('they'),
  medsLong: z.string().trim().max(200, 'Keep the medicines to 200 characters or fewer.').default(''),
});

export function me(ctx: Ctx, user: UserRow): Me {
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    patient: user.patient_id ? ctx.twins.summary(user.patient_id) : null,
  };
}

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = Login.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', message: 'Enter your email and password.' });
    const user = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(body.data.email) as UserRow | undefined;
    if (!user || !verifyPassword(body.data.password, user.password_hash)) {
      return reply.code(401).send({ error: 'bad_credentials', message: 'That email and password do not match.' });
    }
    setSessionCookie(reply, createSession(ctx.db, user.id));
    return me(ctx, user);
  });

  app.post('/api/auth/signup', async (req, reply) => {
    const body = Signup.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid', message: body.error.issues[0]?.message ?? 'Check the form.' });
    const d = body.data;
    if (ctx.db.prepare('SELECT 1 FROM users WHERE email = ?').get(d.email)) {
      return reply.code(409).send({ error: 'exists', message: 'An account with this email already exists.' });
    }
    const patientId = randomUUID();
    const userId = randomUUID();
    const initials = d.name
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2);
    const now = Date.now();
    ctx.db.transaction(() => {
      ctx.db
        .prepare(
          `INSERT INTO patients (id, name, initials, age, years_t2d, city, language, pronoun, meds_short, meds_long, avatar, abha_suffix, synthetic, data_mode, created_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'b', NULL, 0, 'empty', ?)`,
        )
        .run(patientId, d.name, initials, d.age ?? null, d.yearsT2D ?? null, d.city ?? null, d.language, d.pronoun, d.medsLong.split(',')[0] ?? '', d.medsLong, now);
      ctx.db.prepare('INSERT INTO users (id, email, name, password_hash, role, patient_id, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, d.email, d.name, hashPassword(d.password), 'patient', patientId, now);
      const src = ctx.db.prepare('INSERT INTO sources (patient_id, source, connected, updated_at_ms) VALUES (?, ?, 0, ?)');
      for (const s of ['cgm', 'watch', 'abha', 'meals', 'bp']) src.run(patientId, s, now);
      const con = ctx.db.prepare('INSERT INTO consents (patient_id, consent, granted, updated_at_ms) VALUES (?, ?, ?, ?)');
      con.run(patientId, 'build', 1, now);
      con.run(patientId, 'care', 1, now);
      con.run(patientId, 'research', 0, now);
    })();
    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    setSessionCookie(reply, createSession(ctx.db, userId));
    return reply.code(201).send(me(ctx, user));
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) destroySession(ctx.db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** The signed-in user, or `null` (not an error) when nobody is signed in. */
  app.get('/api/me', async (req) => (req.user ? me(ctx, req.user) : null));
}
