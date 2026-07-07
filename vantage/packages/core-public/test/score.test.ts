import { describe, it, expect } from 'vitest';
import { computePublicScore } from '../src/score.js';

describe('Public Score — assembly', () => {
  it('classifies a clean beat with confirming price as aligned_strength', () => {
    const r = computePublicScore({
      ticker: 'TEST',
      surpriseSign: 1,
      egs: {
        epsSurprisePct: 0.05,
        revenueSurprisePct: 0.04,
        oneDayReturn: 0.03,
        threeDayReturn: 0.04,
      },
      nis: {
        currentPeriodSegments: [
          { name: 'Core', revenueSharePct: 70, yoyGrowthPct: 25, isNarrativeSegment: true },
          { name: 'Legacy', revenueSharePct: 30, yoyGrowthPct: 5, isNarrativeSegment: false },
        ],
        historicalConsistency: 0.85,
      },
      nhs: {
        priceTargetMoveTrailing90dPct: 5,
        analystUpgradesTrailing90d: 3,
        analystDowngradesTrailing90d: 1,
        priceToRevenueRatio: 8,
        historicalMedianPriceToRevenue: 7.5,
      },
    });
    expect(r.score).toBeLessThanOrEqual(25);
    expect(r.label).toBe('aligned_strength');
    expect(r.direction).toBe('bullish');
  });

  it('flags narrative_breakdown on weak data with hot sentiment', () => {
    const r = computePublicScore({
      ticker: 'HOT',
      surpriseSign: -1,
      egs: {
        epsSurprisePct: -0.15,
        revenueSurprisePct: -0.1,
        oneDayReturn: 0.02,
        threeDayReturn: 0.03,
      },
      nis: {
        currentPeriodSegments: [
          { name: 'AI', revenueSharePct: 20, yoyGrowthPct: 5, isNarrativeSegment: true },
          { name: 'Legacy', revenueSharePct: 80, yoyGrowthPct: -5, isNarrativeSegment: false },
        ],
        historicalConsistency: 0.3,
      },
      nhs: {
        priceTargetMoveTrailing90dPct: 40,
        analystUpgradesTrailing90d: 10,
        analystDowngradesTrailing90d: 1,
        priceToRevenueRatio: 25,
        historicalMedianPriceToRevenue: 8,
      },
    });
    expect(r.score).toBeGreaterThan(40);
    expect(['narrative_breakdown', 'story_on_thin_ice', 'cracks_forming', 'temporary_relief']).toContain(r.label);
    expect(r.direction).toBe('bearish');
  });
});
