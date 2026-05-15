import IORedis from 'ioredis';
import { Queue, type JobsOptions } from 'bullmq';

/**
 * BullMQ queue infrastructure for Phase 4.
 *
 * Two queues drive the harmonize → classify pipeline:
 *   - vantage.signals.harmonize  : every new Signal lands here for validation
 *   - vantage.classification.run : per-entity classification jobs
 *
 * A single IORedis connection is shared by the queues and the workers in
 * ./workers.ts. maxRetriesPerRequest: null is required by BullMQ for any
 * client used as a Worker connection.
 */

export const HARMONIZE_QUEUE_NAME = 'vantage.signals.harmonize';
export const CLASSIFICATION_QUEUE_NAME = 'vantage.classification.run';

export interface HarmonizeJob {
  signalId: string;
  entity: string;
  signalType: string;
}

export interface ClassificationJob {
  entity: string;
  triggeredBySignalId: string;
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

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([harmonizeQueue.close(), classificationQueue.close()]);
  await connection.quit().catch(() => undefined);
}
