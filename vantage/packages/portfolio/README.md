# @vantage/portfolio

Sleeve-based portfolio construction with hard constraints.

## Sleeves

| Sleeve | Source | Purpose |
|--------|--------|---------|
| `core` | CORE-classified assets | Stability + compounding |
| `growth` | HIGH_ASYMMETRY assets | Upside capture |
| `defensive` | Hedges | Downside control |
| `tactical` | TACTICAL assets | Short-duration positioning |

## Constraints (defaults)

- `maxAssetWeight` 10%
- `maxSectorWeight` 25%
- `minCrossSectorCount` 4
- Sleeve targets: core 50% / growth 25% / defensive 15% / tactical 10%

## Algorithm

Greedy fill per sleeve in descending conviction order. Sector cap binds immediately; underfilled sleeves leave a cash residual and emit a warning. No optimizer in Phase 1 — pure deterministic allocation.

`constructPortfolio(candidates, constraints?)` returns a `PortfolioResult` with allocations, sleeve weights, cash, warnings, and the constraint set used.
