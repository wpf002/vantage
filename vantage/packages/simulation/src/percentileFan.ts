import type { AssetAssumption, MonteCarloResult } from './index.js';

/**
 * Per-year percentile fan for the Monte Carlo chart.
 *
 * Phase 6 only — the existing runMonteCarlo returns endpoint percentiles, but
 * the editorial result page needs per-year p05/p25/p50/p75/p95 so the fan can
 * be drawn. Implementation mirrors runMonteCarlo's PRNG and assumptions so
 * a fan computed alongside a result is dimensionally consistent.
 *
 * Per-asset independence still applies (no covariance matrix) — same caveat
 * carried forward from Phase 1.
 */

export interface FanInputs {
  allocations: Array<{ entity: string; weight: number }>;
  assumptions: AssetAssumption[];
  horizonYears: number;
  paths: number;
  seed?: number;
}

export interface FanPoint {
  year: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

/** Mulberry32 — kept in sync with the engine implementation. */
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

function randn(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function computePercentileFan(input: FanInputs): FanPoint[] {
  const assumByEntity = new Map(input.assumptions.map((a) => [a.entity, a]));

  const portfolioMu = input.allocations.reduce((acc, a) => {
    const ass = assumByEntity.get(a.entity);
    return acc + a.weight * (ass?.annualReturn ?? 0);
  }, 0);
  const portfolioVar = input.allocations.reduce((acc, a) => {
    const ass = assumByEntity.get(a.entity);
    return acc + (a.weight * (ass?.annualVol ?? 0)) ** 2;
  }, 0);
  const portfolioSigma = Math.sqrt(portfolioVar);

  const rand = input.seed !== undefined ? mulberry32(input.seed) : Math.random;
  const paths = input.paths;
  const years = input.horizonYears;

  // valuesByYear[y] is the array of path values at the end of year y.
  // year 0 is t=now (every path == 1). We keep that row so the fan visually
  // starts at parity and fans out from there.
  const valuesByYear: number[][] = Array.from({ length: years + 1 }, () => new Array<number>(paths));
  for (let p = 0; p < paths; p++) {
    valuesByYear[0]![p] = 1;
  }
  for (let p = 0; p < paths; p++) {
    let value = 1;
    for (let y = 1; y <= years; y++) {
      const z = randn(rand);
      const r = portfolioMu + portfolioSigma * z;
      value *= 1 + r;
      valuesByYear[y]![p] = value;
    }
  }

  const fan: FanPoint[] = [];
  for (let y = 0; y <= years; y++) {
    const sorted = valuesByYear[y]!.slice().sort((a, b) => a - b);
    fan.push({
      year: y,
      p05: pickPercentile(sorted, 0.05) - 1,
      p25: pickPercentile(sorted, 0.25) - 1,
      p50: pickPercentile(sorted, 0.5) - 1,
      p75: pickPercentile(sorted, 0.75) - 1,
      p95: pickPercentile(sorted, 0.95) - 1,
    });
  }
  return fan;
}

function pickPercentile(sortedAsc: number[], p: number): number {
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx]!;
}

/**
 * Convenience type tying a MonteCarloResult to its fan. The persistence layer
 * stores `{ result, fan }` together as the simulation outputs blob.
 */
export interface MonteCarloOutputs {
  result: MonteCarloResult;
  fan: FanPoint[];
}
