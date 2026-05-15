import { z } from 'zod';
import {
  AssetClass,
  AssetClassMeta,
  PortfolioConstraints,
  ENGINE_VERSIONS,
  type AssetClass as AssetClassT,
  type Sleeve,
  type Sector,
  type Signal,
} from '@vantage/shared';

/**
 * Portfolio construction.
 *
 * Input: a set of classified candidates with sector + conviction.
 * Output: a sleeved allocation respecting hard constraints:
 *   - maxAssetWeight per holding
 *   - maxSectorWeight per sector
 *   - minCrossSectorCount across the book
 *   - sleeveTargets — sum of weights per sleeve approximates targets
 *
 * Strategy: greedy fill per sleeve in conviction order, with sector caps
 * binding immediately. Underfilled sleeves leave cash residual.
 */

export const Candidate = z.object({
  entity: z.string(),
  name: z.string(),
  sector: z.string(),
  assetClass: AssetClass,
  conviction: z.number().min(0).max(1), // higher = stronger conviction
});
export type Candidate = z.infer<typeof Candidate>;

export const Allocation = z.object({
  entity: z.string(),
  name: z.string(),
  sector: z.string(),
  sleeve: z.string(),
  weight: z.number().min(0).max(1),
  assetClass: AssetClass,
});
export type Allocation = z.infer<typeof Allocation>;

export const PortfolioResult = z.object({
  asOf: z.string().datetime(),
  allocations: z.array(Allocation),
  sleeveWeights: z.record(z.number()),
  cashWeight: z.number(),
  warnings: z.array(z.string()),
  constraints: PortfolioConstraints,
});
export type PortfolioResult = z.infer<typeof PortfolioResult>;

export function constructPortfolio(
  candidates: Candidate[],
  constraints?: Partial<z.infer<typeof PortfolioConstraints>>,
): PortfolioResult {
  const cons = PortfolioConstraints.parse({
    maxAssetWeight: constraints?.maxAssetWeight ?? 0.1,
    maxSectorWeight: constraints?.maxSectorWeight ?? 0.25,
    minCrossSectorCount: constraints?.minCrossSectorCount ?? 4,
    sleeveTargets: constraints?.sleeveTargets ?? {
      core: 0.5,
      growth: 0.25,
      defensive: 0.15,
      tactical: 0.1,
    },
  });

  const allocations: Allocation[] = [];
  const sleeveUsed: Record<'core' | 'growth' | 'defensive' | 'tactical', number> = {
    core: 0,
    growth: 0,
    defensive: 0,
    tactical: 0,
  };
  const sectorUsed = new Map<string, number>();
  const warnings: string[] = [];

  // Group candidates by sleeve (driven by assetClass)
  const groups: Record<Sleeve, Candidate[]> = {
    core: [],
    growth: [],
    defensive: [],
    tactical: [],
    none: [],
  };
  for (const c of candidates) {
    const sleeve = AssetClassMeta[c.assetClass as AssetClassT].sleeve;
    groups[sleeve].push(c);
  }

  // Greedy fill per sleeve in conviction order
  const sleeves: Array<keyof typeof sleeveUsed> = ['core', 'growth', 'defensive', 'tactical'];
  for (const sleeve of sleeves) {
    const target = cons.sleeveTargets[sleeve];
    const sorted = [...groups[sleeve]].sort((a, b) => b.conviction - a.conviction);

    for (const c of sorted) {
      const sectorCurrent = sectorUsed.get(c.sector) ?? 0;
      const remainingSleeve = target - sleeveUsed[sleeve];
      if (remainingSleeve <= 0) break;

      // Weight is capped by: maxAssetWeight, remaining sleeve, remaining sector cap
      const sectorRemaining = cons.maxSectorWeight - sectorCurrent;
      const w = Math.min(cons.maxAssetWeight, remainingSleeve, sectorRemaining);
      if (w <= 0) continue;

      allocations.push({
        entity: c.entity,
        name: c.name,
        sector: c.sector,
        sleeve,
        weight: w,
        assetClass: c.assetClass,
      });
      sleeveUsed[sleeve] += w;
      sectorUsed.set(c.sector, sectorCurrent + w);
    }

    if (sleeveUsed[sleeve] < target * 0.9) {
      warnings.push(`Sleeve "${sleeve}" underfilled: ${(sleeveUsed[sleeve] * 100).toFixed(1)}% of ${(target * 100).toFixed(1)}% target`);
    }
  }

  const totalAllocated = Object.values(sleeveUsed).reduce((a, b) => a + b, 0);
  const cashWeight = Math.max(0, 1 - totalAllocated);

  // Cross-sector check
  if (sectorUsed.size < cons.minCrossSectorCount) {
    warnings.push(`Only ${sectorUsed.size} sectors represented (min ${cons.minCrossSectorCount})`);
  }

  return {
    asOf: new Date().toISOString(),
    allocations,
    sleeveWeights: sleeveUsed,
    cashWeight,
    warnings,
    constraints: cons,
  };
}

export function allocationToSignal(a: Allocation, asOf: string): Signal {
  return {
    entity: a.entity,
    timestamp: asOf,
    signalType: 'platform.allocation',
    direction: 'bullish',
    magnitude: a.weight,
    confidence: 1,
    sourceVersion: ENGINE_VERSIONS.PORTFOLIO,
    transformChain: [
      {
        op: 'platform.portfolio.allocate',
        inputs: { sleeve: a.sleeve, assetClass: a.assetClass, sector: a.sector },
        output: { weight: a.weight },
        ts: asOf,
      },
    ],
    rationale: `Allocated ${(a.weight * 100).toFixed(1)}% to ${a.name} in the ${a.sleeve} sleeve.`,
    metadata: { sleeve: a.sleeve, sector: a.sector },
  };
}
