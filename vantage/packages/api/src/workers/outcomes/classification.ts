import { desc, eq } from 'drizzle-orm';
import { schema, type DB } from '../../db/client.js';
import {
  realizedReturnForEntity,
  type DecisionRow,
  type OutcomeContext,
  type ResolvedOutcome,
} from './shared.js';

/**
 * Classification outcome resolver.
 *
 * Compares the original asset class against the most recent classification for
 * the entity and computes the realized return over the holding window (price
 * change for public names, valuation change for private). Returns null when no
 * return can be derived (delisted ticker, never-revalued private name).
 */
export async function resolveClassification(
  db: DB,
  decision: DecisionRow,
  ctx: OutcomeContext,
): Promise<ResolvedOutcome> {
  const payload = (decision.decisionPayload ?? {}) as {
    result?: { classification?: string };
  };
  const originalClass = payload.result?.classification ?? null;

  const realizedReturn = await realizedReturnForEntity(
    db,
    decision.entity,
    decision.createdAt,
    ctx.fmp,
  );
  if (realizedReturn === null) return null; // no return signal — try again next run

  const latest = await db
    .select({ assetClass: schema.platformClassifications.assetClass })
    .from(schema.platformClassifications)
    .where(eq(schema.platformClassifications.entity, decision.entity))
    .orderBy(desc(schema.platformClassifications.asOf))
    .limit(1);
  const currentClass = latest[0]?.assetClass ?? null;

  return {
    realizedReturn,
    originalClass,
    currentClass,
    classChanged: originalClass !== null && currentClass !== null && originalClass !== currentClass,
    resolvedAt: new Date().toISOString(),
  };
}
