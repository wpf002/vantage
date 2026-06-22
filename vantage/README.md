# Vantage

> Sector-agnostic financial intelligence platform. Private + public scoring, classification, portfolio construction, and simulation — with full audit lineage on every output.

**Mission:** replace 40-hour analyst Excel workups with 4-minute auditable tear sheets.

> 📄 **For the current, deployed-state architecture and status, see [PROJECT.md](./PROJECT.md).**
> The build-phase table near the bottom of this README is historical — the
> platform is fully built and live in production.

---

## What it does

For any company — private or public — Vantage produces:

- A valuation range (bear / base / bull)
- A signal label from a fixed taxonomy
- A confidence score (0–1) reflecting input quality
- A plain-English explanation generated from deterministic templates (no LLM in the scoring path)
- A full audit trail of every input, transform, and weight

Above the two scoring engines:

- **Asset classification** — CORE, HIGH-ASYMMETRY, TACTICAL, AVOID
- **Portfolio construction** — sleeve-based allocation under hard constraints
- **Simulation sandbox** — Monte Carlo, scenario trees, regime-transition modeling
- **Decision log + meta-learning** — every output logged against outcomes; meta-learning activates after ~12 months
- **Conversational interface** — chat-driven access (Phase 7)

---

## Architecture

```text
┌────────────────────────────────────────────────────────────────┐
│                       UI  (Next.js 15)                          │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                    API  (Fastify 5 + Zod)                       │
└──┬─────────┬──────────┬──────────┬──────────┬─────────┬───────┘
   │         │          │          │          │         │
   ▼         ▼          ▼          ▼          ▼         ▼
┌──────┐ ┌──────┐  ┌─────────┐ ┌────────┐ ┌────────┐ ┌─────────┐
│core- │ │core- │  │harmoniz │ │classif │ │portfol │ │simulati │
│privte│ │public│  │er       │ │ication │ │io      │ │on       │
└──┬───┘ └──┬───┘  └────┬────┘ └───┬────┘ └───┬────┘ └────┬────┘
   │        │           │          │          │           │
   └────────┴───────────┴──────────┴──────────┴───────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │  Postgres + Redis     │
                  │  (Drizzle ORM)        │
                  └───────────────────────┘

   core-private also calls →  ML Service (Python / FastAPI / XGBoost)
```

---

## The two scoring engines

### `core-private` — private company valuation

Pure-logic weighted blend with ML adjustment:

| Method       | Weight (stage-tuned)     |
|--------------|--------------------------|
| DCF          | 10–40%                   |
| Comps        | 30–80%                   |
| LBO          | 10–30%                   |
| ML (XGBoost) | layered (SHAP-explained) |

Confidence-aware: methods can be zeroed out when their reliability on a given input is below threshold (e.g. DCF on a heavy-burn AI lab).

### `core-public` — Public Score

Three-layer divergence index:

```text
Public Score = 0.45 × Expectation Gap
             + 0.35 × (100 − Narrative Integrity)
             + 0.20 × Narrative Heat
```

Eight signal labels from score + direction (see `packages/core-public/src/labels.ts`).

---

## Tech stack

| Layer         | Choice                                           |
|---------------|--------------------------------------------------|
| Languages     | TypeScript 5.7 (services), Python 3.12 (ML)      |
| Runtime       | Node 22, pnpm 9                                  |
| Monorepo      | pnpm workspaces + Turbo                          |
| API           | Fastify 5 + Zod                                  |
| UI            | Next.js 15 (App Router) + Tailwind + Recharts    |
| DB            | PostgreSQL 16 + Drizzle ORM                      |
| Cache / queue | Redis 7 + BullMQ                                 |
| ML service    | Python + FastAPI + XGBoost + scikit-learn + SHAP |
| Validation    | Zod (TS) / Pydantic (Python)                     |
| Tests         | Vitest (TS) / pytest (Python)                    |
| Dev infra     | Docker Compose                                   |

---

## Package layout

```text
vantage/
├── packages/
│   ├── shared/              Universal Zod schemas, types, constants
│   ├── core-private/        DCF + Comps + LBO + weighted blend
│   ├── core-public/         Public Score (EGS + NIS + NHS + 8 labels)
│   ├── harmonizer/          Signal normalization + traceability
│   ├── classification/      CORE / HIGH-ASYM / TACTICAL / AVOID
│   ├── portfolio/           Sleeve construction
│   ├── simulation/          Monte Carlo, scenario trees
│   ├── explanation/         Deterministic plain-English templates
│   ├── conversational/      Chat interface (later phase)
│   ├── data-ingest/         Free private sources + FMP for public
│   ├── api/                 Fastify HTTP gateway + Drizzle schema
│   ├── ui/                  Next.js dashboard
│   └── cli/                 Admin + batch
├── services/
│   └── ml-service/          Python FastAPI for XGBoost predictions
├── infra/
│   ├── migrations/          Drizzle output
│   └── seeds/               Golden test fixtures + peer sets
├── bootstrap.sh             First-run setup script
└── docker-compose.yml       Postgres + Redis for local dev
```

---

## Getting started

```bash
# clone, then:
./bootstrap.sh

# then any of:
pnpm dev             # turbo dev (api + ui + watchers)
pnpm ml:dev          # python ML service on :8001
pnpm test            # all packages
pnpm typecheck       # all packages
pnpm db:studio       # drizzle studio
```

Default ports:

- UI: <http://localhost:3000>
- API: <http://localhost:4000>
- ML service: <http://localhost:8001>
- Postgres: 5432
- Redis: 6379

---

## Public universe (Russell 3000 approximation)

The screener, watchlists, and classification surfaces only show tickers
present in `platform_companies`. To populate that table with the
~3,000-name Russell 3000 approximation (US-listed common stocks on
NYSE/NASDAQ, market cap ≥ $200M, actively trading, no ETFs/funds —
sourced from FMP's `/company-screener`):

```bash
# one-shot bootstrap (idempotent — safe to re-run)
pnpm --filter @vantage/api load:universe

# smaller staged run (cap rows; raise cap to refresh)
LIMIT=500 pnpm --filter @vantage/api load:universe

# tighter market-cap floor (≈ S&P 500 only)
MIN_MARKET_CAP_USD=10000000000 pnpm --filter @vantage/api load:universe
```

After the bootstrap, the existing daily `universeScore` sweep picks up
the new rows on the next 01:00 UTC tick. With ~3,000 tickers and the
default `UNIVERSE_SCORE_DELAY_MS=1500`, a full sweep takes ~75 minutes —
finishing after the 02:00 UTC system-portfolio rebuild. Recommended tuning
for a 3,000-ticker universe:

```bash
# in .env — move the score earlier so fresh scores feed the portfolio
UNIVERSE_SCORE_CRON="0 0 * * *"      # 00:00 UTC (was 01:00)
UNIVERSE_SCORE_DELAY_MS=1000         # ~50 min total (FMP plan permitting)
```

A weekly refresh of the universe itself is registered automatically
(`ensureUniverseLoadSchedule`, default `UNIVERSE_LOAD_CRON="0 23 * * 0"`,
Sunday 23:00 UTC) so IPOs, delistings, and Russell reconstitutions land
without manual intervention. Override via env. Rows that fall out of the
universe are **not deleted** — their historical scores stay queryable.

FMP cost note: a full score sweep makes ~10 FMP calls per ticker
(profile, earnings, segments, prices, targets, ratings, ratios, etc.),
so 3,000 tickers ≈ 30,000 calls/day. Verify against your FMP plan's
daily quota before enabling on a small tier.

### Weekly progress email

A weekly Vantage growth report is sent automatically through Resend
(same client as alerts/morning digest), covering coverage growth,
signal highlights (top score moves, new Aligned Strength / Narrative
Breakdown entries), and engine quality (sweep success rate, meta-learning
hit rate).

```bash
# .env
PROGRESS_REPORT_EMAIL=you@example.com   # default falls back to wfoti71992@gmail.com
PROGRESS_REPORT_CRON="0 14 * * 0"        # Sunday 14:00 UTC (10:00 ET) by default
PROGRESS_REPORT_DISABLED=1               # set after your 90-day window to turn off
```

Requires `RESEND_API_KEY` (already set if alerts are working).

---

## Build phases

> ⚠️ **Historical.** This table reflects the original plan; the platform is now
> fully built and deployed. See [PROJECT.md](./PROJECT.md) for current state.

| Phase | Scope                                                                    | Status      |
|-------|--------------------------------------------------------------------------|-------------|
| 1     | Monorepo scaffold — all packages, schemas, stubs, infra                  | done        |
| 2     | `core-private` — DCF + Comps + LBO + blend + ML bridge + golden fixtures | in progress |
| 3     | `core-public` — Public Score + 8 labels + explanation templates          | todo        |
| 4     | Harmonizer + Classification engine                                       | todo        |
| 5     | Portfolio construction + sleeve logic                                    | todo        |
| 6     | Simulation sandbox + scenario trees                                      | todo        |
| 7     | Conversational interface wiring                                          | todo        |
| 8     | Meta-learning activation (after ~12 months of decision logs)             | todo        |
| 9     | Public-module Phase 2 — screener, daily board, per-ticker signal history | todo        |
| 10    | Watchlists + alerts (web push + email) + news-assisted narrative tagging | done        |

---

## Phase 10 — watchlists, alerts & narrative tagging

- **Watchlists** — per-user (`kind='personal'`) and system-curated (`kind='system'`) lists of entities,
  CRUD'd at `/watchlists`. Seeded system lists ("S&P 500 Highlights", "AI Frontier") land via `pnpm db:seed`.
- **Alerts** — four rule types (label change, score move, classification transition, morning digest)
  attached to a watchlist. The harmonize worker publishes every new signal to the Redis channel
  `vantage.signals.harmonized`; the alert-evaluator worker subscribes and fans out to web push + email.
  The morning digest is the one time-based exception (a 15-minute cron).
- **News-assisted narrative tagging** — during universe re-scoring, stale tickers are queued onto
  `vantage.narrative.tag`. The worker pulls recent FMP news, asks Claude which revenue segment(s) the
  dominant narrative is centered on, and persists to `public_narrative_tags`. NIS reads these tags when
  fresh (confidence ≥ 0.5) and falls back to the rule-based heuristic otherwise. The LLM only *tags*;
  the NIS math stays deterministic. A daily USD budget (`NARRATIVE_TAGGING_DAILY_BUDGET_USD`) caps spend.

**Web push setup.** Generate a VAPID keypair once and put it in `.env`:

```bash
npx web-push generate-vapid-keys
# → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ; also set VAPID_SUBJECT=mailto:you@example.com
```

Enable browser notifications at `/settings/notifications`; email alerts use the existing `RESEND_API_KEY`.

---

## Core principles

- **Auditable over impressive.** Every output traces to its inputs.
- **Deterministic where it matters.** Scoring and explanations are pure logic. LLMs assist, they don't decide.
- **Free data first.** Private side runs on $0/mo. Public side $22–79/mo on FMP. No exotic vendors.
- **Stage- and confidence-aware.** Methods weighted by what they're good at; excluded when not trustworthy.
- **Two engines, one harmonizer.** Private and public funnel through the same normalized signal schema.

---

## Target SKUs

| SKU              | Audience                                | Pricing         |
|------------------|-----------------------------------------|-----------------|
| Vantage Pro      | Mid-market VC, growth equity, corp dev  | $30–100k/yr ent |
| Vantage Signals  | Retail traders, swing traders, creators | $20–200/mo      |
| Vantage Meridian | Self-directed sophisticated investors   | $100–500/mo     |

One codebase, three front-end SKUs, three pricing tiers.

---

## License

UNLICENSED — proprietary.
