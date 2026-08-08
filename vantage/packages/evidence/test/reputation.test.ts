import { describe, it, expect } from 'vitest';
import { applyOutcome, replayOutcomes } from '../src/reputation.js';
import { DEFAULT_DECAY_RATE, MIN_SAMPLES_FOR_FULL_DECAY } from '../src/config.js';

describe('applyOutcome()', () => {
  it('correct outcome increases credibility', () => {
    const before = { credibilityScore: 0.60, sampleCount: 10, correctCount: 6 };
    const after = applyOutcome(before, true);
    expect(after.credibilityScore).toBeGreaterThan(0.60);
  });

  it('incorrect outcome decreases credibility', () => {
    const before = { credibilityScore: 0.60, sampleCount: 10, correctCount: 6 };
    const after = applyOutcome(before, false);
    expect(after.credibilityScore).toBeLessThan(0.60);
  });

  it('increments sample_count and correct_count correctly', () => {
    const before = { credibilityScore: 0.70, sampleCount: 5, correctCount: 3 };
    const afterCorrect = applyOutcome(before, true);
    expect(afterCorrect.sampleCount).toBe(6);
    expect(afterCorrect.correctCount).toBe(4);

    const afterWrong = applyOutcome(before, false);
    expect(afterWrong.sampleCount).toBe(6);
    expect(afterWrong.correctCount).toBe(3);
  });

  it('uses half decay rate for low sample count', () => {
    const fewSamples = { credibilityScore: 0.70, sampleCount: MIN_SAMPLES_FOR_FULL_DECAY - 1, correctCount: 2 };
    const manySamples = { credibilityScore: 0.70, sampleCount: MIN_SAMPLES_FOR_FULL_DECAY, correctCount: 4 };

    const fewDelta = Math.abs(applyOutcome(fewSamples, true).credibilityScore - 0.70);
    const manyDelta = Math.abs(applyOutcome(manySamples, true).credibilityScore - 0.70);

    // fewer samples → smaller delta (half rate)
    expect(fewDelta).toBeLessThan(manyDelta);
  });

  it('credibility is clamped to [0, 1]', () => {
    const veryLow = { credibilityScore: 0.001, sampleCount: 20, correctCount: 0 };
    const after = applyOutcome(veryLow, false);
    expect(after.credibilityScore).toBeGreaterThanOrEqual(0);
    expect(after.credibilityScore).toBeLessThanOrEqual(1);
  });

  it('historicalReliability = correctCount / sampleCount', () => {
    const state = { credibilityScore: 0.65, sampleCount: 10, correctCount: 7 };
    const after = applyOutcome(state, true);
    expect(after.historicalReliability).toBeCloseTo(8 / 11, 6);
  });

  it('converges toward 1.0 for a perfectly reliable source', () => {
    let state = { credibilityScore: 0.5, sampleCount: 0, correctCount: 0 };
    for (let i = 0; i < 100; i++) {
      state = { ...state, ...applyOutcome(state, true) };
    }
    expect(state.credibilityScore).toBeGreaterThan(0.90);
  });

  it('converges toward 0 for a completely unreliable source', () => {
    let state = { credibilityScore: 0.8, sampleCount: 0, correctCount: 0 };
    for (let i = 0; i < 100; i++) {
      state = { ...state, ...applyOutcome(state, false) };
    }
    expect(state.credibilityScore).toBeLessThan(0.10);
  });
});

describe('replayOutcomes()', () => {
  it('replaying zero outcomes returns the initial state', () => {
    const initial = { credibilityScore: 0.70, sampleCount: 5, correctCount: 3 };
    const result = replayOutcomes(initial, []);
    expect(result.credibilityScore).toBe(0.70);
    expect(result.sampleCount).toBe(5);
  });

  it('replaying all-correct sequence is equivalent to applying each individually', () => {
    const initial = { credibilityScore: 0.60, sampleCount: 10, correctCount: 6 };
    const replayed = replayOutcomes(initial, [true, true, true]);
    expect(replayed.sampleCount).toBe(13);
    expect(replayed.correctCount).toBe(9);
    expect(replayed.credibilityScore).toBeGreaterThan(0.60);
  });

  it('mixed sequence → intermediate result', () => {
    const initial = { credibilityScore: 0.65, sampleCount: 10, correctCount: 6 };
    const resultAllCorrect = replayOutcomes(initial, [true, true, true, true]);
    const resultMixed = replayOutcomes(initial, [true, false, true, false]);
    expect(resultAllCorrect.credibilityScore).toBeGreaterThan(resultMixed.credibilityScore);
  });
});
