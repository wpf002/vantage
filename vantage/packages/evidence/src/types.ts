import { z } from 'zod';

// ── Evidence quality weights ──────────────────────────────────────────────

export const EvidenceWeights = z.object({
  source_credibility: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  independence: z.number().min(0).max(1),
  methodological_strength: z.number().min(0).max(1),
  historical_reliability: z.number().min(0).max(1),
});
export type EvidenceWeights = z.infer<typeof EvidenceWeights>;

// ── Per-signal quality assessment ─────────────────────────────────────────

export const EvidenceQuality = z.object({
  sourceKey: z.string(),
  sourceCredibility: z.number().min(0).max(1),
  recencyScore: z.number().min(0).max(1),
  independenceScore: z.number().min(0).max(1),
  methodologicalStrength: z.number().min(0).max(1),
  historicalReliability: z.number().min(0).max(1),
  compositeScore: z.number().min(0).max(1),
  weights: EvidenceWeights,
});
export type EvidenceQuality = z.infer<typeof EvidenceQuality>;

// ── Source context needed to compute quality ──────────────────────────────

export const SourceContext = z.object({
  /** Canonical source key, e.g. 'fmp:market_data', 'news:reuters', 'sec:10k' */
  sourceKey: z.string(),
  /** ISO date string of the underlying data's observation/publication date */
  dataDate: z.string(),
  /**
   * Number of outlets that published this same story within 24 h.
   * 1 = original. >1 = reprints. Drives independence score.
   */
  outletCount: z.number().int().min(1).default(1),
  /** Whether this signal is derived from another signal in the same scoring run */
  isDerived: z.boolean().default(false),
  /** Current reputation of this source from evidence_sources table (optional) */
  storedCredibility: z.number().min(0).max(1).optional(),
  /** Empirical hit rate from evidence_sources (correct_count / sample_count) */
  empiricalHitRate: z.number().min(0).max(1).optional(),
});
export type SourceContext = z.infer<typeof SourceContext>;

// ── Reasoning path ────────────────────────────────────────────────────────

export const LayerTrace = z.object({
  layer: z.enum(['egs', 'nis', 'nhs', 'composite', 'classification']),
  layerScore: z.number(),
  /** Threshold that gates this layer's contribution */
  thresholdKey: z.string().optional(),
  thresholdValue: z.number().optional(),
  /** Did this layer cross its threshold / trigger? */
  fired: z.boolean(),
  /** platform_signals UUIDs that fed this layer */
  inputSignalIds: z.array(z.string()),
  /** composite quality score per input signal */
  qualityScores: z.record(z.string(), z.number()),
  /** Weighted average quality across all inputs */
  compositeQuality: z.number().min(0).max(1),
  /** Delta (abs) in layerScore if each input were removed */
  sensitivity: z.record(z.string(), z.number()),
  /** Signal id whose removal causes the largest score change */
  maxSensitivitySignalId: z.string().optional(),
  /** Magnitude of that largest change */
  maxSensitivityDelta: z.number(),
});
export type LayerTrace = z.infer<typeof LayerTrace>;

export const ReasoningPath = z.object({
  entity: z.string(),
  /** decision_id FK into platform_decisions */
  decisionId: z.string(),
  layers: z.array(LayerTrace),
  capturedAt: z.string().datetime(),
});
export type ReasoningPath = z.infer<typeof ReasoningPath>;

// ── Source reputation update ──────────────────────────────────────────────

export interface ReputationUpdate {
  sourceKey: string;
  correct: boolean;
}

// ── Backtest result ───────────────────────────────────────────────────────

export interface BacktestReport {
  decisionsAnalyzed: number;
  gradedDecisions: number;
  accuracyUnweighted: number;
  accuracyQualityWeighted: number;
  delta: number; // qualityWeighted - unweighted (positive = improvement)
  sourceBreakdown: Array<{
    sourceKey: string;
    sampleCount: number;
    correctCount: number;
    hitRate: number;
    finalCredibility: number;
  }>;
}
