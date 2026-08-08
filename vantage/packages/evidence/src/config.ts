import type { EvidenceWeights } from './types.js';

/**
 * Default weights for the five evidence quality components.
 * Must sum to 1.0. Configurable via EVIDENCE_WEIGHTS_JSON env var.
 *
 * source_credibility (0.25) + methodological_strength (0.25) = 0.50 structural.
 * recency (0.20) = data freshness.
 * historical_reliability (0.15) = empirical track record.
 * independence (0.10) = dedup signal.
 */
export const DEFAULT_WEIGHTS: EvidenceWeights = {
  source_credibility: 0.25,
  recency: 0.20,
  independence: 0.10,
  methodological_strength: 0.25,
  historical_reliability: 0.20,
};

/**
 * Initial credibility seeds by source type.
 * Sources start here before any outcomes are observed.
 */
export const INITIAL_CREDIBILITY: Record<string, number> = {
  'fmp:market_data': 0.85,
  'fmp:earnings': 0.80,
  'fmp:analyst_estimate': 0.65,
  'fmp:estimate_consensus': 0.62,
  'sec:10k': 0.88,
  'sec:10q': 0.85,
  'sec:8k': 0.80,
  'sec:filing': 0.85,
  'news:wire': 0.60,
  'news:reuters': 0.68,
  'news:bloomberg': 0.70,
  'news:blog': 0.38,
  'news:social': 0.30,
  'alt_data:web_traffic': 0.55,
  'alt_data:engineering_velocity': 0.50,
  'alt_data:ip_filings': 0.58,
  'alt_data:app_activity': 0.52,
  'alt_data:tech_stack_change': 0.50,
  'alt_data:domain_rank': 0.48,
  'alt_data:funding_leakage': 0.55,
  'ml:adjustment': 0.50,
  'default': 0.60,
};

/**
 * Methodological strength by source type.
 * Reflects how robust and reproducible the underlying method is,
 * independent of whether that source has been right before.
 */
export const METHODOLOGICAL_STRENGTH: Record<string, number> = {
  'fmp:market_data': 0.90,       // direct price observation — no inference
  'sec:10k': 0.88,               // audited, regulatory
  'sec:10q': 0.85,               // audited, regulatory
  'sec:8k': 0.78,                // regulatory, less structured
  'sec:filing': 0.85,
  'fmp:earnings': 0.80,          // reported fundamentals
  'fmp:analyst_estimate': 0.65,  // structured but human judgment
  'fmp:estimate_consensus': 0.62,// average of varying analysts
  'news:reuters': 0.58,
  'news:bloomberg': 0.60,
  'news:wire': 0.50,
  'news:blog': 0.32,
  'news:social': 0.22,
  'alt_data:web_traffic': 0.60,
  'alt_data:engineering_velocity': 0.55,
  'alt_data:ip_filings': 0.62,
  'alt_data:app_activity': 0.55,
  'alt_data:tech_stack_change': 0.52,
  'alt_data:domain_rank': 0.50,
  'alt_data:funding_leakage': 0.58,
  'ml:adjustment': 0.48,
  'default': 0.55,
};

/**
 * Recency halflife in days by source type.
 * Score = max(0, 1 - days_old / halflife), clamped to [0.05, 1].
 *
 * The floor of 0.05 means very old data never scores zero — there's a residual
 * value in historical context — but it's nearly negligible.
 */
export const RECENCY_HALFLIFE_DAYS: Record<string, number> = {
  'fmp:market_data': 1,
  'news:wire': 7,
  'news:reuters': 7,
  'news:bloomberg': 7,
  'news:blog': 5,
  'news:social': 3,
  'fmp:analyst_estimate': 30,
  'fmp:estimate_consensus': 30,
  'alt_data:web_traffic': 14,
  'alt_data:engineering_velocity': 21,
  'alt_data:ip_filings': 90,
  'alt_data:app_activity': 14,
  'alt_data:tech_stack_change': 30,
  'alt_data:domain_rank': 21,
  'alt_data:funding_leakage': 30,
  'fmp:earnings': 90,
  'sec:10k': 90,
  'sec:10q': 90,
  'sec:8k': 60,
  'sec:filing': 90,
  'ml:adjustment': 14,
  'default': 30,
};

/** Reputation decay rate. Exponential smoothing: new = (1-rate)*old + rate*outcome */
export const DEFAULT_DECAY_RATE = 0.05;

/**
 * Minimum sample count before full decay rate applies.
 * Below this, the rate is halved to reduce early-sample noise.
 */
export const MIN_SAMPLES_FOR_FULL_DECAY = 5;

/** Prior hit rate for sources with no graded outcomes yet. */
export const DEFAULT_HISTORICAL_RELIABILITY = 0.65;

/**
 * Load weights from env, falling back to defaults.
 * Validates that all five keys are present and sum to ~1.0 (±0.01).
 */
export function loadWeights(): EvidenceWeights {
  const raw = process.env.EVIDENCE_WEIGHTS_JSON;
  if (!raw) return DEFAULT_WEIGHTS;
  try {
    const parsed = JSON.parse(raw) as Partial<EvidenceWeights>;
    const keys: Array<keyof EvidenceWeights> = [
      'source_credibility', 'recency', 'independence',
      'methodological_strength', 'historical_reliability',
    ];
    const missing = keys.filter((k) => typeof parsed[k] !== 'number');
    if (missing.length > 0) {
      throw new Error(`EVIDENCE_WEIGHTS_JSON missing keys: ${missing.join(', ')}`);
    }
    const sum = keys.reduce((acc, k) => acc + (parsed[k] as number), 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      throw new Error(`EVIDENCE_WEIGHTS_JSON weights sum to ${sum.toFixed(4)}, expected 1.0`);
    }
    return parsed as EvidenceWeights;
  } catch (err) {
    // Invalid env — log and fall back rather than crashing the process.
    console.warn('[evidence] EVIDENCE_WEIGHTS_JSON invalid, using defaults:', (err as Error).message);
    return DEFAULT_WEIGHTS;
  }
}

/** Look up a value in a string-keyed record, falling back through prefix matches then 'default'. */
export function lookup(map: Record<string, number>, key: string): number {
  if (key in map) return map[key]!;
  // Try prefix: 'alt_data:web_traffic' → 'alt_data'
  const prefix = key.split(':')[0];
  if (prefix && `${prefix}:*` in map) return map[`${prefix}:*`]!;
  if (prefix && prefix in map) return map[prefix]!;
  return map['default'] ?? 0.5;
}
