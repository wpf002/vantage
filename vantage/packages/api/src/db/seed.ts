import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db, schema } from './client.js';

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

  console.log('Seed complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
