# @vantage/simulation

Sandbox over a constructed portfolio.

| Primitive | Function | Output |
|-----------|----------|--------|
| Monte Carlo | `runMonteCarlo(inputs)` | Expected return, vol, p05/p25/p50/p75/p95, P(loss) |
| Scenario tree | `evaluateScenarioTree(roots)` | Expected impact + every path's probability |
| Regime switching | `runRegimeSwitching(config)` | Expected return + per-regime occupancy |

Random draws use Box-Muller on a Mulberry32 PRNG. Seeded runs are deterministic — every simulation can be replayed for audit. Phase 1 assumes asset independence in Monte Carlo (no covariance matrix); the public API leaves room for correlated draws in Phase 6.

`monteCarloToSignal()` emits a `platform.simulation_outcome` signal for the harmonizer.
