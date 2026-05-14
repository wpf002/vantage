import { z } from 'zod';

/**
 * Common types for the private valuation pipeline.
 */

export const ValuationMethodResult = z.object({
  method: z.enum(['dcf', 'comps', 'lbo']),
  enterpriseValue: z.number(),
  equityValue: z.number(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  inputs: z.record(z.unknown()),
  warnings: z.array(z.string()).default([]),
});
export type ValuationMethodResult = z.infer<typeof ValuationMethodResult>;

export const BlendedValuation = z.object({
  companyId: z.string(),
  asOf: z.string().datetime(),
  methodResults: z.array(ValuationMethodResult),
  weights: z.object({
    dcf: z.number().min(0).max(1),
    comps: z.number().min(0).max(1),
    lbo: z.number().min(0).max(1),
  }),
  preMlValuation: z.object({ bear: z.number(), base: z.number(), bull: z.number() }),
  mlAdjustment: z
    .object({
      delta: z.number(),
      direction: z.enum(['up', 'down', 'neutral']),
      shap: z.record(z.number()),
    })
    .optional(),
  finalValuation: z.object({ bear: z.number(), base: z.number(), bull: z.number() }),
  confidence: z.number().min(0).max(1),
});
export type BlendedValuation = z.infer<typeof BlendedValuation>;
