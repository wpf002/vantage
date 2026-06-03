import { desc } from 'drizzle-orm';
import type { ClassificationThresholds } from '@vantage/shared';
import { db as defaultDb, schema, type DB } from './client.js';

/**
 * The active learned classification confidence floors — the most recent row
 * written by the nightly threshold-calibration loop. Returns null when no
 * calibration has run yet (callers fall back to the CLASSIFICATION_THRESHOLDS
 * cold-start defaults via the classifier's default parameter).
 */
export async function getActiveClassificationThresholds(
  db: DB = defaultDb,
): Promise<ClassificationThresholds | null> {
  const [row] = await db
    .select()
    .from(schema.classificationThresholds)
    .orderBy(desc(schema.classificationThresholds.asOf))
    .limit(1);
  if (!row) return null;
  return {
    coreConfidenceFloor: row.coreConfidenceFloor,
    avoidConfidenceFloor: row.avoidConfidenceFloor,
  };
}
