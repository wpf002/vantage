import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as authSchema from './auth-schema';

/**
 * Dedicated Drizzle client for the UI's NextAuth adapter.
 *
 * Auth.js writes (sign-in, magic-link verification, session refresh) are
 * infrequent compared to the API's read/write traffic, so a small pool here
 * is the right shape — and Postgres handles multiple clients trivially.
 *
 * Scoped to the auth tables only. Anything else the UI needs from the DB
 * goes through the API gateway.
 */

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://vantage:vantage@localhost:5432/vantage';

// In Next.js dev, HMR re-evaluates this module on every code change. Without
// a global cache, each reload leaks a fresh pool and Postgres quickly hits
// max_connections. Stash the client on globalThis so it survives HMR.
const globalForDb = globalThis as unknown as {
  __vantageAuthPg?: ReturnType<typeof postgres>;
};

const queryClient = globalForDb.__vantageAuthPg ?? postgres(connectionString, { max: 5 });
if (process.env.NODE_ENV !== 'production') globalForDb.__vantageAuthPg = queryClient;

export const db = drizzle(queryClient, { schema: authSchema });
export { authSchema };
