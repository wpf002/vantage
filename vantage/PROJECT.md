# Vantage — Project Description (deployed-state reference)

> This document describes Vantage **as actually built and deployed**. Where the
> top-level `README.md` (notably its build-phase table and meta-learning notes)
> is out of date, treat this file as the source of truth.

## One line

A sector-agnostic financial-intelligence platform that produces auditable
valuations and signals for any company — public or private — and rolls them up
into classifications, portfolios, and simulations. **Mission: replace a 40-hour
analyst Excel workup with a 4-minute, fully auditable tear sheet.**

## The core idea

For any company, Vantage outputs:

- A valuation range (bear / base / bull) or a 0–100 score
- A label from a fixed taxonomy
- A confidence (0–1) reflecting input quality
- A plain-English explanation built from deterministic templates (no LLM in the
  scoring path)
- A complete audit trail — every input, transform, and weight is traceable

Guiding principle: **auditable over impressive; deterministic where it matters.**
LLMs assist (news tagging, private-data research) but never decide a score.

## The two scoring engines

### `core-public` — Public Score (price-vs-fundamentals divergence index)

```
Public Score = 0.45 × Expectation Gap (EGS)
             + 0.35 × (100 − Narrative Integrity (NIS))
             + 0.20 × Narrative Heat (NHS)
```

- **EGS** — did earnings beat/miss expectations, and did the price agree?
- **NIS** — does the segment carrying the growth story have the size/growth to back it?
- **NHS** — how much speculative premium/hype is in the price?

Maps to 8 labels (Aligned Strength, Narrative Breakdown, Market Underreaction,
Story on Thin Ice, …). Data from Financial Modeling Prep (FMP). The blend weights
are now **learned nightly** from outcomes (see Autonomous learning loop).

### `core-private` — Private valuation (weighted blend)

| Method | Stage-tuned weight |
|---|---|
| DCF | 10–40% |
| Comps | 30–80% |
| LBO | 10–30% |
| ML adjustment (XGBoost, SHAP-explained) | layered on top |

Confidence-aware: a method is zeroed out when unreliable for an input (e.g. DCF
on a cash-burning AI lab). Pulls alt-data from SEC EDGAR, GitHub, USPTO, FRED,
BuiltWith, plus a Claude web-search research step.

## Layers above the engines

- **Classification** — rolls an entity's signals into CORE / HIGH_ASYMMETRY /
  TACTICAL / AVOID (rule-based, confidence-gated; floors learned nightly).
- **Portfolio construction** — sleeve allocation (core/growth/defensive/tactical/
  cash) under hard constraints; a nightly system portfolio + personal portfolios.
- **Simulation** — Monte Carlo (10k paths), Scenario Trees, Regime-Switching (Markov).
- **Meta-learning / Track Record** — every decision is logged and graded against
  the realized 30-day price move; hit-rates and calibration surface at `/meta`.
- **Harmonizer** — both engines funnel through one normalized signal schema,
  which is what makes the universal audit trail possible.

## Architecture & stack

pnpm monorepo + Turbo. UI → API → engine packages → Postgres/Redis; `core-private`
also calls the ML service.

| Layer | Choice |
|---|---|
| Languages | TypeScript 5.7, Python 3.12 (ML) |
| API | Fastify 5 + Zod |
| UI | Next.js 15 (App Router) + Tailwind + Recharts |
| DB | PostgreSQL 16 + Drizzle ORM |
| Cache / Queue | Redis 7 + BullMQ |
| ML | Python + FastAPI (XGBoost/SHAP — currently a stub) |
| Auth | NextAuth (sessions in Postgres) |
| Email / Push | Resend + web-push (VAPID, service worker) |

**Packages:** `shared`, `core-public`, `core-private`, `harmonizer`,
`classification`, `portfolio`, `simulation`, `explanation`, `data-ingest`, `api`,
`ui`, `cli` (+ a `conversational` package that is scaffolded but **not wired into
the UI**). **Services:** `ml-service`. **Infra:** Drizzle migrations + seed
fixtures, Docker Compose for local dev.

## Data model (Postgres, Drizzle)

Key tables: `platform_companies` (the universe), `public_scores` +
`public_egs/nis/nhs` + `public_segments` + `public_narrative_tags`,
`platform_classifications`, `platform_signals`, `platform_decisions` (the graded
decision log), `scoring_weights` + `classification_thresholds` (the learned
values), `portfolios`, `watchlists`, `alerts`, `users`/`sessions`.

## Automation (nightly cron pipeline, UTC)

| Time | Job |
|---|---|
| Sun 23:00 | Universe load (refresh ~3,000-name Russell-3000 approx. from FMP) |
| 01:00 | Universe score (re-score every public ticker) |
| 02:00 | System portfolio rebuild |
| 03:00 | Outcome capture (grade matured decisions vs realized returns) |
| 04:00 | Calibrate weights + classification thresholds (the learning step) |
| Sun 14:00 | Weekly progress email (Resend) |
| every 15 min | Morning-digest alert sweep |
| (queue) | News-assisted narrative tagging |

Plus reactive alerts: the harmonize worker publishes each new signal to a Redis
channel; an evaluator fans out to web push + email (label changes, score moves,
classification transitions).

## The autonomous-learning loop

Vantage was previously measurement-only — it graded its own calls but never
adjusted. It is now a **partial closed loop**:

- Nightly, it re-weights the Public Score components (EGS/NIS/NHS) by how well
  each actually predicted returns → writes `scoring_weights`; the scorer reads them.
- The same pattern calibrates classification confidence floors →
  `classification_thresholds`.
- Guardrails: minimum sample sizes, bounded weights, smoothed steps, no-op on
  noise; all env-tunable.
- Activates ~30 days after scoring began (~late June 2026) once decisions mature;
  until then it safely serves the static defaults. The private-side ML remains a
  stub — deferred, since the 3-company private set can't supply training data.

## Deployment (Railway)

Five services: **api** (`vantage-finance-platform.up.railway.app`), **ui**
(`vantage-finance.up.railway.app`), **ml**, **Postgres**, **Redis**. Docker builds
from `infra/docker/*.Dockerfile`; the API runs migrations + an idempotent
private-company seed on boot, then starts. GitHub-connected (`wpf002/vantage`) —
push to `main` auto-deploys.

## UI surfaces

Editorial/broadsheet design (Playfair Display + serif + IBM Plex Mono, cream
palette). Pages: Home, Stock Screener, Daily Updates, Classifications,
Watchlists, Alerts, Portfolios, Simulations, Audit, Track Record, Settings —
with a per-ticker tear sheet, score history, and a clickable audit chain.
Responsive, with a mobile drawer nav below `md`.

## LLM / cost profile

Two Claude call sites: **narrative tagging** (Haiku 4.5, weekly refresh,
news-hash dedup, budget-capped) and **private-company web-search research**.
Scoring itself is pure logic. Narrative tagging is the dominant spend and runs
at a few dollars/day under the current configuration.

## Current real-world state

- ~3,125 public companies loaded, ~2,686 scored & classified; 3 private
  companies valued (Anthropic, Stripe, Databricks).
- All surfaces live and working in production; private valuations functional.
- Decision log accumulating (~18.5k decisions); grading begins once decisions
  pass the 30-day horizon (~late June 2026), at which point hit-rate and the
  learning loops activate.

## Business framing

Three SKUs on one codebase: **Vantage Pro** (VC/growth/corp-dev, enterprise),
**Vantage Signals** (retail/swing traders), **Vantage Meridian** (sophisticated
self-directed). Proprietary / UNLICENSED.

## Known stale docs / not-yet-built

- `README.md`'s build-phase table lists most phases as "todo/in progress," but
  the platform is fully built and live — treat that table as historical.
- The conversational interface (README "Phase 7") is scaffolded but not wired
  into the UI.
- The ML service is a stub (returns ~zero adjustment); private ML is deferred.
