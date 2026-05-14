# @vantage/core-private

Pure-logic valuation engine for private companies. DCF + Comps + LBO + weighted blend, with an optional XGBoost adjustment layer surfaced via the `ml-bridge`.

## Modules

| Module | What it does |
|--------|---|
| `dcf/` | FCF projection, CAPM-derived WACC, Gordon Growth terminal value |
| `comps/` | Median EV/Revenue + EV/EBITDA from a peer set, illiquidity discount |
| `lbo/` | Reverse-solves entry price for a target IRR |
| `blend/` | Stage-weighted combination with confidence-based exclusion |
| `ml-bridge/` | Calls Python ML service for the XGBoost SHAP-explained adjustment |

## Confidence-aware blending

If any method's confidence falls below `CONFIDENCE_FLOOR` (0.3 by default — see `@vantage/shared/constants`), it is zeroed out and the remaining weights are renormalized. This is how a heavy-burn AI lab gets valued by Comps alone — DCF zeros itself.

## Golden fixtures

`fixtures/` holds known-good inputs with expected outputs. The test suite runs against these to catch regressions on every commit.

## Output

Every blend produces a `BlendedValuation` which is converted to a `Signal` (via `blendedValuationToSignal`) for the harmonizer.
