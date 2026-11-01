import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lt, ne } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { sessions, users } = schema;
export const SESSION_TTL_SEC = 14 * 24 * 3600;
export const COOKIE_NAME = 'pvemon_sid';

// En la BD solo se guarda el hash del token: si se filtra la BD, las sesiones no sirven.
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function createSession(userId: string, userAgent?: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.insert(sessions)
    .values({ id: hashToken(token), userId, userAgent: userAgent?.slice(0, 200), expiresAt: now + SESSION_TTL_SEC })
    .run();
  return token;
}

export function resolveSession(token: string) {
  const id = hashToken(token);
  const row = db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  if (row.expiresAt < Math.floor(Date.now() / 1000) || row.user.disabled) return null;
  return { sessionId: id, user: row.user };
}

export const deleteSession = (token: string) =>
  void db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();

export const deleteUserSessions = (userId: string, exceptSessionId?: string) =>
  void db
    .delete(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId))
    .run();

export const purgeExpiredSessions = () =>
  void db.delete(sessions).where(lt(sessions.expiresAt, Math.floor(Date.now() / 1000))).run();
