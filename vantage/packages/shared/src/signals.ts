import { z } from 'zod';

/**
 * Signal taxonomy — every score, gap, label, or alt-data observation
 * must be expressible as a Signal. The Harmonizer enforces this.
 *
 * Magnitude is always normalized to [0, 1]. Confidence is always [0, 1].
 * Direction is bullish (+1), neutral (0), or bearish (-1).
 *
 * Every signal carries its `transformChain` — the full provenance of
 * how raw inputs became this output. Nothing scores without lineage.
 */

export const SignalDirection = z.enum(['bullish', 'neutral', 'bearish']);
export type SignalDirection = z.infer<typeof SignalDirection>;

export const SignalType = z.enum([
  // private-side
  'private.dcf',
  'private.comps',
  'private.lbo',
  'private.ml_adjustment',
  'private.blended_valuation',
  'private.alt_data.web_traffic',
  'private.alt_data.engineering_velocity',
  'private.alt_data.ip_filings',
  'private.alt_data.app_activity',
  'private.alt_data.tech_stack_change',
  'private.alt_data.domain_rank',
  'private.alt_data.funding_leakage',
  // public-side
  'public.expectation_gap',
  'public.narrative_integrity',
  'public.narrative_heat',
  'public.score',
  'public.label',
  // platform-side
  'platform.classification',
  'platform.allocation',
  'platform.simulation_outcome',
]);
export type SignalType = z.infer<typeof SignalType>;

/**
 * A single transform step in a signal's lineage chain.
 * Every transformation that touches data leaves a step here.
 */
export const TransformStep = z.object({
  op: z.string(), // e.g. "dcf.terminal_value", "comps.ev_revenue_multiple"
  inputs: z.record(z.unknown()), // structured inputs to this op
  output: z.unknown(), // structured output
  weight: z.number().min(0).max(1).optional(), // contribution to blended result
  ts: z.string().datetime(),
});
export type TransformStep = z.infer<typeof TransformStep>;

export const Signal = z.object({
  entity: z.string(), // company ID or ticker
  timestamp: z.string().datetime(),
  signalType: SignalType,
  direction: SignalDirection,
  magnitude: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  sourceVersion: z.string(), // semver of the engine that produced it
  transformChain: z.array(TransformStep),
  rationale: z.string(), // deterministic plain-English (no LLM)
  metadata: z.record(z.unknown()).optional(),
});
export type Signal = z.infer<typeof Signal>;

/**
 * Magnitude scale helper — converts internal scores to the unified [0,1] band.
 * Used by every scoring package to normalize before emitting a Signal.
 */
export function normalizeMagnitude(value: number, min: number, max: number): number {
  if (max === min) return 0;
  const clamped = Math.max(min, Math.min(max, value));
  return (clamped - min) / (max - min);
}

/**
 * Confidence scale helper — combines multiple confidence inputs multiplicatively
 * (worst-case propagation). If any input is below `floor`, returns 0
 * to force the signal to be excluded from blending.
 */
export function combineConfidence(values: number[], floor = 0.1): number {
  if (values.some((v) => v < floor)) return 0;
  return values.reduce((acc, v) => acc * v, 1);
}
