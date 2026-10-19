/** Password hashing (scrypt) and cookie sessions. */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB, UserRow } from './db/db';
import { config } from './config';

export const SESSION_COOKIE = 'pb_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: DB, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + config.sessionDays * 86_400_000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at_ms) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  return token;
}

export function destroySession(db: DB, token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function userForToken(db: DB, token: string | undefined): UserRow | null {
  if (!token) return null;
  const row = db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at_ms > ?')
    .get(sha256(token), Date.now()) as UserRow | undefined;
  return row ?? null;
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionDays * 86_400,
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

/** 401 unless signed in. */
export function requireUser(req: FastifyRequest, reply: FastifyReply): UserRow | null {
  if (!req.user) {
    void reply.code(401).send({ error: 'unauthorized', message: 'Please sign in.' });
    return null;
  }
  return req.user;
}

/** Patients may only see themselves; clinicians may see everyone in this prototype. */
export function canAccessPatient(user: UserRow, patientId: string, db: DB) {
  if (user.role !== 'clinician') return user.patient_id === patientId;
  return !!db.prepare("SELECT 1 FROM consents WHERE patient_id = ? AND consent = 'care' AND granted = 1").get(patientId);
}
