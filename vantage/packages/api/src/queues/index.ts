import IORedis from 'ioredis';
import { Queue, type JobsOptions } from 'bullmq';

/**
 * BullMQ queue infrastructure.
 *
 * Queues:
 *   - vantage.signals.harmonize  : every new Signal lands here for validation (Phase 4)
 *   - vantage.classification.run : per-entity classification jobs (Phase 4)
 *   - vantage.system.portfolio   : nightly rebuild of the system standing portfolio (Phase 5)
 *
 * A single IORedis connection is shared by the queues and the workers in
 * ./workers.ts. maxRetriesPerRequest: null is required by BullMQ for any
 * client used as a Worker connection.
 */

export const HARMONIZE_QUEUE_NAME = 'vantage.signals.harmonize';
export const CLASSIFICATION_QUEUE_NAME = 'vantage.classification.run';
export const SYSTEM_PORTFOLIO_QUEUE_NAME = 'vantage.system.portfolio';
// Phase 8 — meta-learning outcome capture: grades matured decisions against
// realized forward price moves.
export const META_OUTCOME_QUEUE_NAME = 'vantage.meta.outcome';
// Phase 8 — daily universe re-scoring: keeps fresh decisions landing so the
// decision log (and therefore meta-learning) grows without manual input.
export const UNIVERSE_SCORE_QUEUE_NAME = 'vantage.universe.score';

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

export interface MetaOutcomeJob {
  reason: 'cron' | 'manual';
  horizonDays?: number;
}

export interface UniverseScoreJob {
  reason: 'cron' | 'manual';
  /** Optional cap on how many tickers to score this run. */
  limit?: number;
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

export const metaOutcomeQueue = new Queue<MetaOutcomeJob>(META_OUTCOME_QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export const universeScoreQueue = new Queue<UniverseScoreJob>(UNIVERSE_SCORE_QUEUE_NAME, {
  connection,
  defaultJobOptions,
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
  // `||` (not `??`) so a blank env var falls back too — an empty pattern
  // makes BullMQ throw "Either .pattern or .every must be defined".
  const pattern = process.env.SYSTEM_PORTFOLIO_CRON || '0 2 * * *';
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
 * Schedule the daily outcome-capture sweep. Mirrors the system-portfolio
 * scheduler. Default cadence: 03:00 UTC (after the 02:00 portfolio rebuild).
 */
export async function ensureMetaOutcomeSchedule(): Promise<void> {
  const pattern = process.env.META_OUTCOME_CRON || '0 3 * * *';
  try {
    await metaOutcomeQueue.upsertJobScheduler(
      'meta-outcome-daily',
      { pattern, tz: 'UTC' },
      { name: 'capture', data: { reason: 'cron' } },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[queues] failed to register meta outcome cron', err);
  }
}

/**
 * Schedule the daily universe re-scoring sweep. Default 01:00 UTC — runs
 * before the portfolio rebuild (02:00) and outcome capture (03:00) so each
 * day's fresh scores feed the downstream jobs.
 */
export async function ensureUniverseScoreSchedule(): Promise<void> {
  const pattern = process.env.UNIVERSE_SCORE_CRON || '0 1 * * *';
  try {
    await universeScoreQueue.upsertJobScheduler(
      'universe-score-daily',
      { pattern, tz: 'UTC' },
      { name: 'score', data: { reason: 'cron' } },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[queues] failed to register universe score cron', err);
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    harmonizeQueue.close(),
    classificationQueue.close(),
    systemPortfolioQueue.close(),
    metaOutcomeQueue.close(),
    universeScoreQueue.close(),
  ]);
  await connection.quit().catch(() => undefined);
}
