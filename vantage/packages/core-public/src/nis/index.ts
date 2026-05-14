import { z } from 'zod';

/**
 * Narrative Integrity Score (NIS) — does the dominant narrative match the data?
 * Range 0–100. Higher = narrative is intact.
 *
 * Inputs:
 *   - Per-segment revenue share and growth differential
 *   - Multi-period consistency
 *
 * High share + high growth in the "narrative segment" → high NIS.
 * Narrative segment shrinking or stagnant → low NIS.
 */

export const SegmentDatum = z.object({
  name: z.string(),
  revenueSharePct: z.number().min(0).max(100),
  yoyGrowthPct: z.number(),
  isNarrativeSegment: z.boolean(),
});
export type SegmentDatum = z.infer<typeof SegmentDatum>;

export const NisInputs = z.object({
  currentPeriodSegments: z.array(SegmentDatum).min(1),
  historicalConsistency: z.number().min(0).max(1).default(0.7),
});
export type NisInputs = z.infer<typeof NisInputs>;

export const NisResult = z.object({
  score: z.number().min(0).max(100),
  narrativeShare: z.number(),
  narrativeGrowth: z.number(),
  components: z.object({
    shareWeight: z.number(),
    growthWeight: z.number(),
    consistencyWeight: z.number(),
  }),
});
export type NisResult = z.infer<typeof NisResult>;

export function computeNis(input: NisInputs): NisResult {
  const v = NisInputs.parse(input);
  const narrativeSegments = v.currentPeriodSegments.filter((s) => s.isNarrativeSegment);
  if (narrativeSegments.length === 0) {
    return {
      score: 50,
      narrativeShare: 0,
      narrativeGrowth: 0,
      components: { shareWeight: 0, growthWeight: 0, consistencyWeight: v.historicalConsistency },
    };
  }

  const narrativeShare = narrativeSegments.reduce((acc, s) => acc + s.revenueSharePct, 0);
  const narrativeGrowth =
    narrativeSegments.reduce((acc, s) => acc + s.yoyGrowthPct * s.revenueSharePct, 0) /
    narrativeShare;

  // Components: share contributes 40, growth contributes 40, historical consistency 20
  const shareWeight = Math.min(40, narrativeShare * 0.4);
  const growthWeight = Math.max(0, Math.min(40, (narrativeGrowth + 10) * 2));
  const consistencyWeight = v.historicalConsistency * 20;

  const score = shareWeight + growthWeight + consistencyWeight;

  return {
    score: Math.max(0, Math.min(100, score)),
    narrativeShare,
    narrativeGrowth,
    components: { shareWeight, growthWeight, consistencyWeight },
  };
}
