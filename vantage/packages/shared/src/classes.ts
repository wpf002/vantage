import { z } from 'zod';

/**
 * Asset classification — every evaluated company lands in one of four buckets.
 * Classification drives sleeve allocation in the portfolio package.
 */

export const AssetClass = z.enum(['CORE', 'HIGH_ASYMMETRY', 'TACTICAL', 'AVOID']);
export type AssetClass = z.infer<typeof AssetClass>;

export const AssetClassMeta: Record<
  AssetClass,
  { label: string; description: string; sleeve: Sleeve }
> = {
  CORE: {
    label: 'Core',
    description: 'High certainty, structural dominance, long-duration hold.',
    sleeve: 'core',
  },
  HIGH_ASYMMETRY: {
    label: 'High Asymmetry',
    description: 'Strong upside, controlled downside.',
    sleeve: 'growth',
  },
  TACTICAL: {
    label: 'Tactical',
    description: 'Timing-dependent, requires entry confirmation.',
    sleeve: 'tactical',
  },
  AVOID: {
    label: 'Avoid',
    description: 'Weak structure, unfavorable positioning, elevated risk.',
    sleeve: 'none',
  },
};

export const Sleeve = z.enum(['core', 'growth', 'defensive', 'tactical', 'none']);
export type Sleeve = z.infer<typeof Sleeve>;

/**
 * Portfolio constraints — hard limits the construction engine enforces.
 */
export const PortfolioConstraints = z.object({
  maxAssetWeight: z.number().min(0).max(1).default(0.1),
  maxSectorWeight: z.number().min(0).max(1).default(0.25),
  minCrossSectorCount: z.number().int().min(1).default(4),
  sleeveTargets: z.object({
    core: z.number().min(0).max(1).default(0.5),
    growth: z.number().min(0).max(1).default(0.25),
    defensive: z.number().min(0).max(1).default(0.15),
    tactical: z.number().min(0).max(1).default(0.1),
  }),
});
export type PortfolioConstraints = z.infer<typeof PortfolioConstraints>;
