import { z } from 'zod';
import {
  PUBLIC_SCORE_WEIGHTS,
  ENGINE_VERSIONS,
  type Signal,
  type PublicScoreWeights,
} from '@vantage/shared';
import { computeEgs, EgsInputs, type EgsResult } from './egs/index.js';
import { computeNis, NisInputs, type NisResult } from './nis/index.js';
import { computeNhs, NhsInputs, type NhsResult } from './nhs/index.js';
import { classifyLabel, PublicLabelMeta, type PublicLabel } from './labels.js';

/**
 * Public Score — three-layer divergence index.
 *
 *   Public Score = 0.45 × Expectation Gap
 *                + 0.35 × (100 − Narrative Integrity)
 *                + 0.20 × Narrative Heat
 *
 * High score = bigger reality gap. Low score = aligned.
 */

export const PublicScoreInputs = z.object({
  ticker: z.string(),
  egs: EgsInputs,
  nis: NisInputs,
  nhs: NhsInputs,
  surpriseSign: z.number().int().min(-1).max(1),
});
export type PublicScoreInputs = z.infer<typeof PublicScoreInputs>;

export const PublicScoreResult = z.object({
  ticker: z.string(),
  asOf: z.string().datetime(),
  score: z.number().min(0).max(100),
  label: z.string(),
  direction: z.enum(['bullish', 'bearish', 'neutral']),
  components: z.object({
    egs: z.any(),
    nis: z.any(),
    nhs: z.any(),
  }),
  confidence: z.number().min(0).max(1),
});
export type PublicScoreResult = z.infer<typeof PublicScoreResult>;

export function computePublicScore(
  input: PublicScoreInputs,
  weights: PublicScoreWeights = PUBLIC_SCORE_WEIGHTS,
): PublicScoreResult {
  const v = PublicScoreInputs.parse(input);
  const egs = computeEgs(v.egs);
  const nis = computeNis(v.nis);
  const nhs = computeNhs(v.nhs);

  const score =
    weights.expectationGap * egs.score +
    weights.narrativeIntegrityInverse * (100 - nis.score) +
    weights.narrativeHeat * nhs.score;

  const label: PublicLabel = classifyLabel({
    publicScore: score,
    egsDirection: egs.direction,
    nisScore: nis.score,
    nhsScore: nhs.score,
    surpriseSign: v.surpriseSign,
  });

  const meta = PublicLabelMeta[label];

  // Confidence: high when all 3 components are well-defined
  // (no zero-shares, sane price reaction, peer-checked multiples).
  // For scaffold: a simple proxy.
  const confidence = Math.max(
    0,
    Math.min(
      1,
      1 -
        Math.abs(egs.score - 50) / 200 -
        Math.abs(nhs.score - 50) / 400,
    ),
  );

  return {
    ticker: v.ticker,
    asOf: new Date().toISOString(),
    score: Math.max(0, Math.min(100, score)),
    label,
    direction: meta.direction,
    components: { egs, nis, nhs },
    confidence,
  };
}

export function publicScoreToSignal(
  r: PublicScoreResult,
  weights: PublicScoreWeights = PUBLIC_SCORE_WEIGHTS,
): Signal {
  const egs = r.components.egs as EgsResult;
  const nis = r.components.nis as NisResult;
  const nhs = r.components.nhs as NhsResult;
  return {
    entity: r.ticker,
    timestamp: r.asOf,
    signalType: 'public.score',
    direction: r.direction,
    magnitude: r.score / 100,
    confidence: r.confidence,
    sourceVersion: ENGINE_VERSIONS.CORE_PUBLIC,
    transformChain: [
      {
        op: 'public.egs',
        inputs: {},
        output: egs,
        weight: weights.expectationGap,
        ts: r.asOf,
      },
      {
        op: 'public.nis',
        inputs: {},
        output: nis,
        weight: weights.narrativeIntegrityInverse,
        ts: r.asOf,
      },
      {
        op: 'public.nhs',
        inputs: {},
        output: nhs,
        weight: weights.narrativeHeat,
        ts: r.asOf,
      },
    ],
    rationale: `${PublicLabelMeta[r.label as PublicLabel].display}: score ${r.score.toFixed(1)}. ${PublicLabelMeta[r.label as PublicLabel].description}`,
    metadata: { label: r.label },
  };
}
