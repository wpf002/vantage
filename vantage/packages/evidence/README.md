# @vantage/evidence

Evidence quality scoring, source reputation decay, and reasoning path capture for the Vantage divergence index.

## What problem this solves

The divergence index combines EGS + NIS + NHS into a Public Score. Every input to those layers is treated as equally credible. A Reuters newswire item and a Reddit scrape both shift the narrative heat score by the same amount. A stale analyst estimate from 11 months ago weighs the same as a fresh earnings release. If a signal fires on a single wire story that five outlets reprinted from the same press release, that's not five independent data points — it's one.

This package puts numbers on those differences and makes the scores traceable.

## Concepts

### Evidence Quality

For every harmonized signal feeding the divergence index, five components are scored:

| Component | What it measures | Default weight |
|---|---|---|
| `source_credibility` | Current reputation of the source, updated from realized outcomes | 0.25 |
| `recency` | How old is the underlying data? Decays by source-type-specific halflife | 0.20 |
| `independence` | Is this signal independent, or N outlets reprinting one wire? | 0.15 |
| `methodological_strength` | Robustness of the method that produced this signal | 0.25 |
| `historical_reliability` | Empirical hit rate of this source against past outcomes | 0.15 |

Composite score: weighted sum of all five, range [0, 1].

Weights are configurable via `EVIDENCE_WEIGHTS_JSON` env var (JSON object with the five keys, must sum to 1.0).

### Source Credibility Seeds

Initial credibility per source type:

| Source key pattern | Type | Initial credibility | Methodological strength |
|---|---|---|---|
| `fmp:market_data` | Market data | 0.85 | 0.90 |
| `fmp:earnings` | Earnings | 0.80 | 0.80 |
| `fmp:analyst_estimate` | Analyst estimate | 0.65 | 0.65 |
| `sec:filing` | SEC filing | 0.85 | 0.85 |
| `news:wire` | News wire | 0.60 | 0.50 |
| `news:blog` | Blog / unverified | 0.40 | 0.35 |
| `alt_data:*` | Alternative data | 0.55 | 0.60 |
| `ml:*` | ML model output | 0.50 | 0.50 |

### Recency Decay

Score = `max(0, 1 - (days_old / halflife))`, clamped to [0, 1]:

| Source type | Halflife (days) | Rationale |
|---|---|---|
| `fmp:market_data` | 1 | Stale within hours |
| `news:*` | 7 | News cycle |
| `fmp:analyst_estimate` | 30 | Revised monthly |
| `fmp:earnings`, `sec:filing` | 90 | Quarterly cycle |
| `alt_data:*` | 14 | Mid-term signal |

### Independence

Independence detects when multiple signals encode the same underlying fact:

- **Primary source** (SEC filing, direct market observation): 1.0
- **Wire story, single outlet**: 0.85
- **Wire story, N outlets within 24h**: `1 / sqrt(N)` — three outlets = 0.577
- **Derived signal** (computed from another signal in the same run): 0.70
- **Consensus estimate** (average of multiple analysts): 0.60

The system detects correlated signals by grouping on `(entity, signalType, date_bucket)` and applying the N-outlet formula when count > 1.

### Source Reputation Decay

When `outcomeCapture` grades a decision, it looks up which signals fed that decision via `reasoning_paths`, identifies their source keys via `evidence_quality`, and updates:

```
credibility_score_new = (1 - decay_rate) * credibility_score_old + decay_rate * outcome_bonus
```

Where `outcome_bonus = 1.0` if the decision was correct, `0.0` if wrong.

Default `decay_rate = 0.05` — a source needs roughly 20 graded outcomes to move its credibility score by half. Sources with `sample_count < 5` use a dampened rate of `decay_rate * 0.5` to prevent early-sample noise from overcorrecting.

Historical reliability in the quality composite = `correct_count / max(1, sample_count)`, initialized to 0.65 (moderate prior, no data).

### Reasoning Path

For every divergence signal, a `reasoning_paths` row captures:

```
{
  layer:            'egs' | 'nis' | 'nhs' | 'composite' | 'classification'
  layer_score:      numeric value at this layer
  threshold_key:    e.g. 'divergenceHigh', 'coreConfidenceFloor'
  threshold_value:  numeric value of the threshold
  fired:            did this layer trigger the signal?
  input_signal_ids: UUIDs of platform_signals that fed this layer
  quality_scores:   { signal_id → composite_quality_score }
  composite_quality: weighted avg quality across all inputs
  sensitivity:      { signal_id → delta_if_removed }
  max_sensitivity_signal_id: which single signal, if removed, changes the score most
  max_sensitivity_delta:     by how much
}
```

Sensitivity is computed by jackknife: remove one signal, recompute the layer score, record the absolute delta. The signal with the largest delta is the most influential input.

### Backtest

`backtestReputation.ts` replays source reputation updates chronologically over all graded `platform_decisions`, then compares:
- Unweighted signal accuracy (current system)
- Quality-weighted signal accuracy (each signal's contribution scaled by composite quality)

It does **not** change any live data. It produces a report. Reputation decay is only wired live after the backtest shows improvement.

## Scoring is additive and observable

Quality scores are stored alongside signals but **do not change the divergence index thresholds** or the Public Score formula in Phase 1. They are observable — visible in the Track Record UI and queryable via `/v1/meta` — so the team can evaluate them before enabling quality-weighted scoring.

The flag `EVIDENCE_QUALITY_WEIGHT_SIGNALS=1` gates quality-weighted scoring. Off by default until backtest validates.

## Tuning weights

1. Change `EVIDENCE_WEIGHTS_JSON` env var (JSON object). The package validates that weights sum to 1.0 and all keys are present.
2. Or override per-source via `evidence_sources.credibility_score` in the DB.

To retrain from scratch: set `correct_count = 0`, `sample_count = 0` for any source, and the system reverts to the initial credibility seed.
