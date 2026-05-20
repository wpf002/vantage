import { desc, eq } from 'drizzle-orm';
import { schema, type DB } from '../../db/client.js';
import {
  realizedReturnForEntity,
  type DecisionRow,
  type OutcomeContext,
  type ResolvedOutcome,
} from './shared.js';

/**
 * Portfolio-construction outcome resolver.
 *
 * Sums the weight-blended realized return of every holding over the window
 * since the decision, then compares against The Default (the latest system
 * portfolio) over the same window. Holdings whose return can't be sourced are
 * dropped and the remaining weights renormalized, so a few delisted names
 * don't sink the whole portfolio's outcome.
 */
export async function resolvePortfolio(
  db: DB,
  decision: DecisionRow,
  ctx: OutcomeContext,
): Promise<ResolvedOutcome> {
  const payload = (decision.decisionPayload ?? {}) as { portfolioId?: string };
  if (!payload.portfolioId) return null;

  const realizedReturn = await portfolioWeightedReturn(
    db,
    payload.portfolioId,
    decision.createdAt,
    ctx,
  );
  if (realizedReturn === null) return null; // no holdings resolvable yet

  const benchmarkReturn = await defaultPortfolioReturn(db, decision.createdAt, ctx);
  const alpha = benchmarkReturn === null ? null : realizedReturn - benchmarkReturn;

  return {
    realizedReturn,
    benchmarkReturn,
    alpha,
    resolvedAt: new Date().toISOString(),
  };
}

/** Weight-blended realized return of a portfolio's holdings since `from`. */
async function portfolioWeightedReturn(
  db: DB,
  portfolioId: string,
  from: Date,
  ctx: OutcomeContext,
): Promise<number | null> {
  const holdings = await db
    .select({
      entity: schema.platformAllocations.entity,
      weight: schema.platformAllocations.weight,
    })
    .from(schema.platformAllocations)
    .where(eq(schema.platformAllocations.portfolioId, portfolioId));
  if (holdings.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const h of holdings) {
    const r = await realizedReturnForEntity(db, h.entity, from, ctx.fmp);
    if (r === null) continue;
    weightedSum += h.weight * r;
    totalWeight += h.weight;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight; // renormalized over resolvable holdings
}

/** The latest system portfolio ("The Default") realized return over the window. */
async function defaultPortfolioReturn(
  db: DB,
  from: Date,
  ctx: OutcomeContext,
): Promise<number | null> {
  const rows = await db
    .select({ id: schema.platformPortfolios.id })
    .from(schema.platformPortfolios)
    .where(eq(schema.platformPortfolios.kind, 'system'))
    .orderBy(desc(schema.platformPortfolios.asOf))
    .limit(1);
  if (rows.length === 0) return null;
  return portfolioWeightedReturn(db, rows[0]!.id, from, ctx);
}
