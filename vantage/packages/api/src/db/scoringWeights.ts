import { desc } from 'drizzle-orm';
import type { PublicScoreWeights } from '@vantage/shared';
import { db as defaultDb, schema, type DB } from './client.js';

/**
 * The active learned Public Score weights — the most recent row written by the
 * nightly calibration loop. Returns null when no calibration has run yet, in
 * which case callers fall back to the static PUBLIC_SCORE_WEIGHTS cold-start
 * defaults (the scorer's default parameter handles this).
 */
export async function getActiveScoringWeights(
  db: DB = defaultDb,
): Promise<PublicScoreWeights | null> {
  const [row] = await db
    .select()
    .from(schema.scoringWeights)
    .orderBy(desc(schema.scoringWeights.asOf))
    .limit(1);
  if (!row) return null;
  return {
    expectationGap: row.egsWeight,
    narrativeIntegrityInverse: row.nisWeight,
    narrativeHeat: row.nhsWeight,
  };
}
