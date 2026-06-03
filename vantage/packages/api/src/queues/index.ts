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
// Phase 8+ — the learning step: re-weights the Public Score components from
// graded outcomes (runs nightly after outcome capture). Closes the loop.
export const CALIBRATE_WEIGHTS_QUEUE_NAME = 'vantage.meta.calibrate';
// Phase 8 — daily universe re-scoring: keeps fresh decisions landing so the
// decision log (and therefore meta-learning) grows without manual input.
export const UNIVERSE_SCORE_QUEUE_NAME = 'vantage.universe.score';
// Universe loader — weekly refresh of the Russell-3000-approximation
// listing in `platform_companies` (handles IPOs, delistings, and Russell
// reconstitutions). One-shot version is the `load:universe` CLI script.
export const UNIVERSE_LOAD_QUEUE_NAME = 'vantage.universe.load';
// Weekly Vantage growth report email — coverage, signal highlights, and
// engine quality, delivered through Resend.
export const PROGRESS_REPORT_QUEUE_NAME = 'vantage.report.weekly';
// Phase 10 — time-based Morning Read digest delivery (cron, every 15 min).
export const MORNING_DIGEST_QUEUE_NAME = 'vantage.alerts.morning-digest';
// Phase 10 — per-ticker news-assisted narrative tagging jobs.
export const NARRATIVE_TAG_QUEUE_NAME = 'vantage.narrative.tag';

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

export interface CalibrateWeightsJob {
  reason: 'cron' | 'manual';
}

export interface UniverseLoadJob {
  reason: 'cron' | 'manual';
  /** Override the default $200M market-cap floor — useful for test runs. */
  minMarketCapUsd?: number;
  /** Optional cap on how many rows to upsert this run. */
  limit?: number;
}

export interface WeeklyProgressReportJob {
  reason: 'cron' | 'manual';
  /** Override the configured PROGRESS_REPORT_EMAIL recipient. */
  to?: string;
}

export interface MorningDigestJob {
  reason: 'cron' | 'manual';
}

export interface NarrativeTagJob {
  ticker: string;
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

export const metaOutcomeQueue = new Queue<MetaOutcomeJob>(META_OUTCOME_QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export const universeScoreQueue = new Queue<UniverseScoreJob>(UNIVERSE_SCORE_QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export const calibrateWeightsQueue = new Queue<CalibrateWeightsJob>(
  CALIBRATE_WEIGHTS_QUEUE_NAME,
  { connection, defaultJobOptions },
);

export const universeLoadQueue = new Queue<UniverseLoadJob>(UNIVERSE_LOAD_QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export const progressReportQueue = new Queue<WeeklyProgressReportJob>(
  PROGRESS_REPORT_QUEUE_NAME,
  { connection, defaultJobOptions },
);

export const morningDigestQueue = new Queue<MorningDigestJob>(MORNING_DIGEST_QUEUE_NAME, {
  connection,
  defaultJobOptions,
});

export const narrativeTagQueue = new Queue<NarrativeTagJob>(NARRATIVE_TAG_QUEUE_NAME, {
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
 * Schedule the nightly weight-calibration step. Default 04:00 UTC — runs after
 * outcome capture (03:00) so it learns from the freshest grades. This is the
 * write-back half of the learning loop: it re-weights the Public Score
 * components from graded outcomes. No-ops (logs and leaves weights unchanged)
 * until enough graded outcomes accumulate.
 */
export async function ensureCalibrateWeightsSchedule(): Promise<void> {
  const pattern = process.env.CALIBRATE_WEIGHTS_CRON || '0 4 * * *';
  try {
    await calibrateWeightsQueue.upsertJobScheduler(
      'calibrate-weights-nightly',
      { pattern, tz: 'UTC' },
      { name: 'calibrate', data: { reason: 'cron' } },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[queues] failed to register calibrate weights cron', err);
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

/**
 * Schedule the weekly Vantage growth-report email. Default Sunday 14:00 UTC
 * (10:00 ET). Disabled when `PROGRESS_REPORT_DISABLED=1` is set — the user
 * can flip this once the 90-day window is up rather than carry calendar
 * logic in the worker.
 */
export async function ensureWeeklyProgressReportSchedule(): Promise<void> {
  if (process.env.PROGRESS_REPORT_DISABLED === '1') return;
  const pattern = process.env.PROGRESS_REPORT_CRON || '0 14 * * 0';
  try {
    await progressReportQueue.upsertJobScheduler(
      'progress-report-weekly',
      { pattern, tz: 'UTC' },
      { name: 'send', data: { reason: 'cron' } },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[queues] failed to register progress report cron', err);
  }
}

/**
 * Schedule the weekly universe-load refresh. Default Sunday 23:00 UTC —
 * runs before the daily 01:00 UTC universe-score sweep on Monday morning,
 * so the new rows are picked up immediately. Russell rebalances annually
 * in June, but a weekly cadence catches IPOs and significant cap shifts
 * without needing manual intervention.
 */
export async function ensureUniverseLoadSchedule(): Promise<void> {
  const pattern = process.env.UNIVERSE_LOAD_CRON || '0 23 * * 0';
  try {
    await universeLoadQueue.upsertJobScheduler(
      'universe-load-weekly',
      { pattern, tz: 'UTC' },
      { name: 'load', data: { reason: 'cron' } },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[queues] failed to register universe load cron', err);
  }
}

/**
 * Schedule the Morning Read digest sweep. Runs every 15 minutes; each tick the
 * worker checks which morning_digest rules are due in their local timezone.
 * 15-minute granularity is good enough for "send at 7am".
 */
export async function ensureMorningDigestSchedule(): Promise<void> {
  const pattern = process.env.MORNING_DIGEST_CRON || '*/15 * * * *';
  try {
    await morningDigestQueue.upsertJobScheduler(
      'morning-digest-sweep',
      { pattern, tz: 'UTC' },
      { name: 'sweep', data: { reason: 'cron' } },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[queues] failed to register morning digest cron', err);
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    harmonizeQueue.close(),
    classificationQueue.close(),
    systemPortfolioQueue.close(),
    metaOutcomeQueue.close(),
    calibrateWeightsQueue.close(),
    universeScoreQueue.close(),
    universeLoadQueue.close(),
    progressReportQueue.close(),
    morningDigestQueue.close(),
    narrativeTagQueue.close(),
  ]);
  await connection.quit().catch(() => undefined);
}
