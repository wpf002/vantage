import pino from 'pino';
import { and, eq, isNotNull } from 'drizzle-orm';
import { CLASSIFICATION_THRESHOLDS, type ClassificationThresholds } from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { getActiveClassificationThresholds } from '../db/classificationThresholds.js';

/**
 * Phase 8+ — classification threshold calibration (sibling of calibrateWeights).
 *
 * Tunes the two confidence floors the asset-class engine gates on, from realized
 * per-class hit rates. Confidence is meant to predict reliability, so:
 *   - If CORE (high-confidence) calls underperform their target hit rate, the
 *     CORE floor is too permissive → raise it (be stricter). If they beat the
 *     target comfortably, relax it slightly to widen coverage.
 *   - AVOID dumps low-confidence names. If AVOID calls underperform (names it
 *     avoided actually rose), the floor is dumping too aggressively → lower it.
 *
 * Structural rules (net bullish counts, NHS/NIS score gates) stay static — only
 * the confidence floors are calibrated, where the monotonic direction is sound.
 *
 * Guardrails: per-class min sample size, bounded floors, small bounded steps,
 * and no write unless a floor actually moved. All env-overridable.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.meta.calibrate-thresholds' });

const MIN_SAMPLES_PER_CLASS = Number(process.env.CLASSIFICATION_MIN_SAMPLES ?? 50);
const TARGET_HIT_RATE = Number(process.env.CLASSIFICATION_TARGET_HIT_RATE ?? 0.55);
const STEP = 0.02;
const BAND = 0.05;
const CORE_FLOOR_BOUNDS: [number, number] = [0.55, 0.9];
const AVOID_FLOOR_BOUNDS: [number, number] = [0.2, 0.45];
const METHOD = 'hitrate_v1';

export interface CalibrateThresholdsResult {
  scanned: number;
  byClass: Record<string, { n: number; hitRate: number }>;
  updated: boolean;
  reason?: string;
  thresholds?: ClassificationThresholds;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Nudge a floor toward stricter/looser based on whether its class hit target. */
function nudge(
  current: number,
  hitRate: number,
  n: number,
  bounds: [number, number],
  /** 'raise' = stricter floor when underperforming (CORE); 'lower' = AVOID. */
  mode: 'raise' | 'lower',
): number {
  if (n < MIN_SAMPLES_PER_CLASS) return current; // not enough evidence
  const under = hitRate < TARGET_HIT_RATE - BAND;
  const over = hitRate > TARGET_HIT_RATE + BAND;
  if (!under && !over) return current;
  // CORE: underperform → raise floor; overperform → lower (widen coverage).
  // AVOID: underperform → lower floor (dump fewer); overperform → raise.
  let next = current;
  if (mode === 'raise') next = under ? current + STEP : current - STEP;
  else next = under ? current - STEP : current + STEP;
  return clamp(round4(next), bounds[0], bounds[1]);
}

export async function calibrateThresholds(): Promise<CalibrateThresholdsResult> {
  const decisions = await db
    .select({ outcome: schema.platformDecisions.outcomePayload })
    .from(schema.platformDecisions)
    .where(
      and(
        eq(schema.platformDecisions.decisionType, 'classification'),
        isNotNull(schema.platformDecisions.outcomePayload),
      ),
    );

  const tally = new Map<string, { n: number; hits: number }>();
  for (const d of decisions) {
    const o = d.outcome as { assetClass?: string; correct?: boolean } | null;
    if (!o?.assetClass) continue;
    const t = tally.get(o.assetClass) ?? { n: 0, hits: 0 };
    t.n++;
    if (o.correct) t.hits++;
    tally.set(o.assetClass, t);
  }

  const byClass: Record<string, { n: number; hitRate: number }> = {};
  for (const [k, v] of tally) byClass[k] = { n: v.n, hitRate: v.n > 0 ? v.hits / v.n : 0 };

  const result: CalibrateThresholdsResult = { scanned: decisions.length, byClass, updated: false };

  const core = tally.get('CORE');
  const avoid = tally.get('AVOID');
  if ((core?.n ?? 0) < MIN_SAMPLES_PER_CLASS && (avoid?.n ?? 0) < MIN_SAMPLES_PER_CLASS) {
    result.reason = `insufficient per-class samples (CORE ${core?.n ?? 0}, AVOID ${avoid?.n ?? 0}; need ${MIN_SAMPLES_PER_CLASS})`;
    log.info(result, 'calibrate thresholds: skipped');
    return result;
  }

  const current = (await getActiveClassificationThresholds()) ?? CLASSIFICATION_THRESHOLDS;

  const next: ClassificationThresholds = {
    coreConfidenceFloor: nudge(
      current.coreConfidenceFloor,
      byClass.CORE?.hitRate ?? 0,
      core?.n ?? 0,
      CORE_FLOOR_BOUNDS,
      'raise',
    ),
    avoidConfidenceFloor: nudge(
      current.avoidConfidenceFloor,
      byClass.AVOID?.hitRate ?? 0,
      avoid?.n ?? 0,
      AVOID_FLOOR_BOUNDS,
      'lower',
    ),
  };

  if (
    next.coreConfidenceFloor === current.coreConfidenceFloor &&
    next.avoidConfidenceFloor === current.avoidConfidenceFloor
  ) {
    result.reason = 'within target band — no change';
    log.info(result, 'calibrate thresholds: no-op');
    return result;
  }

  await db.insert(schema.classificationThresholds).values({
    coreConfidenceFloor: next.coreConfidenceFloor,
    avoidConfidenceFloor: next.avoidConfidenceFloor,
    sampleSize: (core?.n ?? 0) + (avoid?.n ?? 0),
    method: METHOD,
    metadata: { byClass, previous: current, target: TARGET_HIT_RATE, step: STEP },
  });

  result.updated = true;
  result.thresholds = next;
  log.info(result, 'calibrate thresholds: updated');
  return result;
}
