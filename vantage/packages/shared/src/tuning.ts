import {
  type Decision,
  MEANINGFUL_THRESHOLD,
  PUBLIC_LABEL_DIRECTION,
  bucketBy,
  computeHitRate,
  decisionHit,
  decisionReturn,
  meanConfidence,
  pearson,
} from './calibration.js';

/**
 * Tuning suggestions — Phase 8 meta-learning.
 *
 * PURE library. Reads the same normalized `Decision[]` the calibration
 * functions consume and produces ranked, deterministic recommendations. These
 * are surfaced to a human on /meta; nothing here is auto-applied to the
 * scoring engines. Every rule is gated on MEANINGFUL_THRESHOLD so the engine
 * stays silent rather than guessing while the log is still thin.
 */

export type TuningSeverity = 'info' | 'consider' | 'recommend';

export interface TuningSuggestion {
  severity: TuningSeverity;
  segment: string; // human-readable, e.g. "TACTICAL × consumer_discretionary"
  sampleSize: number;
  finding: string; // one-line plain English
  action: string | null; // suggested change, or null if purely informational
  metrics: Record<string, number>;
}

const SEVERITY_RANK: Record<TuningSeverity, number> = { recommend: 0, consider: 1, info: 2 };

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function pts(x: number): string {
  return `${Math.round(Math.abs(x) * 100)} points`;
}

// ── Rule 1 & 2: confidence vs. realized hit rate, per class × sector ─────────

function ruleClassSectorCalibration(decisions: Decision[]): TuningSuggestion[] {
  const out: TuningSuggestion[] = [];
  const buckets = bucketBy(decisions, {
    class: (d) => d.payload.assetClass,
    sector: (d) => d.payload.sector,
  });

  for (const [segment, group] of Object.entries(buckets)) {
    const { hitRate, sampleSize } = computeHitRate(group);
    if (sampleSize < MEANINGFUL_THRESHOLD) continue;
    const avgConf = meanConfidence(group);
    const gap = avgConf - hitRate;

    if (gap > 0.15) {
      // Overconfident — the engine claims more certainty than it earns.
      out.push({
        severity: gap > 0.25 ? 'recommend' : 'consider',
        segment,
        sampleSize,
        finding: `${segment} classifications have a ${pct(hitRate)} hit rate at avg confidence ${avgConf.toFixed(2)} (overconfident by ${pts(gap)}).`,
        action:
          'Raise the confidence threshold or tighten the classification rule for this segment.',
        metrics: { hitRate, avgConfidence: avgConf, calibrationGap: gap, sampleSize },
      });
    } else if (hitRate - avgConf > 0.15) {
      // Underconfident — a win. The engine is right more often than it claims.
      const delta = hitRate - avgConf;
      out.push({
        severity: 'consider',
        segment,
        sampleSize,
        finding: `${segment} classifications have a ${pct(hitRate)} hit rate at avg confidence ${avgConf.toFixed(2)} (underconfident by ${pts(delta)}).`,
        action:
          'Lower the confidence threshold — the engine is more accurate here than it reports.',
        metrics: { hitRate, avgConfidence: avgConf, calibrationGap: -delta, sampleSize },
      });
    }
  }
  return out;
}

// ── Rule 3: method confidence ↔ realized accuracy correlation ────────────────

function ruleMethodCorrelation(decisions: Decision[]): TuningSuggestion[] {
  const out: TuningSuggestion[] = [];
  const methods: Array<'DCF' | 'Comps' | 'LBO'> = ['DCF', 'Comps', 'LBO'];

  for (const method of methods) {
    const xs: number[] = []; // method confidence
    const ys: number[] = []; // realized accuracy (1 hit / 0 miss)
    for (const d of decisions) {
      if (d.decisionType !== 'private_valuation') continue;
      const m = d.payload.methods?.find((x) => x.method === method && x.weight > 0);
      if (!m || !Number.isFinite(m.confidence)) continue;
      const h = decisionHit(d);
      if (h === null) continue;
      xs.push(m.confidence);
      ys.push(h ? 1 : 0);
    }
    const sampleSize = xs.length;
    if (sampleSize < MEANINGFUL_THRESHOLD) continue;
    const corr = pearson(xs, ys);

    if (corr < 0.2) {
      out.push({
        severity: 'recommend',
        segment: `${method} method confidence`,
        sampleSize,
        finding: `${method} confidence is uncorrelated with realized accuracy (correlation ${corr.toFixed(2)}).`,
        action: 'Review the confidence formula — it is not predicting accuracy.',
        metrics: { confidenceCorrelation: corr, sampleSize },
      });
    } else if (corr > 0.6) {
      out.push({
        severity: 'info',
        segment: `${method} method confidence`,
        sampleSize,
        finding: `${method} confidence is well-calibrated against realized accuracy (correlation ${corr.toFixed(2)}).`,
        action: null,
        metrics: { confidenceCorrelation: corr, sampleSize },
      });
    }
  }
  return out;
}

// ── Rule 4: signal-label forward returns (inversion detector) ────────────────

function ruleLabelForwardReturns(decisions: Decision[]): TuningSuggestion[] {
  const out: TuningSuggestion[] = [];
  const byLabel = bucketBy(
    decisions.filter((d) => d.decisionType === 'public_score'),
    { label: (d) => d.payload.label },
  );

  for (const [label, group] of Object.entries(byLabel)) {
    const returns = group.map(decisionReturn).filter((r): r is number => r !== null);
    if (returns.length < MEANINGFUL_THRESHOLD) continue;
    const mean = returns.reduce((a, v) => a + v, 0) / returns.length;
    const direction = PUBLIC_LABEL_DIRECTION[label] ?? 'neutral';

    if (direction === 'bullish' && mean < 0) {
      out.push({
        severity: 'recommend',
        segment: label,
        sampleSize: returns.length,
        finding: `Bullish-tagged "${label}" has a negative mean 90d forward return (${pct(mean)}). The labeling may be inverted.`,
        action: 'Audit the label mapping — a bullish label is producing bearish outcomes.',
        metrics: { meanForwardReturn90d: mean, sampleSize: returns.length },
      });
    } else if (direction === 'bearish' && mean > 0) {
      out.push({
        severity: 'recommend',
        segment: label,
        sampleSize: returns.length,
        finding: `Bearish-tagged "${label}" has a positive mean 90d forward return (${pct(mean)}). The labeling may be inverted.`,
        action: 'Audit the label mapping — a bearish label is producing bullish outcomes.',
        metrics: { meanForwardReturn90d: mean, sampleSize: returns.length },
      });
    }
  }
  return out;
}

// ── Rule 5: time-decay of prediction accuracy ────────────────────────────────

function hitRateAtHorizon(
  decisions: Decision[],
  pick: (d: Decision) => number | undefined,
): { hitRate: number; sampleSize: number } {
  let hits = 0;
  let n = 0;
  for (const d of decisions) {
    if (d.decisionType !== 'public_score' || !d.outcome) continue;
    const r = pick(d);
    if (r === undefined || !Number.isFinite(r)) continue;
    const dir = d.payload.direction;
    if (dir !== 'bullish' && dir !== 'bearish') continue;
    n += 1;
    if ((dir === 'bullish' && r > 0) || (dir === 'bearish' && r < 0)) hits += 1;
  }
  return { hitRate: n === 0 ? 0 : hits / n, sampleSize: n };
}

function ruleTimeDecay(decisions: Decision[]): TuningSuggestion[] {
  const h30 = hitRateAtHorizon(decisions, (d) => d.outcome?.realizedReturn30d);
  const h60 = hitRateAtHorizon(decisions, (d) => d.outcome?.realizedReturn60d);
  const h90 = hitRateAtHorizon(decisions, (d) => d.outcome?.realizedReturn90d);
  const h180 = hitRateAtHorizon(decisions, (d) => d.outcome?.realizedReturn180d);

  const minSample = Math.min(h30.sampleSize, h180.sampleSize);
  if (minSample < MEANINGFUL_THRESHOLD) return [];

  const decay = h30.hitRate - h180.hitRate;
  if (decay <= 0.2) return [];

  return [
    {
      severity: 'info',
      segment: 'All public scores',
      sampleSize: minSample,
      finding: `Public-score hit rate decays from ${pct(h30.hitRate)} at 30d to ${pct(h180.hitRate)} at 180d (${pts(decay)}).`,
      action: 'Predictions degrade meaningfully past 90 days — consider shortening the implied horizon.',
      metrics: {
        hitRateAt30d: h30.hitRate,
        hitRateAt60d: h60.hitRate,
        hitRateAt90d: h90.hitRate,
        hitRateAt180d: h180.hitRate,
        decay,
        sampleSize: minSample,
      },
    },
  ];
}

/**
 * Run every rule, then sort: 'recommend' first, then 'consider', then 'info';
 * within a severity, by sample size descending (the most-supported findings
 * lead).
 */
export function analyzeCalibration(decisions: Decision[]): TuningSuggestion[] {
  const suggestions = [
    ...ruleClassSectorCalibration(decisions),
    ...ruleMethodCorrelation(decisions),
    ...ruleLabelForwardReturns(decisions),
    ...ruleTimeDecay(decisions),
  ];

  return suggestions.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return b.sampleSize - a.sampleSize;
  });
}
