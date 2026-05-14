import { z } from 'zod';

/**
 * Narrative Heat Score (NHS) — is sentiment running ahead of fundamentals?
 * Range 0–100. Higher = more overheated.
 *
 * Inputs:
 *   - Recent price-target moves (analyst raises)
 *   - Analyst posture (upgrades / downgrades)
 *   - Price / revenue ratio vs historical baseline
 */

export const NhsInputs = z.object({
  priceTargetMoveTrailing90dPct: z.number(),
  analystUpgradesTrailing90d: z.number().int().min(0),
  analystDowngradesTrailing90d: z.number().int().min(0),
  priceToRevenueRatio: z.number().positive(),
  historicalMedianPriceToRevenue: z.number().positive(),
});
export type NhsInputs = z.infer<typeof NhsInputs>;

export const NhsResult = z.object({
  score: z.number().min(0).max(100),
  components: z.object({
    priceTargetHeat: z.number(),
    analystSkew: z.number(),
    valuationStretch: z.number(),
  }),
});
export type NhsResult = z.infer<typeof NhsResult>;

export function computeNhs(input: NhsInputs): NhsResult {
  const v = NhsInputs.parse(input);

  // Price target heat: trailing 90d move scaled to [0, 40]
  const priceTargetHeat = Math.max(0, Math.min(40, v.priceTargetMoveTrailing90dPct * 2));

  // Analyst skew: net upgrades scaled to [0, 30]
  const net = v.analystUpgradesTrailing90d - v.analystDowngradesTrailing90d;
  const analystSkew = Math.max(0, Math.min(30, net * 3));

  // Valuation stretch vs historical median: scaled to [0, 30]
  const stretchRatio = v.priceToRevenueRatio / v.historicalMedianPriceToRevenue;
  const valuationStretch = Math.max(0, Math.min(30, (stretchRatio - 1) * 30));

  const score = priceTargetHeat + analystSkew + valuationStretch;

  return {
    score: Math.max(0, Math.min(100, score)),
    components: { priceTargetHeat, analystSkew, valuationStretch },
  };
}
