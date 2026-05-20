/**
 * `vantage meta-backfill` — run the Phase 8 outcome backfill on demand.
 *
 * Enqueues the backfill job onto the BullMQ outcomes queue and waits for the
 * API's in-process worker to finish it, then prints the summary. Useful for
 * first-time setup so the admin doesn't wait until 03:00 UTC to see anything.
 *
 * Requires DATABASE_URL (to count what's pending) and REDIS_URL (to enqueue).
 * The API server must be running so its worker can pick the job up.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, isNull, lt, ne } from 'drizzle-orm';
import IORedis from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';
import { schema, type BackfillSummary } from '@vantage/api/lib';

// Mirror of OUTCOMES_QUEUE_NAME in @vantage/api's queue module. Kept as a local
// constant so this command doesn't import the queue module (which would open a
// Redis connection for every CLI invocation).
const OUTCOMES_QUEUE_NAME = 'vantage.meta.outcomes';
const RESOLVE_AGE_DAYS = 30;

export async function metaBackfill(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  if (!dbUrl) {
    process.stderr.write('DATABASE_URL not set\n');
    process.exit(1);
  }

  const client = postgres(dbUrl, { max: 2 });
  const db = drizzle(client, { schema });
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<{ reason: 'manual' }>(OUTCOMES_QUEUE_NAME, { connection });
  const events = new QueueEvents(OUTCOMES_QUEUE_NAME, { connection });

  const close = async () => {
    await Promise.allSettled([
      queue.close(),
      events.close(),
      client.end({ timeout: 5 }),
      connection.quit(),
    ]);
  };

  try {
    await events.waitUntilReady();

    const cutoff = new Date(Date.now() - RESOLVE_AGE_DAYS * 24 * 60 * 60 * 1000);
    const pending = await db
      .select({ id: schema.platformDecisions.id })
      .from(schema.platformDecisions)
      .where(
        and(
          isNull(schema.platformDecisions.outcomePayload),
          lt(schema.platformDecisions.createdAt, cutoff),
          ne(schema.platformDecisions.decisionType, 'simulation'),
        ),
      );
    process.stderr.write(`Processing ${pending.length} decisions...\n`);

    const job = await queue.add('backfill-outcomes', { reason: 'manual' });
    const summary = (await job.waitUntilFinished(events)) as BackfillSummary;

    process.stderr.write(
      `Resolved ${summary.resolved} decisions, failed ${summary.failed}, ` +
        `skipped ${summary.skipped} (insufficient data).\n`,
    );
    await close();
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (err) {
    process.stderr.write(`meta-backfill failed: ${err instanceof Error ? err.message : String(err)}\n`);
    await close();
    process.exit(1);
  }
}
