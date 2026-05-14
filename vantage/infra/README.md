# infra/

## `migrations/`

Drizzle-generated SQL. Run `pnpm db:generate` from the repo root after editing `packages/api/src/db/schema.ts` and a new timestamped migration appears here.

Apply with `pnpm db:migrate`.

## `seeds/`

Idempotent fixture data the seed runner loads on `pnpm db:seed`:

- `companies.json` — demo companies (public + private mix) that power the UI tear sheets
- `peers-ai-infra.json` — AI-infrastructure peer set used by Comps on the Anthropic example

Add new seeds as JSON files keyed by table name and extend `packages/api/src/db/seed.ts` to load them.
