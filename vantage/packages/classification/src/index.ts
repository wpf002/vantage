import { z } from 'zod';
import {
  AssetClass,
  AssetClassMeta,
  ENGINE_VERSIONS,
  type Signal,
  type AssetClass as AssetClassT,
} from '@vantage/shared';

/**
 * Classification — rolls a company's harmonized signals into one of
 * CORE / HIGH_ASYMMETRY / TACTICAL / AVOID.
 *
 * Rules (deterministic, no ML):
 *   - High confidence + bullish + structural narrative → CORE
 *   - Bullish with moderate confidence + asymmetric upside → HIGH_ASYMMETRY
 *   - Bullish but timing-dependent (heat ≥ 60) → TACTICAL
 *   - Bearish or weak structure → AVOID
 */

export interface ClassificationContext {
  entity: string;
  signals: Signal[]; // harmonized signals for the entity
}

export const ClassificationResult = z.object({
  entity: z.string(),
  classification: AssetClass,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  contributingSignals: z.array(z.string()), // signalType list
  asOf: z.string().datetime(),
});
export type ClassificationResult = z.infer<typeof ClassificationResult>;

interface Aggregates {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  avgConfidence: number;
  publicLabel: string | null;
  publicScore: number | null;
  nhsScore: number | null;
  nisScore: number | null;
  valuationConfidence: number | null;
}

function aggregate(signals: Signal[]): Aggregates {
  const agg: Aggregates = {
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    avgConfidence: 0,
    publicLabel: null,
    publicScore: null,
    nhsScore: null,
    nisScore: null,
    valuationConfidence: null,
  };
  if (signals.length === 0) return agg;

  let confSum = 0;
  for (const s of signals) {
    if (s.direction === 'bullish') agg.bullishCount++;
    else if (s.direction === 'bearish') agg.bearishCount++;
    else agg.neutralCount++;
    confSum += s.confidence;

    if (s.signalType === 'public.score') {
      agg.publicScore = s.magnitude * 100;
      agg.publicLabel = (s.metadata?.label as string) ?? null;
    }
    if (s.signalType === 'public.narrative_heat') {
      agg.nhsScore = s.magnitude * 100;
    }
    if (s.signalType === 'public.narrative_integrity') {
      agg.nisScore = s.magnitude * 100;
    }
    if (s.signalType === 'private.blended_valuation') {
      agg.valuationConfidence = s.confidence;
    }
  }
  agg.avgConfidence = confSum / signals.length;
  return agg;
}

export function classify(ctx: ClassificationContext): ClassificationResult {
  const agg = aggregate(ctx.signals);
  const netBull = agg.bullishCount - agg.bearishCount;

  let classification: AssetClassT;
  let rationale: string;

  // AVOID — bearish dominance or very low confidence
  if (netBull < 0 || agg.avgConfidence < 0.3) {
    classification = 'AVOID';
    rationale =
      netBull < 0
        ? `Net bearish (${agg.bearishCount} bearish vs ${agg.bullishCount} bullish signals).`
        : `Confidence floor breach — avg ${agg.avgConfidence.toFixed(2)}.`;
  }
  // TACTICAL — bullish but overheated
  else if ((agg.nhsScore ?? 0) >= 60 || (agg.publicLabel ?? '').includes('thin_ice')) {
    classification = 'TACTICAL';
    rationale = `Bullish with elevated narrative heat (NHS ${agg.nhsScore?.toFixed(1) ?? 'n/a'}) — timing-dependent.`;
  }
  // CORE — bullish, high confidence, narrative intact
  else if (
    agg.avgConfidence >= 0.7 &&
    netBull >= 2 &&
    (agg.nisScore === null || agg.nisScore >= 60)
  ) {
    classification = 'CORE';
    rationale = `High-confidence bullish stance with intact narrative.`;
  }
  // HIGH_ASYMMETRY — bullish with moderate confidence
  else {
    classification = 'HIGH_ASYMMETRY';
    rationale = `Bullish signal mix with controlled-downside profile.`;
  }

  return {
    entity: ctx.entity,
    classification,
    confidence: agg.avgConfidence,
    rationale: `${AssetClassMeta[classification].label}: ${rationale}`,
    contributingSignals: ctx.signals.map((s) => s.signalType),
    asOf: new Date().toISOString(),
  };
}

export function classificationToSignal(r: ClassificationResult): Signal {
  return {
    entity: r.entity,
    timestamp: r.asOf,
    signalType: 'platform.classification',
    direction: r.classification === 'AVOID' ? 'bearish' : 'bullish',
    magnitude: r.classification === 'CORE' ? 0.9 : r.classification === 'HIGH_ASYMMETRY' ? 0.7 : r.classification === 'TACTICAL' ? 0.5 : 0.1,
    confidence: r.confidence,
    sourceVersion: ENGINE_VERSIONS.CLASSIFICATION,
    transformChain: [
      {
        op: 'platform.classification.rules',
        inputs: { contributingSignals: r.contributingSignals },
        output: r.classification,
        ts: r.asOf,
      },
    ],
    rationale: r.rationale,
    metadata: { assetClass: r.classification },
  };
}
