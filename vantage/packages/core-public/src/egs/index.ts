import { z } from 'zod';

/**
 * Expectation Gap Score (EGS) — how far did results deviate from estimates,
 * and did price confirm? Range 0–100. Higher = bigger gap (more uncertainty).
 *
 * Inputs:
 *   - EPS / revenue surprise (%) vs consensus
 *   - 1-day and 3-day price reaction
 *
 * High surprise + confirming price → low EGS (results landed cleanly).
 * High surprise + non-confirming price → high EGS (market disagreed).
 */

export const EgsInputs = z.object({
  epsSurprisePct: z.number(), // (actual - consensus) / |consensus|
  revenueSurprisePct: z.number(),
  oneDayReturn: z.number(),
  threeDayReturn: z.number(),
});
export type EgsInputs = z.infer<typeof EgsInputs>;

export const EgsResult = z.object({
  score: z.number().min(0).max(100),
  direction: z.enum(['confirming', 'disconfirming', 'neutral']),
  components: z.object({
    surpriseMagnitude: z.number(),
    priceConfirmation: z.number(),
  }),
});
export type EgsResult = z.infer<typeof EgsResult>;

export function computeEgs(input: EgsInputs): EgsResult {
  const v = EgsInputs.parse(input);

  // Surprise magnitude — average absolute surprise across EPS + revenue
  const surpriseMag = (Math.abs(v.epsSurprisePct) + Math.abs(v.revenueSurprisePct)) / 2;

  // Did price confirm the surprise direction?
  const surpriseSign = Math.sign(v.epsSurprisePct + v.revenueSurprisePct);
  const priceSign = Math.sign(v.oneDayReturn + v.threeDayReturn);
  // priceConfirmation = +1 confirmed, -1 disconfirmed, 0 neutral
  const priceConfirmation = surpriseSign === 0 || priceSign === 0 ? 0 : surpriseSign * priceSign;

  let direction: EgsResult['direction'] = 'neutral';
  if (priceConfirmation > 0) direction = 'confirming';
  else if (priceConfirmation < 0) direction = 'disconfirming';

  // Score: scale surprise [0, 100], penalize disconfirmation
  // Big surprise that price ignored → high gap (bad).
  // Big surprise that price confirmed → low gap (clean).
  const baseScore = Math.min(100, surpriseMag * 100);
  const score =
    priceConfirmation > 0 ? baseScore * 0.4 : priceConfirmation < 0 ? baseScore : baseScore * 0.7;

  return {
    score: Math.max(0, Math.min(100, score)),
    direction,
    components: { surpriseMagnitude: surpriseMag, priceConfirmation },
  };
}
