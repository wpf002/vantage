import IORedis from 'ioredis';
import { Queue, type JobsOptions } from 'bullmq';

/**
 * BullMQ queue infrastructure.
 *
 * Queues:
 *   - vantage.signals.harmonize  : every new Signal lands here for validation (Phase 4)
 *   - vantage.classification.run : per-entity classification jobs (Phase 4)
 *   - vantage.system.portfolio   : nightly rebuild of the system standing portfolio (Phase 5)
 *   - vantage.meta.outcomes      : nightly outcome backfill for the decision log (Phase 8)
 *
 * A single IORedis connection is shared by the queues and the workers in
 * ./workers.ts. maxRetriesPerRequest: null is required by BullMQ for any
 * client used as a Worker connection.
 */

export const HARMONIZE_QUEUE_NAME = 'vantage.signals.harmonize';
export const CLASSIFICATION_QUEUE_NAME = 'vantage.classification.run';
export const SYSTEM_PORTFOLIO_QUEUE_NAME = 'vantage.system.portfolio';
export const OUTCOMES_QUEUE_NAME = 'vantage.meta.outcomes';

export interface HarmonizeJob {
  signalId: string;
  entity: string;
  signalType: string;
}

export interface ClassificationJob {
  entity: string;
  triggeredBySignalId: string;
}

export interface SystemPortfolioJob {
  reason: 'cron' | 'manual';
}

export interface OutcomesJob {
  reason: 'cron' | 'manual';
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

connection.on('error', (err) => {
  // Don't crash the API on transient Redis hiccups — the worker queue is
  // best-effort and persistSignal already swallows enqueue failures.
  // eslint-disable-next-line no-console
  console.error('[queues] redis error', err.message);
});

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export const harmonizeQueue = new Queue<HarmonizeJob>(HARMONIZE_QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export const classificationQueue = new Queue<ClassificationJob>(CLASSIFICATION_QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export const systemPortfolioQueue = new Queue<SystemPortfolioJob>(SYSTEM_PORTFOLIO_QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export const outcomesQueue = new Queue<OutcomesJob>(OUTCOMES_QUEUE_NAME, {
  connection,
  // Outcome backfill re-runs live valuations — give it room and don't retry a
  // partial run three times. attempts:1 keeps a failed night from re-burning
  // the FMP budget; the next cron tick picks up whatever is still unresolved.
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
  },
});

/**
 * Schedule the nightly system-portfolio rebuild as a BullMQ job scheduler.
 *
 * Uses `upsertJobScheduler` (BullMQ v5+) instead of `add(..., { repeat })` +
 * `jobId`. Mixing a custom jobId with a cron pattern in v5 confuses the
 * iteration tracker and logs "Either .pattern or .every options must be
 * defined for this repeatable job" on every cycle. The scheduler API is
 * the documented v5 replacement and is idempotent by key.
 *
 * Default cadence: 02:00 UTC every night.
 */
export async function ensureSystemPortfolioSchedule(): Promise<void> {
  const pattern = process.env.SYSTEM_PORTFOLIO_CRON ?? '0 2 * * *';
  try {
    await systemPortfolioQueue.upsertJobScheduler(
      'system-portfolio-nightly',
      { pattern, tz: 'UTC' },
      { name: 'rebuild', data: { reason: 'cron' } },
    );
  } catch (err) {
    // Don't crash boot on Redis stalls — the rebuild can also be triggered
    // by the admin endpoint or the CLI.
    // eslint-disable-next-line no-console
    console.error('[queues] failed to register system portfolio cron', err);
  }
}

/**
 * Schedule the nightly outcome backfill (Phase 8). Runs at 03:00 UTC — after
 * the 02:00 system-portfolio rebuild — so the day's classifications settle
 * before outcomes are resolved against them. Same idempotent scheduler API as
 * the portfolio rebuild.
 */
export async function ensureOutcomesSchedule(): Promise<void> {
  const pattern = process.env.OUTCOMES_CRON ?? '0 3 * * *';
  try {
    await outcomesQueue.upsertJobScheduler(
      'meta-outcomes-nightly',
      { pattern, tz: 'UTC' },
      { name: 'backfill-outcomes', data: { reason: 'cron' } },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[queues] failed to register outcomes cron', err);
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    harmonizeQueue.close(),
    classificationQueue.close(),
    systemPortfolioQueue.close(),
    outcomesQueue.close(),
  ]);
  await connection.quit().catch(() => undefined);
}
