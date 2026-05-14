import { z } from 'zod';
import { InsufficientDataError, ILLIQUIDITY_DISCOUNT } from '@vantage/shared';
import type { ValuationMethodResult } from '../types.js';

/**
 * Comparable-companies valuation.
 * Applies median EV/Revenue and EV/EBITDA from a peer set,
 * then takes a 50/50 blend, then applies an illiquidity discount.
 */

export const PeerMultiples = z.object({
  ticker: z.string(),
  evToRevenue: z.number(),
  evToEbitda: z.number().optional(),
});
export type PeerMultiples = z.infer<typeof PeerMultiples>;

export const CompsInputs = z.object({
  revenueLTM: z.number().positive(),
  ebitdaLTM: z.number().optional(),
  peers: z.array(PeerMultiples).min(3, 'need at least 3 peers'),
  netDebt: z.number().default(0),
  illiquidityDiscount: z.number().min(0).max(1).default(ILLIQUIDITY_DISCOUNT),
});
export type CompsInputs = z.infer<typeof CompsInputs>;

function median(values: number[]): number {
  if (values.length === 0) throw new InsufficientDataError('comps', 'no peer multiples');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function runComps(input: CompsInputs): ValuationMethodResult {
  const validated = CompsInputs.parse(input);
  const evRevMultiples = validated.peers.map((p) => p.evToRevenue);
  const evRev = median(evRevMultiples);

  const evRevValue = evRev * validated.revenueLTM;

  let evEbitdaValue: number | undefined;
  let evEbitda: number | undefined;
  if (validated.ebitdaLTM && validated.ebitdaLTM > 0) {
    const ebitdaMultiples = validated.peers
      .map((p) => p.evToEbitda)
      .filter((m): m is number => m !== undefined && m > 0);
    if (ebitdaMultiples.length >= 3) {
      evEbitda = median(ebitdaMultiples);
      evEbitdaValue = evEbitda * validated.ebitdaLTM;
    }
  }

  const blendedEV =
    evEbitdaValue !== undefined ? (evRevValue + evEbitdaValue) / 2 : evRevValue;
  const discountedEV = blendedEV * (1 - validated.illiquidityDiscount);
  const equityValue = discountedEV - validated.netDebt;

  // Confidence shaped by peer count and multiple dispersion
  const stdDev = Math.sqrt(
    evRevMultiples.reduce((acc, m) => acc + (m - evRev) ** 2, 0) / evRevMultiples.length,
  );
  const cv = stdDev / evRev; // coefficient of variation
  let confidence = Math.min(1, 0.4 + 0.1 * validated.peers.length);
  if (cv > 0.5) confidence *= 0.6;

  return {
    method: 'comps',
    enterpriseValue: discountedEV,
    equityValue,
    confidence,
    rationale: `Comps blend on ${validated.peers.length} peers. Median EV/Rev ${evRev.toFixed(2)}x${
      evEbitda ? `, EV/EBITDA ${evEbitda.toFixed(2)}x` : ''
    }, illiquidity discount ${(validated.illiquidityDiscount * 100).toFixed(0)}%.`,
    inputs: {
      medianEvToRevenue: evRev,
      medianEvToEbitda: evEbitda,
      peerCount: validated.peers.length,
      coefficientOfVariation: cv,
    },
  };
}
