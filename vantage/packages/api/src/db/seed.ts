import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, schema } from './client.js';

interface SystemWatchlistSeed {
  name: string;
  description?: string;
  items: string[];
}

/**
 * Phase 10 — create the two system watchlists on first run. Idempotent: the
 * watchlist is inserted ON CONFLICT DO NOTHING (partial unique index on
 * kind='system', name), then items are upserted (unique on watchlistId+entity).
 */
async function seedSystemWatchlists(seedsDir: string): Promise<void> {
  let lists: SystemWatchlistSeed[];
  try {
    const raw = await readFile(join(seedsDir, 'system-watchlists.json'), 'utf-8');
    lists = JSON.parse(raw) as SystemWatchlistSeed[];
  } catch {
    console.log('  system-watchlists.json not found, skipping');
    return;
  }

  for (const list of lists) {
    await db
      .insert(schema.platformWatchlists)
      .values({ name: list.name, kind: 'system', description: list.description ?? null })
      .onConflictDoNothing();

    const [row] = await db
      .select({ id: schema.platformWatchlists.id })
      .from(schema.platformWatchlists)
      .where(
        and(
          eq(schema.platformWatchlists.kind, 'system'),
          eq(schema.platformWatchlists.name, list.name),
        ),
      )
      .limit(1);
    if (!row) continue;

    if (list.items.length > 0) {
      await db
        .insert(schema.platformWatchlistItems)
        .values(list.items.map((entity) => ({ watchlistId: row.id, entity: entity.toUpperCase() })))
        .onConflictDoNothing();
    }
    console.log(`  system watchlist "${list.name}" → ${list.items.length} items`);
  }
}

/**
 * Seeds the DB with golden fixtures and peer sets from infra/seeds/.
 * Idempotent: re-running is safe; new rows are inserted, existing ones skipped.
 */

async function main() {
  const seedsDir = join(process.cwd(), '../../infra/seeds');
  console.log(`Seeding from ${seedsDir}...`);

  // Companies
  try {
    const raw = await readFile(join(seedsDir, 'companies.json'), 'utf-8');
    const companies = JSON.parse(raw) as Array<typeof schema.platformCompanies.$inferInsert>;
    if (companies.length > 0) {
      await db.insert(schema.platformCompanies).values(companies).onConflictDoNothing();
      console.log(`  inserted ${companies.length} companies`);
    }
  } catch (err) {
    console.log('  companies.json not found, skipping');
  }

  // Phase 10 — system watchlists
  await seedSystemWatchlists(seedsDir);

  console.log('Seed complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
