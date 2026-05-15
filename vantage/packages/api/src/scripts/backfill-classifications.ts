import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { classificationQueue, closeQueues } from '../queues/index.js';

/**
 * One-shot: for every entity with at least one row in platform_signals,
 * enqueue a ClassificationJob. Workers (running in the API process) do the
 * actual classifying — this script just primes the queue.
 *
 * Idempotent — running again re-classifies based on current signal state.
 */

async function main(): Promise<void> {
  const rows = await db
    .selectDistinct({ entity: schema.platformSignals.entity })
    .from(schema.platformSignals);

  const entities = rows.map((r) => r.entity).filter(Boolean);
  if (entities.length === 0) {
    process.stderr.write('No signals found — nothing to backfill.\n');
    await closeQueues();
    return;
  }

  process.stderr.write(`Enqueuing ${entities.length} classification jobs…\n`);

  let i = 0;
  for (const entity of entities) {
    i += 1;
    await classificationQueue.add('classify', {
      entity,
      triggeredBySignalId: 'backfill',
    });
    process.stderr.write(`  · [${i}/${entities.length}] ${entity}\n`);
  }

  process.stderr.write(
    `\nEnqueued ${entities.length} jobs. Workers process them in the background — ` +
      `check the API logs or hit /v1/classifications when they settle.\n`,
  );

  // Drop the count for sanity.
  const remaining = await db.execute(sql`SELECT COUNT(*) AS n FROM platform_signals`);
  process.stderr.write(`(signals in DB: ${(remaining as unknown as Array<{ n: number }>)[0]?.n})\n`);

  await closeQueues();
}

main().catch((err) => {
  process.stderr.write(`backfill failed: ${(err as Error).message}\n`);
  process.exit(1);
});
