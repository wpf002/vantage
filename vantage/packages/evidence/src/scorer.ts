/**
 * Evidence quality scorer.
 *
 * Given a source context (which source produced this signal, how old is the
 * data, how many outlets reported it), computes a five-component quality score
 * and a single composite. Pure function — no I/O, no DB calls.
 *
 * All five components are in [0, 1]. The composite is a weighted sum.
 */

import type { EvidenceQuality, EvidenceWeights, SourceContext } from './types.js';
import {
  INITIAL_CREDIBILITY,
  METHODOLOGICAL_STRENGTH,
  RECENCY_HALFLIFE_DAYS,
  DEFAULT_HISTORICAL_RELIABILITY,
  lookup,
} from './config.js';

const RECENCY_FLOOR = 0.05; // very old data still carries minimal residual value

/**
 * Compute recency score for a signal whose underlying data was published on
 * `dataDate`, evaluated as of `asOf`.
 *
 * Score = max(RECENCY_FLOOR, 1 - daysOld / halflife)
 * where halflife is source-type-specific (see config.ts).
 */
export function computeRecencyScore(
  sourceKey: string,
  dataDate: string,
  asOf: Date = new Date(),
): number {
  const dataMs = Date.parse(dataDate);
  if (isNaN(dataMs)) return RECENCY_FLOOR;
  // Floor to whole days: data published today is fully fresh regardless of
  // the time of day it's evaluated. A full recency point is only lost once
  // a complete calendar day has elapsed.
  const daysOld = Math.max(0, Math.floor((asOf.getTime() - dataMs) / (24 * 60 * 60 * 1000)));
  const halflife = lookup(RECENCY_HALFLIFE_DAYS, sourceKey);
  return Math.max(RECENCY_FLOOR, Math.min(1, 1 - daysOld / halflife));
}

/**
 * Compute independence score.
 *
 * - Primary source (isDerived=false, outletCount=1): 0.85 (wire with single outlet)
 * - Original SEC / market data (outletCount=1, not news): 1.0
 * - N outlets within 24h: 1 / sqrt(N), clamped to [0.15, 1]
 * - Derived from another signal: 0.70
 *
 * "Primary" is defined as market_data, sec:* sources — direct observations.
 */
export function computeIndependenceScore(ctx: SourceContext): number {
  if (ctx.isDerived) return 0.70;

  const isPrimary = ctx.sourceKey.startsWith('fmp:market_data') ||
    ctx.sourceKey.startsWith('sec:');

  if (ctx.outletCount <= 1) {
    return isPrimary ? 1.0 : 0.85;
  }

  // N outlets reporting the same story
  const nDuplication = 1 / Math.sqrt(ctx.outletCount);
  return Math.max(0.15, Math.min(1, nDuplication));
}

/**
 * Compute all five quality components and return the full EvidenceQuality object.
 */
export function computeEvidenceQuality(
  ctx: SourceContext,
  weights: EvidenceWeights,
  asOf: Date = new Date(),
): EvidenceQuality {
  const sourceCredibility = ctx.storedCredibility ?? lookup(INITIAL_CREDIBILITY, ctx.sourceKey);
  const recencyScore = computeRecencyScore(ctx.sourceKey, ctx.dataDate, asOf);
  const independenceScore = computeIndependenceScore(ctx);
  const methodologicalStrength = lookup(METHODOLOGICAL_STRENGTH, ctx.sourceKey);
  const historicalReliability = ctx.empiricalHitRate ?? DEFAULT_HISTORICAL_RELIABILITY;

  const compositeScore =
    weights.source_credibility * sourceCredibility +
    weights.recency * recencyScore +
    weights.independence * independenceScore +
    weights.methodological_strength * methodologicalStrength +
    weights.historical_reliability * historicalReliability;

  return {
    sourceKey: ctx.sourceKey,
    sourceCredibility,
    recencyScore,
    independenceScore,
    methodologicalStrength,
    historicalReliability,
    compositeScore: Math.max(0, Math.min(1, compositeScore)),
    weights,
  };
}

/**
 * Aggregate quality across a set of signals in a layer.
 *
 * Returns the weighted-average composite, where each signal is weighted by
 * its magnitude (how much it contributed to the layer). Falls back to simple
 * average when magnitudes are all zero or unavailable.
 */
export function aggregateLayerQuality(
  qualities: Array<{ compositeScore: number; weight?: number }>,
): number {
  if (qualities.length === 0) return DEFAULT_HISTORICAL_RELIABILITY;
  const totalWeight = qualities.reduce((s, q) => s + (q.weight ?? 1), 0);
  if (totalWeight === 0) {
    return qualities.reduce((s, q) => s + q.compositeScore, 0) / qualities.length;
  }
  return qualities.reduce((s, q) => s + q.compositeScore * (q.weight ?? 1), 0) / totalWeight;
}
