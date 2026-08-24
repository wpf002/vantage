/**
 * Idempotent demo-user seeder.
 *
 * Creates (or updates the password for) a demo account so the app can be
 * shown without creating a new account each time.
 *
 * Usage:
 *   DEMO_EMAIL=demo@vantage.app DEMO_PASSWORD=vantage2024 \
 *     tsx --env-file=../../.env src/scripts/seed-demo-user.ts
 *
 * Or rely on the defaults below if env vars aren't set.
 */

// env loaded via --env-file flag in the npm script
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as authSchema from '../lib/auth-schema.js';

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@vantage.app';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'vantage2024';
const BCRYPT_COST = 10;

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://vantage:vantage@localhost:5432/vantage';

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql, { schema: authSchema });

async function main() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);

  const existing = await db
    .select({ id: authSchema.users.id })
    .from(authSchema.users)
    .where(eq(authSchema.users.email, DEMO_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(authSchema.users)
      .set({ passwordHash: hash })
      .where(eq(authSchema.users.email, DEMO_EMAIL));
    console.log(`Demo account updated: ${DEMO_EMAIL}`);
  } else {
    await db.insert(authSchema.users).values({ email: DEMO_EMAIL, passwordHash: hash });
    console.log(`Demo account created: ${DEMO_EMAIL}`);
  }

  console.log(`Password: ${DEMO_PASSWORD}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
