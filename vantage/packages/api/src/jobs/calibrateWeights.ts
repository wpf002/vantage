import pino from 'pino';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { PUBLIC_SCORE_WEIGHTS, type PublicScoreWeights } from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { getActiveScoringWeights } from '../db/scoringWeights.js';

/**
 * Phase 8+ — the LEARNING step (closes the loop the outcome-capture job opens).
 *
 * outcomeCapture grades each Public Score decision against its realized forward
 * return but never changes anything. This job reads those graded outcomes and
 * RE-WEIGHTS the three score components (EGS, inverted-NIS, NHS) by how well
 * each actually predicted returns, then writes the new weights to
 * `scoring_weights`. The next scoring run reads them via getActiveScoringWeights
 * — so tomorrow's scores genuinely reflect what worked.
 *
 * Each component is meant to be a "price ahead of fundamentals" (bearish)
 * signal: a higher component value should predict a LOWER forward return. So a
 * component's usefulness = max(0, -corr(component, forwardReturn)). Weights are
 * set proportional to usefulness.
 *
 * Guardrails (this tunes real financial scoring, so it must not lurch on noise):
 *   - MIN_SAMPLES: do nothing until enough graded outcomes exist.
 *   - Smoothing: move only LEARNING_RATE of the way toward the target each run.
 *   - Clamp each weight to [WEIGHT_MIN, WEIGHT_MAX], then renormalize to sum 1.
 *   - If no component shows usable signal, leave weights unchanged.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.meta.calibrate' });

const MIN_SAMPLES = Number(process.env.CALIBRATION_MIN_SAMPLES ?? 150);
const LEARNING_RATE = Number(process.env.CALIBRATION_LEARNING_RATE ?? 0.25);
const WEIGHT_MIN = 0.1;
const WEIGHT_MAX = 0.6;
const METHOD = 'correlation_v1';

export interface CalibrateResult {
  scanned: number; // graded public_score decisions examined
  used: number; // samples with both components and a forward return
  updated: boolean;
  reason?: string;
  sampleSize?: number;
  weights?: PublicScoreWeights;
  correlations?: { egs: number; invNis: number; nhs: number };
}

interface Triple {
  egs: number;
  invNis: number;
  nhs: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Pearson correlation; 0 when undefined (n<2 or zero variance). */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const cov = n * sxy - sx * sy;
  const dx = Math.sqrt(n * sxx - sx * sx);
  const dy = Math.sqrt(n * syy - sy * sy);
  if (dx === 0 || dy === 0) return 0;
  return cov / (dx * dy);
}

/** Clamp each weight into the allowed band, then renormalize to sum 1. */
function normalizeClamped(w: Triple): Triple {
  const e = clamp(w.egs, WEIGHT_MIN, WEIGHT_MAX);
  const n = clamp(w.invNis, WEIGHT_MIN, WEIGHT_MAX);
  const h = clamp(w.nhs, WEIGHT_MIN, WEIGHT_MAX);
  const s = e + n + h;
  return { egs: e / s, invNis: n / s, nhs: h / s };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export async function calibrateWeights(): Promise<CalibrateResult> {
  // 1. Pull graded Public Score decisions (outcome written, forward return known).
  const decisions = await db
    .select({
      entity: schema.platformDecisions.entity,
      createdAt: schema.platformDecisions.createdAt,
      outcome: schema.platformDecisions.outcomePayload,
    })
    .from(schema.platformDecisions)
    .where(
      and(
        eq(schema.platformDecisions.decisionType, 'public_score'),
        isNotNull(schema.platformDecisions.outcomePayload),
      ),
    );

  const result: CalibrateResult = { scanned: decisions.length, used: 0, updated: false };
  if (decisions.length === 0) {
    result.reason = 'no graded public_score outcomes yet';
    log.info(result, 'calibrate: skipped');
    return result;
  }

  // 2. Load component subscores for the involved tickers and match each decision
  //    to its nearest score by as_of (same approach as outcomeCapture).
  const tickers = [...new Set(decisions.map((d) => d.entity))];
  const scoreRows = await db
    .select({
      ticker: schema.publicScores.ticker,
      asOf: schema.publicScores.asOf,
      components: schema.publicScores.components,
    })
    .from(schema.publicScores)
    .where(inArray(schema.publicScores.ticker, tickers));

  const byTicker = new Map<string, Array<{ asOf: number; comp: unknown }>>();
  for (const r of scoreRows) {
    const list = byTicker.get(r.ticker) ?? [];
    list.push({ asOf: r.asOf.getTime(), comp: r.components });
    byTicker.set(r.ticker, list);
  }

  const egsArr: number[] = [];
  const invNisArr: number[] = [];
  const nhsArr: number[] = [];
  const retArr: number[] = [];

  for (const d of decisions) {
    const outcome = d.outcome as { forwardReturn?: number } | null;
    const ret = outcome?.forwardReturn;
    if (typeof ret !== 'number' || !Number.isFinite(ret)) continue;

    const scores = byTicker.get(d.entity);
    if (!scores || scores.length === 0) continue;
    const target = d.createdAt.getTime();
    const nearest = scores.reduce((best, s) =>
      Math.abs(s.asOf - target) < Math.abs(best.asOf - target) ? s : best,
    );
    const comp = nearest.comp as {
      egs?: { score?: number };
      nis?: { score?: number };
      nhs?: { score?: number };
    } | null;
    const egs = comp?.egs?.score;
    const nis = comp?.nis?.score;
    const nhs = comp?.nhs?.score;
    if (
      typeof egs !== 'number' ||
      typeof nis !== 'number' ||
      typeof nhs !== 'number'
    ) {
      continue;
    }

    egsArr.push(egs);
    invNisArr.push(100 - nis); // the score uses (100 - NIS)
    nhsArr.push(nhs);
    retArr.push(ret);
  }

  result.used = retArr.length;
  if (retArr.length < MIN_SAMPLES) {
    result.reason = `insufficient samples (${retArr.length} < ${MIN_SAMPLES})`;
    log.info(result, 'calibrate: skipped');
    return result;
  }

  // 3. Per-component usefulness = how strongly it predicts LOWER returns.
  const corr = {
    egs: pearson(egsArr, retArr),
    invNis: pearson(invNisArr, retArr),
    nhs: pearson(nhsArr, retArr),
  };
  result.correlations = corr;
  const strength = {
    egs: Math.max(0, -corr.egs),
    invNis: Math.max(0, -corr.invNis),
    nhs: Math.max(0, -corr.nhs),
  };
  const totalStrength = strength.egs + strength.invNis + strength.nhs;
  if (totalStrength === 0) {
    result.reason = 'no component shows predictive signal in the intended direction';
    log.info(result, 'calibrate: skipped');
    return result;
  }

  const target: Triple = {
    egs: strength.egs / totalStrength,
    invNis: strength.invNis / totalStrength,
    nhs: strength.nhs / totalStrength,
  };

  // 4. Smooth from current → target, then clamp + renormalize (guardrails).
  const current = (await getActiveScoringWeights()) ?? PUBLIC_SCORE_WEIGHTS;
  const cur: Triple = {
    egs: current.expectationGap,
    invNis: current.narrativeIntegrityInverse,
    nhs: current.narrativeHeat,
  };
  const stepped: Triple = {
    egs: cur.egs + LEARNING_RATE * (target.egs - cur.egs),
    invNis: cur.invNis + LEARNING_RATE * (target.invNis - cur.invNis),
    nhs: cur.nhs + LEARNING_RATE * (target.nhs - cur.nhs),
  };
  const next = normalizeClamped(stepped);

  const weights: PublicScoreWeights = {
    expectationGap: round4(next.egs),
    narrativeIntegrityInverse: round4(next.invNis),
    narrativeHeat: round4(next.nhs),
  };

  // 5. Persist — append-only; the newest row is the active weight set.
  await db.insert(schema.scoringWeights).values({
    egsWeight: weights.expectationGap,
    nisWeight: weights.narrativeIntegrityInverse,
    nhsWeight: weights.narrativeHeat,
    sampleSize: retArr.length,
    method: METHOD,
    metadata: {
      correlations: corr,
      target,
      previous: cur,
      learningRate: LEARNING_RATE,
      bounds: [WEIGHT_MIN, WEIGHT_MAX],
    },
  });

  result.updated = true;
  result.sampleSize = retArr.length;
  result.weights = weights;
  log.info(result, 'calibrate: updated weights');
  return result;
}
