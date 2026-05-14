import { z } from 'zod';

export const MarketType = z.enum(['private', 'public']);
export type MarketType = z.infer<typeof MarketType>;

export const LifeStage = z.enum([
  'seed',
  'series_a',
  'series_b',
  'series_c_plus',
  'pre_ipo',
  'public_early',
  'public_mature',
]);
export type LifeStage = z.infer<typeof LifeStage>;

export const Sector = z.enum([
  'technology',
  'healthcare',
  'financials',
  'consumer_discretionary',
  'consumer_staples',
  'industrials',
  'energy',
  'materials',
  'utilities',
  'real_estate',
  'communication_services',
  'other',
]);
export type Sector = z.infer<typeof Sector>;

export const Company = z.object({
  id: z.string(), // internal ID (uuid for private, ticker for public)
  name: z.string(),
  marketType: MarketType,
  ticker: z.string().optional(), // public only
  sector: Sector,
  lifeStage: LifeStage,
  country: z.string().default('US'),
  metadata: z.record(z.unknown()).optional(),
});
export type Company = z.infer<typeof Company>;

/**
 * Valuation range with bear / base / bull bands.
 */
export const ValuationRange = z.object({
  bear: z.number(),
  base: z.number(),
  bull: z.number(),
  currency: z.string().default('USD'),
  asOf: z.string().datetime(),
});
export type ValuationRange = z.infer<typeof ValuationRange>;
