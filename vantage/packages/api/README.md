# @vantage/api

Fastify 5 + Zod gateway. Single entrypoint into every engine.

## Routes

| Method | Path | Engine |
|--------|------|--------|
| GET | `/health` | — |
| POST | `/v1/private/value` | core-private (DCF + Comps + LBO + blend + ML) |
| POST | `/v1/public/score` | core-public (EGS + NIS + NHS + label) |
| POST | `/v1/classify` | classification |
| POST | `/v1/portfolio/construct` | portfolio |
| POST | `/v1/simulation/monte-carlo` | simulation |
| POST | `/v1/simulation/scenario` | simulation |
| POST | `/v1/simulation/regime` | simulation |
| GET | `/v1/audit/:signalId` | audit lineage |

## DB

Single Postgres, three logical modules separated by table prefix:
- `platform_*` — signals, audit, companies, classifications, portfolios, allocations, simulations, decisions
- `private_*` — DCF inputs, comps peers, LBO assumptions, alt-data observations
- `public_*` — EGS, NIS, NHS, scores, segments, estimates

See `src/db/schema.ts`.

## Commands

```bash
pnpm db:generate    # create migration from schema diff
pnpm db:migrate     # apply pending migrations
pnpm db:seed        # load infra/seeds into DB
pnpm db:studio      # drizzle studio
pnpm dev            # tsx watch
```
