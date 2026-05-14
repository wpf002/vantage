# @vantage/classification

Rule-based engine that rolls a company's harmonized signals into one asset class.

| Class | Trigger |
|-------|---------|
| `CORE` | High confidence (≥0.7), bullish dominance (net ≥2), narrative intact (NIS ≥60) |
| `HIGH_ASYMMETRY` | Bullish with moderate confidence; controlled-downside profile |
| `TACTICAL` | Bullish but Narrative Heat ≥60 — timing-dependent |
| `AVOID` | Bearish-dominant or confidence below floor (<0.3) |

Pure deterministic rules. No ML. `classify()` produces a `ClassificationResult`; `classificationToSignal()` converts to the universal `Signal` schema.
