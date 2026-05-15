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

const queryClient = postgres(connectionString, { max: 5 });
export const db = drizzle(queryClient, { schema: authSchema });
export { authSchema };
