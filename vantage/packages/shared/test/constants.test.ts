import { describe, it, expect } from 'vitest';
import {
  PUBLIC_SCORE_WEIGHTS,
  CLASSIFICATION_THRESHOLDS,
  PRIVATE_STAGE_WEIGHTS,
  CONFIDENCE_FLOOR,
  ILLIQUIDITY_DISCOUNT,
} from '../src/constants.js';

describe('PUBLIC_SCORE_WEIGHTS', () => {
  it('weights sum to 1.0', () => {
    const { expectationGap, narrativeIntegrityInverse, narrativeHeat } = PUBLIC_SCORE_WEIGHTS;
    expect(expectationGap + narrativeIntegrityInverse + narrativeHeat).toBeCloseTo(1.0);
  });

  it('expectation gap has the highest weight', () => {
    expect(PUBLIC_SCORE_WEIGHTS.expectationGap).toBeGreaterThan(
      PUBLIC_SCORE_WEIGHTS.narrativeIntegrityInverse,
    );
    expect(PUBLIC_SCORE_WEIGHTS.expectationGap).toBeGreaterThan(
      PUBLIC_SCORE_WEIGHTS.narrativeHeat,
    );
  });
});

describe('CLASSIFICATION_THRESHOLDS', () => {
  it('core floor is above avoid floor', () => {
    expect(CLASSIFICATION_THRESHOLDS.coreConfidenceFloor).toBeGreaterThan(
      CLASSIFICATION_THRESHOLDS.avoidConfidenceFloor,
    );
  });

  it('floors are in [0, 1]', () => {
    expect(CLASSIFICATION_THRESHOLDS.coreConfidenceFloor).toBeGreaterThan(0);
    expect(CLASSIFICATION_THRESHOLDS.coreConfidenceFloor).toBeLessThanOrEqual(1);
    expect(CLASSIFICATION_THRESHOLDS.avoidConfidenceFloor).toBeGreaterThan(0);
    expect(CLASSIFICATION_THRESHOLDS.avoidConfidenceFloor).toBeLessThanOrEqual(1);
  });
});

describe('PRIVATE_STAGE_WEIGHTS', () => {
  it('each stage has three method weights that sum to 1', () => {
    for (const [stage, weights] of Object.entries(PRIVATE_STAGE_WEIGHTS)) {
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum, `${stage} weights should sum to 1`).toBeCloseTo(1.0);
    }
  });

  it('DCF weight grows with company maturity', () => {
    expect(PRIVATE_STAGE_WEIGHTS.pre_ipo![0]).toBeGreaterThan(
      PRIVATE_STAGE_WEIGHTS.seed![0]!,
    );
  });
});

describe('CONFIDENCE_FLOOR', () => {
  it('is between 0 and 1 exclusive', () => {
    expect(CONFIDENCE_FLOOR).toBeGreaterThan(0);
    expect(CONFIDENCE_FLOOR).toBeLessThan(1);
  });
});

describe('ILLIQUIDITY_DISCOUNT', () => {
  it('is a meaningful discount (10–50%)', () => {
    expect(ILLIQUIDITY_DISCOUNT).toBeGreaterThanOrEqual(0.1);
    expect(ILLIQUIDITY_DISCOUNT).toBeLessThanOrEqual(0.5);
  });
});
