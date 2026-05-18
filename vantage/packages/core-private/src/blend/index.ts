import { z } from 'zod';
import {
  CONFIDENCE_FLOOR,
  PRIVATE_STAGE_WEIGHTS,
  ENGINE_VERSIONS,
  type Signal,
  type LifeStage,
} from '@vantage/shared';
import type { ValuationMethodResult, BlendedValuation } from '../types.js';

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Weighted blend.
 *
 * Strategy:
 *   1. Start with stage-default weights [DCF, Comps, LBO].
 *   2. Zero out any method whose confidence is below CONFIDENCE_FLOOR.
 *   3. Renormalize remaining weights to sum to 1.
 *   4. Compute weighted EV, then bear/base/bull bands using a ±25%/±10% spread
 *      against the dispersion across surviving methods.
 */

export const BlendInputs = z.object({
  companyId: z.string(),
  lifeStage: z.string(), // accepts any LifeStage value
  methodResults: z.array(
    z.object({
      method: z.enum(['dcf', 'comps', 'lbo']),
      enterpriseValue: z.number(),
      equityValue: z.number(),
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
      inputs: z.record(z.unknown()),
      warnings: z.array(z.string()).default([]),
    }),
  ),
  mlAdjustment: z
    .object({
      delta: z.number(),
      direction: z.enum(['up', 'down', 'neutral']),
      shap: z.record(z.number()),
    })
    .optional(),
});

export function blendValuations(
  companyId: string,
  lifeStage: LifeStage,
  methodResults: ValuationMethodResult[],
  mlAdjustment?: BlendedValuation['mlAdjustment'],
): BlendedValuation {
  const [dcfW, compsW, lboW] = PRIVATE_STAGE_WEIGHTS[lifeStage] ?? [0.25, 0.5, 0.25];
  const baseWeights = { dcf: dcfW, comps: compsW, lbo: lboW };

  // Zero out below-floor methods
  const adjusted = { ...baseWeights };
  for (const r of methodResults) {
    if (r.confidence < CONFIDENCE_FLOOR) {
      adjusted[r.method] = 0;
    }
  }

  // Renormalize
  const sum = adjusted.dcf + adjusted.comps + adjusted.lbo;
  if (sum === 0) {
    throw new Error('all valuation methods below confidence floor — no blend possible');
  }
  const weights = {
    dcf: adjusted.dcf / sum,
    comps: adjusted.comps / sum,
    lbo: adjusted.lbo / sum,
  };

  // Weighted EV
  const byMethod = Object.fromEntries(methodResults.map((r) => [r.method, r])) as Record<
    'dcf' | 'comps' | 'lbo',
    ValuationMethodResult | undefined
  >;

  const weightedEv =
    weights.dcf * (byMethod.dcf?.enterpriseValue ?? 0) +
    weights.comps * (byMethod.comps?.enterpriseValue ?? 0) +
    weights.lbo * (byMethod.lbo?.enterpriseValue ?? 0);

  // Bear/bull spread from dispersion of surviving methods
  const survivingEVs = methodResults
    .filter((r) => weights[r.method] > 0)
    .map((r) => r.enterpriseValue);
  const lo = Math.min(...survivingEVs);
  const hi = Math.max(...survivingEVs);
  const spread = hi - lo;
  const bear = Math.max(weightedEv * 0.75, weightedEv - spread / 2);
  const bull = Math.min(weightedEv * 1.25, weightedEv + spread / 2);

  const preMl = { bear, base: weightedEv, bull };
  const finalValuation = mlAdjustment
    ? {
        bear: bear * (1 + mlAdjustment.delta),
        base: weightedEv * (1 + mlAdjustment.delta),
        bull: bull * (1 + mlAdjustment.delta),
      }
    : preMl;

  // Aggregate confidence: weighted geometric mean
  const aggConfidence = methodResults
    .filter((r) => weights[r.method] > 0)
    .reduce(
      (acc, r) => acc * Math.pow(Math.max(0.01, r.confidence), weights[r.method]),
      1,
    );

  return {
    companyId,
    asOf: new Date().toISOString(),
    methodResults,
    weights,
    preMlValuation: preMl,
    mlAdjustment,
    finalValuation,
    confidence: aggConfidence,
  };
}

/**
 * Emit a normalized Signal for the harmonizer.
 */
export function blendedValuationToSignal(b: BlendedValuation): Signal {
  return {
    entity: b.companyId,
    timestamp: b.asOf,
    signalType: 'private.blended_valuation',
    direction: 'neutral',
    magnitude: 0.5, // valuation magnitude is contextual, not directional
    confidence: b.confidence,
    sourceVersion: ENGINE_VERSIONS.CORE_PRIVATE,
    transformChain: b.methodResults.map((r) => ({
      op: `private.${r.method}`,
      inputs: r.inputs,
      output: { enterpriseValue: r.enterpriseValue, equityValue: r.equityValue },
      weight: b.weights[r.method],
      ts: b.asOf,
    })),
    rationale: `Blended valuation ${fmtUsd(b.finalValuation.base)} — bear ${fmtUsd(b.finalValuation.bear)}, bull ${fmtUsd(b.finalValuation.bull)}.`,
    metadata: { weights: b.weights, mlAdjustment: b.mlAdjustment },
  };
}
