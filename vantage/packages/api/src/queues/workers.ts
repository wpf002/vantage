import { Worker, type Job } from 'bullmq';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import pino from 'pino';
import { classify, classificationToSignal } from '@vantage/classification';
import { harmonize } from '@vantage/harmonizer';
import { ValidationError, type Signal } from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { persistClassification, persistSignal } from '../db/signalStore.js';
import {
  CLASSIFICATION_QUEUE_NAME,
  HARMONIZE_QUEUE_NAME,
  classificationQueue,
  connection,
  type ClassificationJob,
  type HarmonizeJob,
} from './index.js';

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

  workers = [harmonizeWorker, classificationWorker];
  log.info('workers started');
}

export async function stopWorkers(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  workers = [];
}
