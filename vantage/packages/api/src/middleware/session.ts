import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

/**
 * Session-aware preHandler. Reads the NextAuth session cookie from the
 * incoming request, joins sessions → users, and decorates request.user.
 *
 * The hook NEVER rejects. Routes that require auth check request.user
 * themselves and return 401. This keeps public routes (scoring, search,
 * classifications) open while letting protected routes opt in by checking
 * the request.user property.
 *
 * Auth.js v5 default cookie names:
 *   dev  : authjs.session-token
 *   prod : __Secure-authjs.session-token
 *
 * NextAuth v4 cookies (`next-auth.session-token`) are also accepted for
 * tolerance during the v4→v5 transition window — same shape, same table.
 */

const SESSION_COOKIE_NAMES = [
  '__Secure-authjs.session-token',
  'authjs.session-token',
  '__Secure-next-auth.session-token',
  'next-auth.session-token',
] as const;

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; email: string; name: string | null } | null;
  }
}

function readSessionToken(req: FastifyRequest): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookieName of SESSION_COOKIE_NAMES) {
    const prefix = `${cookieName}=`;
    const found = cookies.find((c) => c.startsWith(prefix));
    if (found) {
      try {
        return decodeURIComponent(found.substring(prefix.length));
      } catch {
        return found.substring(prefix.length);
      }
    }
  }
  return null;
}

export async function registerSessionMiddleware(app: FastifyInstance): Promise<void> {
  app.decorateRequest('user', null);

  app.addHook('preHandler', async (req) => {
    req.user = null;
    const token = readSessionToken(req);
    if (!token) return;

    try {
      const rows = await db
        .select({
          userId: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
        })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
        .where(and(eq(schema.sessions.sessionToken, token), gt(schema.sessions.expires, new Date())))
        .limit(1);
      if (rows.length === 0) return;
      const row = rows[0]!;
      req.user = { id: row.userId, email: row.email, name: row.name };

      // Fire-and-forget last-seen update — failures must never block the
      // request, so we deliberately do not await.
      void db
        .update(schema.users)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.users.id, row.userId))
        .catch(() => undefined);
    } catch (err) {
      // Session lookup is best-effort. Log at debug — protected routes will
      // still return 401 because req.user stays null.
      req.log.debug({ err }, 'session lookup failed');
    }
  });
}
