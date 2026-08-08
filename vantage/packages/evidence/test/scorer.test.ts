import { describe, it, expect } from 'vitest';
import { computeEvidenceQuality, computeRecencyScore, computeIndependenceScore } from '../src/scorer.js';
import { DEFAULT_WEIGHTS } from '../src/config.js';
import type { SourceContext } from '../src/types.js';

const TODAY = '2026-08-07';
const AS_OF = new Date('2026-08-07T12:00:00Z');

function ctx(overrides: Partial<SourceContext>): SourceContext {
  return {
    sourceKey: 'fmp:market_data',
    dataDate: TODAY,
    outletCount: 1,
    isDerived: false,
    ...overrides,
  };
}

describe('computeRecencyScore()', () => {
  it('returns 1.0 for data from today on a market_data source', () => {
    const score = computeRecencyScore('fmp:market_data', TODAY, AS_OF);
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('returns floor for data older than the halflife', () => {
    const oldDate = '2025-01-01'; // far in the past
    const score = computeRecencyScore('fmp:earnings', oldDate, AS_OF);
    expect(score).toBeGreaterThanOrEqual(0.05);
    expect(score).toBeLessThan(0.5); // significantly decayed
  });

  it('decays faster for news sources than earnings sources', () => {
    const weekAgo = '2026-07-31';
    const newsScore = computeRecencyScore('news:wire', weekAgo, AS_OF);
    const earningsScore = computeRecencyScore('fmp:earnings', weekAgo, AS_OF);
    expect(earningsScore).toBeGreaterThan(newsScore);
  });

  it('returns floor (not negative) for very old data', () => {
    const score = computeRecencyScore('news:wire', '2020-01-01', AS_OF);
    expect(score).toBeGreaterThanOrEqual(0.05);
  });

  it('returns floor for invalid date', () => {
    const score = computeRecencyScore('fmp:market_data', 'not-a-date', AS_OF);
    expect(score).toBe(0.05);
  });
});

describe('computeIndependenceScore()', () => {
  it('returns 1.0 for a primary source (SEC) with one outlet', () => {
    const score = computeIndependenceScore(ctx({ sourceKey: 'sec:10k', outletCount: 1 }));
    expect(score).toBe(1.0);
  });

  it('returns 1.0 for market_data with one outlet', () => {
    const score = computeIndependenceScore(ctx({ sourceKey: 'fmp:market_data', outletCount: 1 }));
    expect(score).toBe(1.0);
  });

  it('returns 0.85 for a news wire with single outlet', () => {
    const score = computeIndependenceScore(ctx({ sourceKey: 'news:wire', outletCount: 1 }));
    expect(score).toBeCloseTo(0.85, 2);
  });

  it('returns 1/sqrt(N) for N news outlets', () => {
    const score = computeIndependenceScore(ctx({ sourceKey: 'news:wire', outletCount: 4 }));
    expect(score).toBeCloseTo(0.5, 2); // 1/sqrt(4)
  });

  it('returns 0.70 for derived signals', () => {
    const score = computeIndependenceScore(ctx({ isDerived: true }));
    expect(score).toBe(0.70);
  });

  it('clamps to minimum 0.15 for very many outlets', () => {
    const score = computeIndependenceScore(ctx({ sourceKey: 'news:wire', outletCount: 100 }));
    expect(score).toBeGreaterThanOrEqual(0.15);
  });
});

describe('computeEvidenceQuality()', () => {
  it('returns a composite in [0, 1]', () => {
    const q = computeEvidenceQuality(ctx({}), DEFAULT_WEIGHTS, AS_OF);
    expect(q.compositeScore).toBeGreaterThanOrEqual(0);
    expect(q.compositeScore).toBeLessThanOrEqual(1);
  });

  it('returns all five component scores', () => {
    const q = computeEvidenceQuality(ctx({}), DEFAULT_WEIGHTS, AS_OF);
    expect(q.sourceCredibility).toBeGreaterThan(0);
    expect(q.recencyScore).toBeGreaterThan(0);
    expect(q.independenceScore).toBeGreaterThan(0);
    expect(q.methodologicalStrength).toBeGreaterThan(0);
    expect(q.historicalReliability).toBeGreaterThan(0);
  });

  it('fmp:market_data (fresh, SEC-level) scores higher than news:blog (stale)', () => {
    const high = computeEvidenceQuality(
      ctx({ sourceKey: 'fmp:market_data', dataDate: TODAY }),
      DEFAULT_WEIGHTS,
      AS_OF,
    );
    const low = computeEvidenceQuality(
      ctx({ sourceKey: 'news:blog', dataDate: '2026-01-01', outletCount: 10 }),
      DEFAULT_WEIGHTS,
      AS_OF,
    );
    expect(high.compositeScore).toBeGreaterThan(low.compositeScore);
  });

  it('stored credibility overrides the initial seed', () => {
    const qDefault = computeEvidenceQuality(ctx({ sourceKey: 'fmp:market_data' }), DEFAULT_WEIGHTS, AS_OF);
    const qLow = computeEvidenceQuality(
      ctx({ sourceKey: 'fmp:market_data', storedCredibility: 0.20 }),
      DEFAULT_WEIGHTS,
      AS_OF,
    );
    expect(qLow.compositeScore).toBeLessThan(qDefault.compositeScore);
    expect(qLow.sourceCredibility).toBeCloseTo(0.20, 4);
  });

  it('empirical hit rate 1.0 improves composite vs default prior', () => {
    const qDefault = computeEvidenceQuality(ctx({}), DEFAULT_WEIGHTS, AS_OF);
    const qPerfect = computeEvidenceQuality(
      ctx({ empiricalHitRate: 1.0 }),
      DEFAULT_WEIGHTS,
      AS_OF,
    );
    expect(qPerfect.compositeScore).toBeGreaterThan(qDefault.compositeScore);
  });

  it('composite equals weighted sum of components', () => {
    const q = computeEvidenceQuality(ctx({}), DEFAULT_WEIGHTS, AS_OF);
    const expected =
      DEFAULT_WEIGHTS.source_credibility * q.sourceCredibility +
      DEFAULT_WEIGHTS.recency * q.recencyScore +
      DEFAULT_WEIGHTS.independence * q.independenceScore +
      DEFAULT_WEIGHTS.methodological_strength * q.methodologicalStrength +
      DEFAULT_WEIGHTS.historical_reliability * q.historicalReliability;
    expect(q.compositeScore).toBeCloseTo(expected, 6);
  });
});
