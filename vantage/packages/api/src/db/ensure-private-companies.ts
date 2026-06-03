import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from './client.js';

/**
 * Boot-time idempotent seed for PRIVATE companies only.
 *
 * The public universe is populated by the universe loader + daily cron, but the
 * private companies (Anthropic, Stripe, Databricks) live only in infra/seeds.
 * After a fresh/reset Postgres they'd be missing, and every private valuation
 * fails with "company not found". This inserts any missing private company by
 * name — it does NOT run the full db:seed (which would write golden fixtures
 * into production). Runs on each boot before the server starts.
 *
 * Never fatal: logs and exits 0 so a seeding hiccup can't block boot.
 */

interface SeedCompany {
  name: string;
  marketType: string;
  ticker?: string;
  sector: string;
  lifeStage: string;
  country: string;
}

async function main(): Promise<void> {
  const path = join(process.cwd(), '../../infra/seeds/companies.json');
  const all = JSON.parse(readFileSync(path, 'utf-8')) as SeedCompany[];
  const privates = all.filter((c) => c.marketType === 'private');

  let inserted = 0;
  for (const c of privates) {
    const existing = await db
      .select({ id: schema.platformCompanies.id })
      .from(schema.platformCompanies)
      .where(eq(schema.platformCompanies.name, c.name))
      .limit(1);
    if (existing.length > 0) continue;

    await db.insert(schema.platformCompanies).values({
      name: c.name,
      marketType: c.marketType,
      sector: c.sector,
      lifeStage: c.lifeStage,
      country: c.country,
    } as typeof schema.platformCompanies.$inferInsert);
    inserted++;
    process.stderr.write(`ensure-private-companies: inserted ${c.name}\n`);
  }
  process.stderr.write(
    `ensure-private-companies: done (${inserted} inserted, ${privates.length} private total)\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(
      `ensure-private-companies: non-fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(0);
  });
