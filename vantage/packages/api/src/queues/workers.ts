import { Worker, type Job } from 'bullmq';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import pino from 'pino';
import { classify, classificationToSignal } from '@vantage/classification';
import { harmonize } from '@vantage/harmonizer';
import { ValidationError, type Signal } from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { persistClassification, persistSignal } from '../db/signalStore.js';
import {
  CALIBRATE_WEIGHTS_QUEUE_NAME,
  CLASSIFICATION_QUEUE_NAME,
  HARMONIZE_QUEUE_NAME,
  META_OUTCOME_QUEUE_NAME,
  MORNING_DIGEST_QUEUE_NAME,
  NARRATIVE_TAG_QUEUE_NAME,
  PROGRESS_REPORT_QUEUE_NAME,
  SYSTEM_PORTFOLIO_QUEUE_NAME,
  UNIVERSE_LOAD_QUEUE_NAME,
  UNIVERSE_SCORE_QUEUE_NAME,
  classificationQueue,
  connection,
  ensureCalibrateWeightsSchedule,
  ensureMetaOutcomeSchedule,
  ensureMorningDigestSchedule,
  ensureSystemPortfolioSchedule,
  ensureUniverseLoadSchedule,
  ensureUniverseScoreSchedule,
  ensureWeeklyProgressReportSchedule,
  type CalibrateWeightsJob,
  type ClassificationJob,
  type HarmonizeJob,
  type MetaOutcomeJob,
  type MorningDigestJob,
  type NarrativeTagJob,
  type SystemPortfolioJob,
  type UniverseLoadJob,
  type UniverseScoreJob,
  type WeeklyProgressReportJob,
} from './index.js';
import { rebuildSystemPortfolio } from '../jobs/systemPortfolio.js';
import { captureOutcomes } from '../jobs/outcomeCapture.js';
import { calibrateWeights } from '../jobs/calibrateWeights.js';
import { scoreUniverse } from '../jobs/universeScore.js';
import { loadUniverse } from '../jobs/loadUniverse.js';
import { sendWeeklyProgressReport } from '../jobs/weeklyProgressReport.js';
import { HARMONIZED_SIGNAL_CHANNEL, startAlertEvaluator, stopAlertEvaluator } from '../workers/alerts.js';
import { runMorningDigest } from '../jobs/morningDigest.js';
import { ensureAdminMorningDigestRule } from '../jobs/ensureAdminDigestRule.js';
import { tagNarrativeForTicker } from '../jobs/narrativeTag.js';

/**
 * Phase 4 workers. They run in the same Node process as the Fastify API for
 * now — Phase 8 will fork them out. Two consumers:
 *
 *   harmonizeWorker   → re-validates every persisted Signal, then enqueues a
 *                       classification job for that entity. Drops if the
 *                       Signal is itself `platform.classification` to break
 *                       the otherwise infinite feedback loop.
 *
 *   classificationWorker → pulls the trailing-90-day signal window for the
 *                          entity, runs classify(), persists the result, and
 *                          emits a `platform.classification` Signal back into
 *                          the platform — which the harmonize worker will
 *                          then see and ignore (loop break).
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.workers' });

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const CLASSIFICATION_SIGNAL_TYPE = 'platform.classification';

let workers: Worker[] = [];

/**
 * Hydrate a Signal-shaped object from a platform_signals row + its lineage.
 * Drizzle rows give us no transformChain (it lives in platform_audit), so we
 * stitch it back together for harmonize() and classify() to consume.
 */
async function loadSignalById(signalId: string): Promise<Signal | null> {
  const rows = await db
    .select()
    .from(schema.platformSignals)
    .where(eq(schema.platformSignals.id, signalId))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0]!;

  const lineage = await db
    .select()
    .from(schema.platformAudit)
    .where(eq(schema.platformAudit.signalId, signalId))
    .orderBy(asc(schema.platformAudit.step));

  return {
    entity: row.entity,
    timestamp: row.timestamp.toISOString(),
    signalType: row.signalType as Signal['signalType'],
    direction: row.direction,
    magnitude: row.magnitude,
    confidence: row.confidence,
    sourceVersion: row.sourceVersion,
    rationale: row.rationale,
    metadata: (row.metadata ?? undefined) as Signal['metadata'],
    transformChain: lineage.map((step) => ({
      op: step.op,
      inputs: step.inputs as Record<string, unknown>,
      output: step.output as unknown,
      weight: step.weight ?? undefined,
      ts: step.timestamp.toISOString(),
    })),
  };
}

/**
 * Pull every Signal for an entity inside the recency window. Same hydration
 * pattern as loadSignalById, batched.
 */
async function loadEntitySignals(entity: string): Promise<Signal[]> {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
  // Exclude `platform.*` signals: they are the *output* of upstream platform
  // engines (classification, allocation, simulation). Counting them as input
  // votes lets the classifier's own emission feed back into the next run.
  const rows = await db
    .select()
    .from(schema.platformSignals)
    .where(
      and(
        eq(schema.platformSignals.entity, entity),
        gte(schema.platformSignals.timestamp, cutoff),
        sql`${schema.platformSignals.signalType} NOT LIKE 'platform.%'`,
      ),
    )
    .orderBy(desc(schema.platformSignals.timestamp));

  if (rows.length === 0) return [];

  const signals: Signal[] = [];
  for (const row of rows) {
    const stepRows = await db
      .select()
      .from(schema.platformAudit)
      .where(eq(schema.platformAudit.signalId, row.id))
      .orderBy(asc(schema.platformAudit.step));
    signals.push({
      entity: row.entity,
      timestamp: row.timestamp.toISOString(),
      signalType: row.signalType as Signal['signalType'],
      direction: row.direction,
      magnitude: row.magnitude,
      confidence: row.confidence,
      sourceVersion: row.sourceVersion,
      rationale: row.rationale,
      metadata: (row.metadata ?? undefined) as Signal['metadata'],
      transformChain: stepRows.map((step) => ({
        op: step.op,
        inputs: step.inputs as Record<string, unknown>,
        output: step.output as unknown,
        weight: step.weight ?? undefined,
        ts: step.timestamp.toISOString(),
      })),
    });
  }
  return signals;
}

async function handleHarmonize(job: Job<HarmonizeJob>): Promise<void> {
  const { signalId, entity, signalType } = job.data;
  log.info({ jobId: job.id, signalId, entity, signalType }, 'harmonize: start');

  const signal = await loadSignalById(signalId);
  if (!signal) {
    log.warn({ signalId }, 'harmonize: signal missing — dropping');
    return;
  }

  try {
    harmonize(signal);
  } catch (err) {
    if (err instanceof ValidationError) {
      log.error(
        { signalId, entity, signalType, issue: err.message },
        'harmonize: rejected — not propagating',
      );
      return;
    }
    throw err;
  }

  // Phase 10 — publish to the pub/sub channel the alert evaluator subscribes
  // to. Best-effort: a Redis publish failure must not block classification.
  try {
    await connection.publish(
      HARMONIZED_SIGNAL_CHANNEL,
      JSON.stringify({
        signalId,
        entity,
        signalType,
        direction: signal.direction,
        magnitude: signal.magnitude,
        timestamp: signal.timestamp,
      }),
    );
  } catch (err) {
    log.warn({ signalId, err: (err as Error).message }, 'harmonize: pub/sub publish failed');
  }

  // Loop-prevention: a `platform.classification` Signal is itself the OUTPUT
  // of the classifier. Re-enqueuing classification on it would re-classify
  // forever. Drop here so the queue settles.
  if (signalType === CLASSIFICATION_SIGNAL_TYPE) {
    log.info({ signalId, entity }, 'harmonize: classification signal — not enqueuing downstream');
    return;
  }

  await classificationQueue.add('classify', { entity, triggeredBySignalId: signalId });
  log.info({ signalId, entity }, 'harmonize: enqueued classification');
}

async function handleClassification(job: Job<ClassificationJob>): Promise<void> {
  const { entity, triggeredBySignalId } = job.data;
  log.info({ jobId: job.id, entity, triggeredBySignalId }, 'classify: start');

  const signals = await loadEntitySignals(entity);
  if (signals.length === 0) {
    log.warn({ entity }, 'classify: no signals in window — skipping');
    return;
  }

  const result = classify({ entity, signals });
  const { classificationId } = await persistClassification(db, result, triggeredBySignalId);
  log.info(
    {
      entity,
      classification: result.classification,
      confidence: result.confidence.toFixed(2),
      classificationId,
    },
    'classify: persisted',
  );

  // Emit the platform.classification Signal back into the loop. persistSignal
  // will re-enqueue it on the harmonize queue; harmonizeWorker sees the
  // signalType and drops it, breaking the cycle.
  const emitted = harmonize(classificationToSignal(result));
  await persistSignal(db, emitted);
}

async function handleSystemPortfolio(job: Job<SystemPortfolioJob>): Promise<void> {
  log.info({ jobId: job.id, reason: job.data.reason }, 'system portfolio: start');
  await rebuildSystemPortfolio(db);
}

async function handleMetaOutcome(job: Job<MetaOutcomeJob>): Promise<void> {
  log.info({ jobId: job.id, reason: job.data.reason }, 'meta outcome: start');
  const res = await captureOutcomes({ horizonDays: job.data.horizonDays });
  log.info(res, 'meta outcome: done');
}

async function handleCalibrateWeights(job: Job<CalibrateWeightsJob>): Promise<void> {
  log.info({ jobId: job.id, reason: job.data.reason }, 'calibrate weights: start');
  const res = await calibrateWeights();
  log.info(res, 'calibrate weights: done');
}

async function handleUniverseScore(job: Job<UniverseScoreJob>): Promise<void> {
  log.info({ jobId: job.id, reason: job.data.reason }, 'universe score: start');
  const res = await scoreUniverse({ limit: job.data.limit });
  log.info(res, 'universe score: done');
}

async function handleUniverseLoad(job: Job<UniverseLoadJob>): Promise<void> {
  log.info({ jobId: job.id, reason: job.data.reason }, 'universe load: start');
  const res = await loadUniverse({
    minMarketCapUsd: job.data.minMarketCapUsd,
    limit: job.data.limit,
  });
  log.info(res, 'universe load: done');
}

async function handleWeeklyProgressReport(
  job: Job<WeeklyProgressReportJob>,
): Promise<void> {
  log.info({ jobId: job.id, reason: job.data.reason }, 'progress report: start');
  const res = await sendWeeklyProgressReport({ to: job.data.to });
  log.info({ to: res.to, dispatched: res.dispatched }, 'progress report: done');
}

async function handleMorningDigest(job: Job<MorningDigestJob>): Promise<void> {
  log.info({ jobId: job.id, reason: job.data.reason }, 'morning digest: start');
  const res = await runMorningDigest();
  log.info(res, 'morning digest: done');
}

async function handleNarrativeTag(job: Job<NarrativeTagJob>): Promise<void> {
  log.info({ jobId: job.id, ticker: job.data.ticker }, 'narrative tag: start');
  const res = await tagNarrativeForTicker(job.data.ticker);
  log.info(res, 'narrative tag: done');
}

export function startWorkers(): void {
  if (workers.length > 0) return; // idempotent — guard against double-start

  const harmonizeWorker = new Worker<HarmonizeJob>(HARMONIZE_QUEUE_NAME, handleHarmonize, {
    connection,
    concurrency: 5,
  });
  harmonizeWorker.on('failed', (job, err) => {
    log.error(
      { jobId: job?.id, signalId: job?.data.signalId, err: err.message },
      'harmonize: failed',
    );
  });
  harmonizeWorker.on('ready', () => log.info('harmonize worker ready'));

  const classificationWorker = new Worker<ClassificationJob>(
    CLASSIFICATION_QUEUE_NAME,
    handleClassification,
    { connection, concurrency: 5 },
  );
  classificationWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, entity: job?.data.entity, err: err.message }, 'classify: failed');
  });
  classificationWorker.on('ready', () => log.info('classification worker ready'));

  const systemPortfolioWorker = new Worker<SystemPortfolioJob>(
    SYSTEM_PORTFOLIO_QUEUE_NAME,
    handleSystemPortfolio,
    { connection, concurrency: 1 },
  );
  systemPortfolioWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'system portfolio: failed');
  });
  systemPortfolioWorker.on('ready', () => log.info('system portfolio worker ready'));

  const metaOutcomeWorker = new Worker<MetaOutcomeJob>(META_OUTCOME_QUEUE_NAME, handleMetaOutcome, {
    connection,
    concurrency: 1,
  });
  metaOutcomeWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'meta outcome: failed');
  });
  metaOutcomeWorker.on('ready', () => log.info('meta outcome worker ready'));

  const calibrateWeightsWorker = new Worker<CalibrateWeightsJob>(
    CALIBRATE_WEIGHTS_QUEUE_NAME,
    handleCalibrateWeights,
    { connection, concurrency: 1 },
  );
  calibrateWeightsWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'calibrate weights: failed');
  });
  calibrateWeightsWorker.on('ready', () => log.info('calibrate weights worker ready'));

  const universeScoreWorker = new Worker<UniverseScoreJob>(
    UNIVERSE_SCORE_QUEUE_NAME,
    handleUniverseScore,
    { connection, concurrency: 1 },
  );
  universeScoreWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'universe score: failed');
  });
  universeScoreWorker.on('ready', () => log.info('universe score worker ready'));

  const universeLoadWorker = new Worker<UniverseLoadJob>(
    UNIVERSE_LOAD_QUEUE_NAME,
    handleUniverseLoad,
    { connection, concurrency: 1 },
  );
  universeLoadWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'universe load: failed');
  });
  universeLoadWorker.on('ready', () => log.info('universe load worker ready'));

  const progressReportWorker = new Worker<WeeklyProgressReportJob>(
    PROGRESS_REPORT_QUEUE_NAME,
    handleWeeklyProgressReport,
    { connection, concurrency: 1 },
  );
  progressReportWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'progress report: failed');
  });
  progressReportWorker.on('ready', () => log.info('progress report worker ready'));

  const morningDigestWorker = new Worker<MorningDigestJob>(
    MORNING_DIGEST_QUEUE_NAME,
    handleMorningDigest,
    { connection, concurrency: 1 },
  );
  morningDigestWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, 'morning digest: failed');
  });
  morningDigestWorker.on('ready', () => log.info('morning digest worker ready'));

  // Cap narrative tagging at 3 concurrent jobs to stay under Anthropic rate
  // limits (Phase 10 cost-control).
  const narrativeTagWorker = new Worker<NarrativeTagJob>(
    NARRATIVE_TAG_QUEUE_NAME,
    handleNarrativeTag,
    { connection, concurrency: 3 },
  );
  narrativeTagWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, ticker: job?.data.ticker, err: err.message }, 'narrative tag: failed');
  });
  narrativeTagWorker.on('ready', () => log.info('narrative tag worker ready'));

  workers = [
    harmonizeWorker,
    classificationWorker,
    systemPortfolioWorker,
    metaOutcomeWorker,
    calibrateWeightsWorker,
    universeScoreWorker,
    universeLoadWorker,
    progressReportWorker,
    morningDigestWorker,
    narrativeTagWorker,
  ];

  // Phase 10 — reactive alert evaluator subscribes to the harmonized-signal
  // pub/sub channel (separate from the BullMQ workers above).
  startAlertEvaluator();

  // Register the repeatable schedules — fire-and-forget; failures are logged
  // inside the ensure* helpers.
  void ensureSystemPortfolioSchedule();
  void ensureMetaOutcomeSchedule();
  void ensureCalibrateWeightsSchedule();
  void ensureUniverseScoreSchedule();
  void ensureUniverseLoadSchedule();
  void ensureWeeklyProgressReportSchedule();
  void ensureMorningDigestSchedule();
  void ensureAdminMorningDigestRule();

  log.info('workers started');
}

export async function stopWorkers(): Promise<void> {
  await stopAlertEvaluator();
  await Promise.allSettled(workers.map((w) => w.close()));
  workers = [];
}
