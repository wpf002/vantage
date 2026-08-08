/**
 * Source reputation decay.
 *
 * Computes the updated credibility score for a source after observing one
 * outcome. Pure function — no DB calls. The API job (updateSourceReputation.ts)
 * handles persistence.
 *
 * Formula (exponential smoothing):
 *   new = (1 - rate) * old + rate * outcome_bonus
 *
 * outcome_bonus = 1.0 if the decision was correct, 0.0 if wrong.
 *
 * The decay_rate is halved for sources with fewer than MIN_SAMPLES_FOR_FULL_DECAY
 * outcomes to reduce noise from early samples.
 */

import { DEFAULT_DECAY_RATE, MIN_SAMPLES_FOR_FULL_DECAY } from './config.js';

export interface SourceState {
  credibilityScore: number; // current [0, 1]
  sampleCount: number;
  correctCount: number;
  decayRate?: number; // override per-source; falls back to DEFAULT_DECAY_RATE
}

export interface SourceStateUpdate {
  credibilityScore: number;
  sampleCount: number;
  correctCount: number;
  historicalReliability: number; // correctCount / sampleCount
}

/**
 * Apply one outcome observation to a source's state and return the new state.
 */
export function applyOutcome(state: SourceState, correct: boolean): SourceStateUpdate {
  const effectiveRate =
    state.sampleCount < MIN_SAMPLES_FOR_FULL_DECAY
      ? (state.decayRate ?? DEFAULT_DECAY_RATE) * 0.5
      : (state.decayRate ?? DEFAULT_DECAY_RATE);

  const outcomebonus = correct ? 1.0 : 0.0;
  const newCredibility = (1 - effectiveRate) * state.credibilityScore + effectiveRate * outcomebonus;
  const newSampleCount = state.sampleCount + 1;
  const newCorrectCount = state.correctCount + (correct ? 1 : 0);

  return {
    credibilityScore: Math.max(0, Math.min(1, newCredibility)),
    sampleCount: newSampleCount,
    correctCount: newCorrectCount,
    historicalReliability: newCorrectCount / newSampleCount,
  };
}

/**
 * Simulate applying a sequence of outcomes to a source, returning the final
 * state. Used in the backtest to replay history.
 */
export function replayOutcomes(
  initialState: SourceState,
  outcomes: boolean[],
): SourceStateUpdate {
  let state: SourceState = { ...initialState };
  let last: SourceStateUpdate = {
    credibilityScore: state.credibilityScore,
    sampleCount: state.sampleCount,
    correctCount: state.correctCount,
    historicalReliability: state.sampleCount > 0
      ? state.correctCount / state.sampleCount
      : 0.65,
  };
  for (const correct of outcomes) {
    last = applyOutcome(state, correct);
    state = {
      ...state,
      credibilityScore: last.credibilityScore,
      sampleCount: last.sampleCount,
      correctCount: last.correctCount,
    };
  }
  return last;
}
