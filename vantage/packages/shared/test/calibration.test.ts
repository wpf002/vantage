import { describe, it, expect } from 'vitest';
import {
  type Decision,
  MEANINGFUL_THRESHOLD,
  computeHitRate,
  computeBrierScore,
  computeReliabilityCurve,
  computeReturnDistribution,
  bucketBy,
  decisionHit,
} from '../src/calibration.js';
import { analyzeCalibration } from '../src/tuning.js';

function publicScore(
  id: string,
  direction: 'bullish' | 'bearish' | 'neutral',
  r90: number | undefined,
  confidence: number,
  extra: Partial<Decision['outcome']> = {},
): Decision {
  return {
    id,
    decisionType: 'public_score',
    confidence,
    createdAt: '2025-09-01T00:00:00.000Z',
    payload: { direction, sector: 'technology', label: 'aligned_strength' },
    outcome: r90 === undefined && Object.keys(extra).length === 0
      ? null
      : { realizedReturn90d: r90, ...extra },
  };
}

function classification(
  id: string,
  assetClass: Decision['payload']['assetClass'],
  realizedReturn: number | undefined,
  confidence: number,
  sector = 'technology' as const,
): Decision {
  return {
    id,
    decisionType: 'classification',
    confidence,
    createdAt: '2025-09-01T00:00:00.000Z',
    payload: { assetClass, sector },
    outcome: realizedReturn === undefined ? null : { realizedReturn },
  };
}

describe('decisionHit', () => {
  it('scores a bullish public read as a hit on a positive 90d return', () => {
    expect(decisionHit(publicScore('a', 'bullish', 0.1, 0.8))).toBe(true);
    expect(decisionHit(publicScore('b', 'bullish', -0.1, 0.8))).toBe(false);
  });
  it('scores a bearish public read as a hit on a negative 90d return', () => {
    expect(decisionHit(publicScore('c', 'bearish', -0.1, 0.8))).toBe(true);
  });
  it('returns null for neutral direction and for unresolved decisions', () => {
    expect(decisionHit(publicScore('d', 'neutral', 0.1, 0.8))).toBeNull();
    expect(decisionHit(publicScore('e', 'bullish', undefined, 0.8))).toBeNull();
  });
  it('treats TACTICAL as a hit regardless of direction', () => {
    expect(decisionHit(classification('f', 'TACTICAL', -0.3, 0.5))).toBe(true);
    expect(decisionHit(classification('g', 'CORE', -0.3, 0.5))).toBe(false);
    expect(decisionHit(classification('h', 'AVOID', -0.3, 0.5))).toBe(true);
  });
  it('scores private valuation hit on ±25% band', () => {
    const within: Decision = {
      id: 'p1',
      decisionType: 'private_valuation',
      confidence: 0.6,
      createdAt: '2025-09-01T00:00:00.000Z',
      payload: { methods: [{ method: 'DCF', confidence: 0.7, weight: 0.5 }] },
      outcome: { originalBase: 100, currentBase: 110, deltaPct: 0.1 },
    };
    expect(decisionHit(within)).toBe(true);
    expect(decisionHit({ ...within, outcome: { deltaPct: 0.4 } })).toBe(false);
  });
});

describe('computeHitRate', () => {
  it('excludes unresolved and neutral decisions from the denominator', () => {
    const decisions = [
      publicScore('a', 'bullish', 0.1, 0.8), // hit
      publicScore('b', 'bullish', -0.1, 0.8), // miss
      publicScore('c', 'neutral', 0.1, 0.8), // excluded
      publicScore('d', 'bullish', undefined, 0.8), // excluded (unresolved)
    ];
    expect(computeHitRate(decisions)).toEqual({ hitRate: 0.5, sampleSize: 2 });
  });
});

describe('computeBrierScore', () => {
  it('is 0 for perfect confident predictions', () => {
    const decisions = [publicScore('a', 'bullish', 0.1, 1), publicScore('b', 'bearish', -0.1, 1)];
    expect(computeBrierScore(decisions).brier).toBeCloseTo(0, 6);
  });
  it('is 0.25 for coin-flip confidence on a 50/50 split', () => {
    const decisions = [publicScore('a', 'bullish', 0.1, 0.5), publicScore('b', 'bullish', -0.1, 0.5)];
    expect(computeBrierScore(decisions).brier).toBeCloseTo(0.25, 6);
  });
});

describe('computeReliabilityCurve', () => {
  it('returns the requested number of bins with midpoints as expected accuracy', () => {
    const curve = computeReliabilityCurve([publicScore('a', 'bullish', 0.1, 0.85)], 10);
    expect(curve.bins).toHaveLength(10);
    expect(curve.bins[8]!.confidenceBin).toBeCloseTo(0.85, 6);
    expect(curve.bins[8]!.sampleSize).toBe(1);
    expect(curve.bins[8]!.actualAccuracy).toBe(1);
  });
});

describe('computeReturnDistribution', () => {
  it('summarizes realized returns', () => {
    const decisions = [0.1, 0.2, 0.3, 0.4, 0.5].map((r, i) =>
      publicScore(`r${i}`, 'bullish', r, 0.7),
    );
    const dist = computeReturnDistribution(decisions);
    expect(dist.sampleSize).toBe(5);
    expect(dist.median).toBeCloseTo(0.3, 6);
    expect(dist.mean).toBeCloseTo(0.3, 6);
  });
});

describe('bucketBy', () => {
  it('builds composite keys and drops decisions missing a grouping field', () => {
    const decisions = [
      classification('a', 'CORE', 0.1, 0.8, 'technology'),
      classification('b', 'CORE', 0.1, 0.8, 'technology'),
      { ...classification('c', 'CORE', 0.1, 0.8), payload: { assetClass: 'CORE' as const } }, // no sector
    ];
    const buckets = bucketBy(decisions, {
      class: (d) => d.payload.assetClass,
      sector: (d) => d.payload.sector,
    });
    expect(Object.keys(buckets)).toEqual(['CORE × technology']);
    expect(buckets['CORE × technology']).toHaveLength(2);
  });
});

describe('analyzeCalibration', () => {
  it('flags an overconfident class × sector segment above threshold', () => {
    // 60 CORE/technology decisions, all confident 0.9, but only 40% hit.
    const decisions: Decision[] = [];
    for (let i = 0; i < 60; i += 1) {
      const hit = i < 24; // 40% hit rate
      decisions.push(classification(`c${i}`, 'CORE', hit ? 0.1 : -0.1, 0.9, 'technology'));
    }
    const suggestions = analyzeCalibration(decisions);
    const overconf = suggestions.find((s) => s.segment === 'CORE × technology');
    expect(overconf).toBeDefined();
    expect(overconf!.severity).toBe('recommend'); // gap 0.5 > 0.25
    expect(overconf!.sampleSize).toBe(60);
  });

  it('is silent on thin samples', () => {
    const decisions = [classification('a', 'CORE', -0.1, 0.9, 'technology')];
    expect(analyzeCalibration(decisions)).toEqual([]);
    expect(MEANINGFUL_THRESHOLD).toBe(50);
  });
});
