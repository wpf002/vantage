/**
 * Centralized constants. Every magic number lives here so audit trails
 * can reference them by name and version bumps are intentional.
 */

export const ENGINE_VERSIONS = {
  CORE_PRIVATE: '0.1.0',
  CORE_PUBLIC: '0.1.0',
  HARMONIZER: '0.1.0',
  CLASSIFICATION: '0.1.0',
  PORTFOLIO: '0.1.0',
  SIMULATION: '0.1.0',
  EXPLANATION: '0.1.0',
} as const;

/**
 * Public Score weights — see project description.
 *   Public Score = 0.45 × Expectation Gap
 *                + 0.35 × (100 − Narrative Integrity)
 *                + 0.20 × Narrative Heat
 */
export const PUBLIC_SCORE_WEIGHTS = {
  expectationGap: 0.45,
  narrativeIntegrityInverse: 0.35,
  narrativeHeat: 0.2,
} as const;

/**
 * Shape of the Public Score blend weights. The constants above are the static
 * defaults / cold-start values; the nightly calibration loop learns new weights
 * from graded outcomes and the scorer accepts them via this type.
 */
export type PublicScoreWeights = {
  expectationGap: number;
  narrativeIntegrityInverse: number;
  narrativeHeat: number;
};

/**
 * Default per-stage weights for the private blend. Tunable per company.
 * Order: [DCF, Comps, LBO]. ML adjusts on top of the blend.
 */
export const PRIVATE_STAGE_WEIGHTS: Record<string, [number, number, number]> = {
  seed: [0.1, 0.8, 0.1],
  series_a: [0.15, 0.75, 0.1],
  series_b: [0.2, 0.65, 0.15],
  series_c_plus: [0.3, 0.5, 0.2],
  pre_ipo: [0.4, 0.3, 0.3],
};

/**
 * Confidence floor — below this, a method is excluded from the blend.
 */
export const CONFIDENCE_FLOOR = 0.3;

/**
 * Illiquidity discount applied to public comp multiples when valuing privates.
 */
export const ILLIQUIDITY_DISCOUNT = 0.25;
