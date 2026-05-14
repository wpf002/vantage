# @vantage/core-public

Public-equity reality-gap detector. Computes three layers and combines them into a single Public Score, then emits one of eight signal labels.

## Formula

```
Public Score = 0.45 × Expectation Gap
             + 0.35 × (100 − Narrative Integrity)
             + 0.20 × Narrative Heat
```

## Layers

| Layer | Path | Measures |
|---|---|---|
| Expectation Gap (EGS) | `egs/` | EPS / revenue surprise vs consensus + price confirmation |
| Narrative Integrity (NIS) | `nis/` | Whether the dominant narrative matches segment-level data |
| Narrative Heat (NHS) | `nhs/` | Whether sentiment is running ahead of fundamentals |

## Eight labels

See `src/labels.ts` for the full taxonomy:

| Band | Bullish | Bearish |
|------|---------|---------|
| 0–25 | Aligned Strength | Expected Weakness |
| 26–45 | Validated Story | Temporary Relief |
| 46–65 | (Cracks Forming) | Story on Thin Ice |
| 66+ | Market Underreaction | Narrative Breakdown |

`computePublicScore()` returns the score + label + components. `publicScoreToSignal()` converts to the universal `Signal` schema for the harmonizer.
