/**
 * @vantage/evidence — public API.
 *
 * Three concerns:
 *   1. Evidence quality scoring (computeEvidenceQuality)
 *   2. Source reputation decay (applyOutcome, replayOutcomes)
 *   3. Sensitivity analysis (computeWeightedAverageSensitivity, computeFunctionSensitivity)
 *
 * All exports are pure functions. Persistence is the API layer's job.
 */

export type {
  EvidenceWeights,
  EvidenceQuality,
  SourceContext,
  LayerTrace,
  ReasoningPath,
  ReputationUpdate,
  BacktestReport,
} from './types.js';

export {
  computeEvidenceQuality,
  computeRecencyScore,
  computeIndependenceScore,
  aggregateLayerQuality,
} from './scorer.js';

export type { SignalInput, SensitivityResult } from './sensitivity.js';
export {
  computeWeightedAverageSensitivity,
  computeFunctionSensitivity,
} from './sensitivity.js';

export type { SourceState, SourceStateUpdate } from './reputation.js';
export { applyOutcome, replayOutcomes } from './reputation.js';

export {
  DEFAULT_WEIGHTS,
  INITIAL_CREDIBILITY,
  METHODOLOGICAL_STRENGTH,
  RECENCY_HALFLIFE_DAYS,
  DEFAULT_DECAY_RATE,
  DEFAULT_HISTORICAL_RELIABILITY,
  loadWeights,
  lookup,
} from './config.js';
