import { z } from 'zod';
import { ENGINE_VERSIONS, type Signal } from '@vantage/shared';
import type { Allocation } from '@vantage/portfolio';

export * from './assumptions.js';
export * from './percentileFan.js';

/**
 * Simulation sandbox.
 *
 * Three primitives:
 *   1. Monte Carlo — paths drawn from per-asset μ/σ assumptions
 *   2. Scenario trees — discrete branching (e.g. bull / base / bear) per node
 *   3. Regime-transition — Markov-style regime switching with per-regime params
 *
 * Outputs flow into the decision log and can be re-replayed for audit.
 */

// ─── Monte Carlo ──────────────────────────────────────────────────────────

export const AssetAssumption = z.object({
  entity: z.string(),
  annualReturn: z.number(),
  annualVol: z.number().positive(),
});
export type AssetAssumption = z.infer<typeof AssetAssumption>;

export const MonteCarloInputs = z.object({
  allocations: z.array(
    z.object({
      entity: z.string(),
      weight: z.number().min(0).max(1),
    }),
  ),
  assumptions: z.array(AssetAssumption),
  horizonYears: z.number().int().min(1).max(30),
  paths: z.number().int().min(100).max(100_000).default(10_000),
  seed: z.number().int().optional(),
});
export type MonteCarloInputs = z.infer<typeof MonteCarloInputs>;

export const MonteCarloResult = z.object({
  expectedReturn: z.number(),
  volatility: z.number(),
  percentiles: z.object({
    p05: z.number(),
    p25: z.number(),
    p50: z.number(),
    p75: z.number(),
    p95: z.number(),
  }),
  probabilityOfLoss: z.number().min(0).max(1),
  pathsRun: z.number().int(),
});
export type MonteCarloResult = z.infer<typeof MonteCarloResult>;

/** Box-Muller transform to get a standard-normal draw. */
function randn(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Mulberry32 — small deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runMonteCarlo(input: MonteCarloInputs): MonteCarloResult {
  const v = MonteCarloInputs.parse(input);
  const rand = v.seed !== undefined ? mulberry32(v.seed) : Math.random;
  const assumByEntity = new Map(v.assumptions.map((a) => [a.entity, a]));

  // Portfolio μ and σ (independence assumption for Phase 1)
  const portfolioMu = v.allocations.reduce((acc, a) => {
    const ass = assumByEntity.get(a.entity);
    return acc + a.weight * (ass?.annualReturn ?? 0);
  }, 0);
  const portfolioVar = v.allocations.reduce((acc, a) => {
    const ass = assumByEntity.get(a.entity);
    return acc + (a.weight * (ass?.annualVol ?? 0)) ** 2;
  }, 0);
  const portfolioSigma = Math.sqrt(portfolioVar);

  const endingValues: number[] = [];
  for (let i = 0; i < v.paths; i++) {
    let value = 1;
    for (let y = 0; y < v.horizonYears; y++) {
      const z = randn(rand);
      const r = portfolioMu + portfolioSigma * z;
      value *= 1 + r;
    }
    endingValues.push(value);
  }
  endingValues.sort((a, b) => a - b);

  const pct = (p: number): number =>
    endingValues[Math.min(endingValues.length - 1, Math.floor(p * endingValues.length))]!;
  const mean = endingValues.reduce((a, b) => a + b, 0) / endingValues.length;
  const variance =
    endingValues.reduce((acc, x) => acc + (x - mean) ** 2, 0) / endingValues.length;

  return {
    expectedReturn: mean - 1,
    volatility: Math.sqrt(variance),
    percentiles: {
      p05: pct(0.05) - 1,
      p25: pct(0.25) - 1,
      p50: pct(0.5) - 1,
      p75: pct(0.75) - 1,
      p95: pct(0.95) - 1,
    },
    probabilityOfLoss: endingValues.filter((x) => x < 1).length / endingValues.length,
    pathsRun: v.paths,
  };
}

// ─── Scenario tree ────────────────────────────────────────────────────────

export type ScenarioNode = {
  name: string;
  probability: number;
  impact: number;
  children?: ScenarioNode[];
};
export const ScenarioNode: z.ZodType<ScenarioNode> = z.object({
  name: z.string(),
  probability: z.number().min(0).max(1),
  impact: z.number(), // multiplicative portfolio impact at this node
  children: z.array(z.lazy(() => ScenarioNode)).optional(),
});

export interface ScenarioResult {
  expectedImpact: number;
  pathOutcomes: Array<{ path: string[]; probability: number; impact: number }>;
}

export function evaluateScenarioTree(roots: ScenarioNode[]): ScenarioResult {
  const outcomes: Array<{ path: string[]; probability: number; impact: number }> = [];

  function walk(node: ScenarioNode, parentProb: number, parentImpact: number, path: string[]) {
    const p = parentProb * node.probability;
    const impact = parentImpact * node.impact;
    const newPath = [...path, node.name];
    if (!node.children || node.children.length === 0) {
      outcomes.push({ path: newPath, probability: p, impact });
      return;
    }
    for (const c of node.children) walk(c, p, impact, newPath);
  }
  for (const root of roots) walk(root, 1, 1, []);

  const expected = outcomes.reduce((acc, o) => acc + o.probability * o.impact, 0);
  return { expectedImpact: expected, pathOutcomes: outcomes };
}

// ─── Regime transition (Markov) ───────────────────────────────────────────

export const RegimeConfig = z.object({
  regimes: z.array(z.string()).min(2),
  transitionMatrix: z.array(z.array(z.number().min(0).max(1))), // square, row-stochastic
  regimeReturns: z.record(z.object({ mu: z.number(), sigma: z.number().positive() })),
  initialRegime: z.string(),
  steps: z.number().int().min(1).max(120),
  paths: z.number().int().min(100).max(50_000).default(5_000),
  seed: z.number().int().optional(),
});
export type RegimeConfig = z.infer<typeof RegimeConfig>;

export interface RegimeResult {
  expectedReturn: number;
  regimeOccupancy: Record<string, number>; // % of time in each regime
  pathsRun: number;
}

export function runRegimeSwitching(cfg: RegimeConfig): RegimeResult {
  const v = RegimeConfig.parse(cfg);
  const rand = v.seed !== undefined ? mulberry32(v.seed) : Math.random;
  const idxByRegime = new Map(v.regimes.map((r, i) => [r, i]));

  const occupancyCounts: Record<string, number> = Object.fromEntries(v.regimes.map((r) => [r, 0]));
  let totalReturn = 0;

  for (let p = 0; p < v.paths; p++) {
    let regime = idxByRegime.get(v.initialRegime)!;
    let cumulative = 1;
    for (let s = 0; s < v.steps; s++) {
      const r = v.regimes[regime]!;
      occupancyCounts[r]! += 1;
      const params = v.regimeReturns[r]!;
      const z = randn(rand);
      cumulative *= 1 + params.mu + params.sigma * z;

      // Transition
      const probs = v.transitionMatrix[regime]!;
      const u = rand();
      let acc = 0;
      for (let i = 0; i < probs.length; i++) {
        acc += probs[i]!;
        if (u <= acc) {
          regime = i;
          break;
        }
      }
    }
    totalReturn += cumulative - 1;
  }

  const totalSteps = v.paths * v.steps;
  return {
    expectedReturn: totalReturn / v.paths,
    regimeOccupancy: Object.fromEntries(
      Object.entries(occupancyCounts).map(([r, c]) => [r, c / totalSteps]),
    ),
    pathsRun: v.paths,
  };
}

// ─── Signal emission ──────────────────────────────────────────────────────

export function monteCarloToSignal(portfolioId: string, r: MonteCarloResult): Signal {
  return {
    entity: portfolioId,
    timestamp: new Date().toISOString(),
    signalType: 'platform.simulation_outcome',
    direction: r.expectedReturn > 0 ? 'bullish' : 'bearish',
    magnitude: Math.min(1, Math.abs(r.expectedReturn)),
    confidence: 1 - r.probabilityOfLoss,
    sourceVersion: ENGINE_VERSIONS.SIMULATION,
    transformChain: [
      {
        op: 'platform.simulation.monte_carlo',
        inputs: { pathsRun: r.pathsRun },
        output: { expectedReturn: r.expectedReturn, percentiles: r.percentiles },
        ts: new Date().toISOString(),
      },
    ],
    rationale: `Monte Carlo: E[r]=${(r.expectedReturn * 100).toFixed(1)}%, P(loss)=${(r.probabilityOfLoss * 100).toFixed(1)}%, ${r.pathsRun} paths.`,
    metadata: { percentiles: r.percentiles },
  };
}
