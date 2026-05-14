# Contributing to Vantage

## Adding a new scoring method

1. Drop a module under the right engine package (`core-private/src/<method>/` or `core-public/src/<layer>/`)
2. Define inputs as a Zod schema (`zod` is the contract — not TypeScript interfaces)
3. Compute the result deterministically
4. Return a `ValuationMethodResult` (private) or component result (public)
5. Add a confidence calculation — methods below `CONFIDENCE_FLOOR` get excluded from the blend
6. Add a golden fixture under `fixtures/` and a test
7. Wire into the blend or score assembly

## Adding a new signal type

1. Add the literal to `packages/shared/src/signals.ts::SignalType`
2. Add an explanation template in `packages/explanation/src/templates/`
3. Emit the signal through `harmonize()` — every signal must have a non-empty `transformChain`

## Adding a new asset class

Don't. The taxonomy is fixed at CORE / HIGH_ASYMMETRY / TACTICAL / AVOID. If you need a new bucket, the classification rules in `packages/classification/` should change, not the taxonomy.

## Adding a new data source

1. Drop a `createX(config): XClient` factory under `packages/data-ingest/src/private/` or `src/public/`
2. Errors must propagate as `UpstreamError` from `@vantage/shared`
3. Re-export from the appropriate barrel

## Coding standards

- TypeScript: ES modules only, `verbatimModuleSyntax` off but use `import type` where useful
- Strict mode + `noUncheckedIndexedAccess`
- Zod schemas for every public boundary (HTTP, IPC, file I/O)
- No `any` outside of the explanation/template paths
- No mutation across packages — every cross-package call returns new objects

## Commit hygiene

- One feature per commit
- Conventional Commits style: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`
- Run `pnpm typecheck && pnpm test` before pushing
