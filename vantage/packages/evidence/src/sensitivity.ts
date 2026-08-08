/**
 * Sensitivity analysis for divergence layers.
 *
 * For a set of signals that jointly produce a layer score, computes which
 * single signal's removal would most change that score. Pure function.
 *
 * Algorithm: jackknife (leave-one-out).
 *   - Compute the baseline score with all signals included.
 *   - For each signal i, recompute the score without signal i.
 *   - Sensitivity[i] = |baseline - score_without_i|
 *
 * The score function is caller-provided — sensitivity.ts doesn't know or
 * care how EGS, NIS, or NHS compute their values; it just holds a slot open
 * and re-runs the caller's function N times.
 */

export interface SignalInput {
  id: string;
  value: number;  // the numeric contribution of this signal to the layer (e.g. component score)
  weight: number; // its weight in the weighted sum
}

export interface SensitivityResult {
  /** delta_if_removed per signal id */
  sensitivity: Record<string, number>;
  /** signal id whose removal changes the score the most */
  maxSensitivitySignalId: string | undefined;
  /** magnitude of that change */
  maxSensitivityDelta: number;
}

/**
 * Compute sensitivity for a weighted-average score.
 *
 * `inputs` is a list of (id, value, weight) triplets.
 * The baseline score is: sum(value_i * weight_i) / sum(weight_i).
 *
 * For each input, we remove it and recompute the weighted average over
 * the remaining inputs.
 */
export function computeWeightedAverageSensitivity(inputs: SignalInput[]): SensitivityResult {
  const sensitivity: Record<string, number> = {};

  if (inputs.length === 0) {
    return { sensitivity, maxSensitivitySignalId: undefined, maxSensitivityDelta: 0 };
  }

  const totalWeight = inputs.reduce((s, i) => s + i.weight, 0);
  const baseline =
    totalWeight === 0
      ? inputs.reduce((s, i) => s + i.value, 0) / inputs.length
      : inputs.reduce((s, i) => s + i.value * i.weight, 0) / totalWeight;

  for (const removed of inputs) {
    const remaining = inputs.filter((i) => i.id !== removed.id);
    let score: number;
    if (remaining.length === 0) {
      score = 0; // removing the only input → zero
    } else {
      const remWeight = remaining.reduce((s, i) => s + i.weight, 0);
      score =
        remWeight === 0
          ? remaining.reduce((s, i) => s + i.value, 0) / remaining.length
          : remaining.reduce((s, i) => s + i.value * i.weight, 0) / remWeight;
    }
    sensitivity[removed.id] = Math.abs(baseline - score);
  }

  let maxId: string | undefined;
  let maxDelta = 0;
  for (const [id, delta] of Object.entries(sensitivity)) {
    if (delta > maxDelta) {
      maxDelta = delta;
      maxId = id;
    }
  }

  return {
    sensitivity,
    maxSensitivitySignalId: maxId,
    maxSensitivityDelta: maxDelta,
  };
}

/**
 * Compute sensitivity via a caller-provided recompute function.
 *
 * Used when the layer score is not a simple weighted average (e.g. EGS has
 * its own internal logic). The caller provides a function that takes a subset
 * of inputs and returns the recomputed layer score.
 */
export function computeFunctionSensitivity(
  inputs: Array<{ id: string }>,
  recompute: (subset: string[]) => number,
): SensitivityResult {
  const sensitivity: Record<string, number> = {};

  if (inputs.length === 0) {
    return { sensitivity, maxSensitivitySignalId: undefined, maxSensitivityDelta: 0 };
  }

  const allIds = inputs.map((i) => i.id);
  const baseline = recompute(allIds);

  for (const removed of inputs) {
    const remaining = allIds.filter((id) => id !== removed.id);
    const score = remaining.length === 0 ? 0 : recompute(remaining);
    sensitivity[removed.id] = Math.abs(baseline - score);
  }

  let maxId: string | undefined;
  let maxDelta = 0;
  for (const [id, delta] of Object.entries(sensitivity)) {
    if (delta > maxDelta) {
      maxDelta = delta;
      maxId = id;
    }
  }

  return {
    sensitivity,
    maxSensitivitySignalId: maxId,
    maxSensitivityDelta: maxDelta,
  };
}
