import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { runLivePublicScore } from '@vantage/core-public/orchestrator';
import { schema, type DB } from '../../db/client.js';
import {
  fetchPriceSeries,
  horizonReturns,
  type DecisionRow,
  type OutcomeContext,
  type ResolvedOutcome,
} from './shared.js';

/**
 * Public-score outcome resolver.
 *
 * Pulls the realized price path since the score date (returns at 30/60/90/180
 * days where the data reaches that far) and re-runs the live score to see
 * whether the label has since changed. Records the original confidence and
 * direction alongside the spec fields so the calibration pipeline can score
 * the prediction without re-deriving them.
 */
export async function resolvePublicScore(
  db: DB,
  decision: DecisionRow,
  ctx: OutcomeContext,
): Promise<ResolvedOutcome> {
  if (!ctx.fmp || !ctx.fmpApiKey) return null; // can't resolve without FMP
  const ticker = decision.entity;
  const decisionDate = decision.createdAt;

  const series = await fetchPriceSeries(ctx.fmp, ticker, decisionDate);
  const hz = horizonReturns(series, decisionDate);
  if (hz.base === null) return null; // delisted / no price coverage

  // Original score: the persisted public_scores row at or before the decision,
  // falling back to the earliest available row for this ticker.
  const original = await loadOriginalScore(db, ticker, decisionDate);

  // Current label: re-run the live score. Best-effort — a ticker that has gone
  // unscoreable (no usable earnings) leaves currentLabel null.
  let currentLabel: string | null = null;
  let currentDirection: string | null = null;
  try {
    const live = await runLivePublicScore({ ticker, fmpApiKey: ctx.fmpApiKey });
    currentLabel = live.result.label;
    currentDirection = live.result.direction;
  } catch {
    currentLabel = null;
  }

  const originalLabel = original?.label ?? null;
  const labelChanged =
    currentLabel !== null && originalLabel !== null && currentLabel !== originalLabel;

  return {
    realizedReturn30d: hz.realizedReturn30d ?? null,
    realizedReturn60d: hz.realizedReturn60d ?? null,
    realizedReturn90d: hz.realizedReturn90d ?? null,
    realizedReturn180d: hz.realizedReturn180d ?? null,
    currentLabel,
    currentDirection,
    originalLabel,
    originalConfidence: original?.confidence ?? null,
    originalDirection: original?.direction ?? null,
    labelChanged,
    resolvedAt: new Date().toISOString(),
  };
}

async function loadOriginalScore(
  db: DB,
  ticker: string,
  at: Date,
): Promise<{ label: string; confidence: number; direction: string } | null> {
  const before = await db
    .select({
      label: schema.publicScores.label,
      confidence: schema.publicScores.confidence,
      direction: schema.publicScores.direction,
    })
    .from(schema.publicScores)
    .where(and(eq(schema.publicScores.ticker, ticker), lte(schema.publicScores.asOf, at)))
    .orderBy(desc(schema.publicScores.asOf))
    .limit(1);
  if (before.length > 0) return before[0]!;

  const earliest = await db
    .select({
      label: schema.publicScores.label,
      confidence: schema.publicScores.confidence,
      direction: schema.publicScores.direction,
    })
    .from(schema.publicScores)
    .where(eq(schema.publicScores.ticker, ticker))
    .orderBy(asc(schema.publicScores.asOf))
    .limit(1);
  return earliest[0] ?? null;
}
