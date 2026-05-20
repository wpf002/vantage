import type { AssetClass } from './classes.js';
import type { Sector, LifeStage } from './companies.js';

/**
 * Calibration analysis — Phase 8 meta-learning.
 *
 * PURE library. Every function takes a normalized `Decision[]` and returns
 * analysis. No DB access, no env reads, no HTTP, no clock. The worker and the
 * /v1/meta routes own all IO; they map raw `platform_decisions` rows (plus the
 * joins needed for sector / label / method confidence) into the `Decision`
 * shape below, then hand it here. This lets the analysis be exercised against
 * synthetic decision sets in a unit test with no infrastructure.
 *
 * Honesty note: for the first 6–12 months almost every segment here will sit
 * below MEANINGFUL_THRESHOLD. That is expected. The contract is built so that
 * when the decision log finally accumulates, the numbers are real rather than
 * retrofitted.
 */

/** Below this sample count, a hit rate / Brier score is statistical noise. */
export const MEANINGFUL_THRESHOLD = 50;

export type DecisionType =
  | 'public_score'
  | 'private_valuation'
  | 'classification'
  | 'portfolio_construction';

/**
 * Direction the public labels imply. Source of truth for the labels themselves
 * is `@vantage/core-public`'s `PublicLabelMeta`; it can't be imported here
 * because core-public depends on shared (not the reverse). Kept as a flat map
 * so the pure analysis stays self-contained. Keep in sync with that table.
 */
export const PUBLIC_LABEL_DIRECTION: Record<string, 'bullish' | 'bearish' | 'neutral'> = {
  aligned_strength: 'bullish',
  expected_weakness: 'bearish',
  validated_story: 'bullish',
  temporary_relief: 'bearish',
  cracks_forming: 'bearish',
  story_on_thin_ice: 'bearish',
  market_underreaction: 'bullish',
  narrative_breakdown: 'bearish',
};

/** Per-method confidence + blend weight at decision time (private side). */
export interface DecisionMethod {
  method: 'DCF' | 'Comps' | 'LBO';
  confidence: number;
  weight: number;
}

/**
 * Normalized, analysis-ready view of a decision. The route fills only the
 * fields relevant to the decision type; everything is optional so a sparse or
 * partially-resolved decision still type-checks.
 */
export interface DecisionPayload {
  assetClass?: AssetClass; // classification
  sector?: Sector; // joined from platform_companies
  lifeStage?: LifeStage; // joined from platform_companies
  label?: string; // public_score original label (PublicLabel value)
  direction?: 'bullish' | 'bearish' | 'neutral'; // public_score original score direction
  methods?: DecisionMethod[]; // private_valuation per-method confidence/weight
}

export interface DecisionOutcome {
  // public_score
  realizedReturn30d?: number;
  realizedReturn60d?: number;
  realizedReturn90d?: number;
  realizedReturn180d?: number;
  labelChanged?: boolean;
  // private_valuation
  originalBase?: number;
  currentBase?: number;
  deltaPct?: number;
  // classification
  realizedReturn?: number;
  classChanged?: boolean;
  // portfolio_construction
  benchmarkReturn?: number;
  alpha?: number;
}

export interface Decision {
  id: string;
  decisionType: DecisionType;
  confidence: number; // model's stated confidence at decision time, [0,1]
  createdAt: string; // ISO timestamp
  payload: DecisionPayload;
  outcome: DecisionOutcome | null; // null until the backfill worker resolves it
}

export interface HitRateResult {
  hitRate: number;
  sampleSize: number;
}

export interface BrierResult {
  brier: number;
  sampleSize: number;
}

export interface ReliabilityBin {
  confidenceBin: number; // bin midpoint, e.g. 0.05, 0.15, …
  expectedAccuracy: number; // === confidenceBin (perfect-calibration target)
  actualAccuracy: number; // observed hit rate within the bin
  sampleSize: number;
}

export interface ReliabilityCurve {
  bins: ReliabilityBin[];
}

export interface ReturnDistribution {
  mean: number;
  median: number;
  p25: number;
  p75: number;
  p05: number;
  p95: number;
  stdDev: number;
  sampleSize: number;
}

// ── Hit / return primitives ─────────────────────────────────────────────────

/**
 * Is this decision a "hit"? Returns null when the decision is unresolved or
 * the outcome direction is undecidable (e.g. neutral public score, TACTICAL
 * has no required direction so it cannot miss). Per-type definition:
 *
 *   public_score      90d return direction matches the score direction.
 *   private_valuation current base within ±25% of the original base.
 *   classification    90d return direction matches the class implication
 *                     (CORE / HIGH_ASYMMETRY → up, AVOID → down, TACTICAL → either).
 *   portfolio         realized return beat the benchmark (alpha > 0).
 */
export function decisionHit(d: Decision): boolean | null {
  if (!d.outcome) return null;
  switch (d.decisionType) {
    case 'public_score': {
      const r = d.outcome.realizedReturn90d;
      if (r === undefined || !Number.isFinite(r)) return null;
      const dir = d.payload.direction;
      if (dir === 'bullish') return r > 0;
      if (dir === 'bearish') return r < 0;
      return null; // neutral — no directional claim to verify
    }
    case 'private_valuation': {
      let delta = d.outcome.deltaPct;
      if (delta === undefined && d.outcome.originalBase && d.outcome.currentBase) {
        delta = (d.outcome.currentBase - d.outcome.originalBase) / d.outcome.originalBase;
      }
      if (delta === undefined || !Number.isFinite(delta)) return null;
      return Math.abs(delta) <= 0.25;
    }
    case 'classification': {
      const r = d.outcome.realizedReturn;
      if (r === undefined || !Number.isFinite(r)) return null;
      switch (d.payload.assetClass) {
        case 'CORE':
        case 'HIGH_ASYMMETRY':
          return r > 0;
        case 'AVOID':
          return r < 0;
        case 'TACTICAL':
          return true; // either direction is acceptable — resolved counts as a hit
        default:
          return null;
      }
    }
    case 'portfolio_construction': {
      const alpha = d.outcome.alpha;
      if (alpha === undefined || !Number.isFinite(alpha)) return null;
      return alpha > 0;
    }
    default:
      return null;
  }
}

/** The single realized return that best characterizes this decision, or null. */
export function decisionReturn(d: Decision): number | null {
  if (!d.outcome) return null;
  switch (d.decisionType) {
    case 'public_score':
      return finiteOrNull(d.outcome.realizedReturn90d);
    case 'private_valuation':
      return finiteOrNull(d.outcome.deltaPct);
    case 'classification':
      return finiteOrNull(d.outcome.realizedReturn);
    case 'portfolio_construction':
      return finiteOrNull(d.outcome.realizedReturn);
    default:
      return null;
  }
}

function finiteOrNull(v: number | undefined): number | null {
  return v !== undefined && Number.isFinite(v) ? v : null;
}

// ── Public functions ────────────────────────────────────────────────────────

export function computeHitRate(decisions: Decision[]): HitRateResult {
  let hits = 0;
  let n = 0;
  for (const d of decisions) {
    const h = decisionHit(d);
    if (h === null) continue;
    n += 1;
    if (h) hits += 1;
  }
  return { hitRate: n === 0 ? 0 : hits / n, sampleSize: n };
}

export function computeBrierScore(decisions: Decision[]): BrierResult {
  let sum = 0;
  let n = 0;
  for (const d of decisions) {
    const h = decisionHit(d);
    if (h === null || !Number.isFinite(d.confidence)) continue;
    const outcome = h ? 1 : 0;
    sum += (d.confidence - outcome) ** 2;
    n += 1;
  }
  return { brier: n === 0 ? 0 : sum / n, sampleSize: n };
}

export function computeReliabilityCurve(decisions: Decision[], bins = 10): ReliabilityCurve {
  const buckets: Array<{ hits: number; n: number }> = Array.from({ length: bins }, () => ({
    hits: 0,
    n: 0,
  }));

  for (const d of decisions) {
    const h = decisionHit(d);
    if (h === null || !Number.isFinite(d.confidence)) continue;
    const c = Math.max(0, Math.min(1, d.confidence));
    const idx = Math.min(bins - 1, Math.floor(c * bins));
    buckets[idx]!.n += 1;
    if (h) buckets[idx]!.hits += 1;
  }

  return {
    bins: buckets.map((b, i) => {
      const midpoint = (i + 0.5) / bins;
      return {
        confidenceBin: midpoint,
        expectedAccuracy: midpoint,
        actualAccuracy: b.n === 0 ? 0 : b.hits / b.n,
        sampleSize: b.n,
      };
    }),
  };
}

export function computeReturnDistribution(decisions: Decision[]): ReturnDistribution {
  const returns: number[] = [];
  for (const d of decisions) {
    const r = decisionReturn(d);
    if (r !== null) returns.push(r);
  }
  returns.sort((a, b) => a - b);
  const n = returns.length;
  if (n === 0) {
    return { mean: 0, median: 0, p25: 0, p75: 0, p05: 0, p95: 0, stdDev: 0, sampleSize: 0 };
  }
  const mean = returns.reduce((acc, v) => acc + v, 0) / n;
  const variance = returns.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  return {
    mean,
    median: percentile(returns, 0.5),
    p25: percentile(returns, 0.25),
    p75: percentile(returns, 0.75),
    p05: percentile(returns, 0.05),
    p95: percentile(returns, 0.95),
    stdDev: Math.sqrt(variance),
    sampleSize: n,
  };
}

/** Linear-interpolated percentile over a pre-sorted ascending array. */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/**
 * Group decisions by a composite key built from the named grouping functions.
 * A decision is dropped from the result if any grouping fn returns
 * null/undefined for it (e.g. a classification with no sector joined yet).
 * Composite keys read like "CORE × technology".
 */
export function bucketBy(
  decisions: Decision[],
  groupingFns: Record<string, (d: Decision) => string | null | undefined>,
): Record<string, Decision[]> {
  const out: Record<string, Decision[]> = {};
  const keys = Object.keys(groupingFns);
  for (const d of decisions) {
    const parts: string[] = [];
    let skip = false;
    for (const k of keys) {
      const v = groupingFns[k]!(d);
      if (v === null || v === undefined || v === '') {
        skip = true;
        break;
      }
      parts.push(v);
    }
    if (skip) continue;
    const key = parts.join(' × ');
    (out[key] ??= []).push(d);
  }
  return out;
}

/** Mean stated confidence over the decisions whose hit is determinable. */
export function meanConfidence(decisions: Decision[]): number {
  let sum = 0;
  let n = 0;
  for (const d of decisions) {
    if (decisionHit(d) === null || !Number.isFinite(d.confidence)) continue;
    sum += d.confidence;
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

/** Pearson correlation between two equal-length series. Returns 0 if degenerate. */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}
