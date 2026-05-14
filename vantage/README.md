# Vantage

> Sector-agnostic financial intelligence platform. Private + public scoring, classification, portfolio construction, and simulation — with full audit lineage on every output.

**Mission:** replace 40-hour analyst Excel workups with 4-minute auditable tear sheets.

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

```
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

| Method        | Weight (stage-tuned) |
|---------------|----------------------|
| DCF           | 10–40%              |
| Comps         | 30–80%              |
| LBO           | 10–30%              |
| ML (XGBoost)  | layered (SHAP-explained) |

Confidence-aware: methods can be zeroed out when their reliability on a given input is below threshold (e.g. DCF on a heavy-burn AI lab).

### `core-public` — Public Score

Three-layer divergence index:

```
Public Score = 0.45 × Expectation Gap
             + 0.35 × (100 − Narrative Integrity)
             + 0.20 × Narrative Heat
```

Eight signal labels from score + direction (see `packages/core-public/src/labels.ts`).

---

## Tech stack

| Layer        | Choice                                    |
|--------------|-------------------------------------------|
| Languages    | TypeScript 5.7 (services), Python 3.12 (ML) |
| Runtime      | Node 22, pnpm 9                          |
| Monorepo     | pnpm workspaces + Turbo                  |
| API          | Fastify 5 + Zod                          |
| UI           | Next.js 15 (App Router) + Tailwind + Recharts |
| DB           | PostgreSQL 16 + Drizzle ORM              |
| Cache / queue | Redis 7 + BullMQ                        |
| ML service   | Python + FastAPI + XGBoost + scikit-learn + SHAP |
| Validation   | Zod (TS) / Pydantic (Python)             |
| Tests        | Vitest (TS) / pytest (Python)            |
| Dev infra    | Docker Compose                           |

---

## Package layout

```
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

- UI: http://localhost:3000
- API: http://localhost:4000
- ML service: http://localhost:8001
- Postgres: 5432
- Redis: 6379

---

## Build phases

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Monorepo scaffold — all packages, schemas, stubs, infra | ✅ this commit |
| 2 | `core-private` — DCF + Comps + LBO + blend + ML bridge + golden fixtures | 🟡 in progress |
| 3 | `core-public` — Public Score + 8 labels + explanation templates | ⬜ |
| 4 | Harmonizer + Classification engine | ⬜ |
| 5 | Portfolio construction + sleeve logic | ⬜ |
| 6 | Simulation sandbox + scenario trees | ⬜ |
| 7 | Conversational interface wiring | ⬜ |
| 8 | Meta-learning activation (after ~12 months of decision logs) | ⬜ |
| 9 | Public-module Phase 2 — screener, daily board, per-ticker signal history | ⬜ |
| 10 | Public-module Phase 3 — alerts, admin panel, news-assisted narrative tagging | ⬜ |

---

## Core principles

- **Auditable over impressive.** Every output traces to its inputs.
- **Deterministic where it matters.** Scoring and explanations are pure logic. LLMs assist, they don't decide.
- **Free data first.** Private side runs on $0/mo. Public side $22–79/mo on FMP. No exotic vendors.
- **Stage- and confidence-aware.** Methods weighted by what they're good at; excluded when not trustworthy.
- **Two engines, one harmonizer.** Private and public funnel through the same normalized signal schema.

---

## Target SKUs

| SKU                  | Audience                                   | Pricing            |
|----------------------|--------------------------------------------|--------------------|
| Vantage Pro          | Mid-market VC, growth equity, corp dev    | $30–100k/yr ent    |
| Vantage Signals      | Retail traders, swing traders, creators   | $20–200/mo         |
| Vantage Meridian     | Self-directed sophisticated investors     | $100–500/mo        |

One codebase, three front-end SKUs, three pricing tiers.

---

## License

UNLICENSED — proprietary.
