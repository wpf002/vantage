# @vantage/shared

Universal types, Zod schemas, and constants shared across every Vantage package.

## What lives here

- **`signals.ts`** — the central normalized `Signal` schema with transform chain (provenance) and helpers (`normalizeMagnitude`, `combineConfidence`).
- **`classes.ts`** — `AssetClass` taxonomy (CORE / HIGH_ASYMMETRY / TACTICAL / AVOID), sleeve definitions, portfolio constraints.
- **`companies.ts`** — `Company`, `MarketType`, `LifeStage`, `Sector`, `ValuationRange`.
- **`errors.ts`** — `VantageError` hierarchy. Every other package throws from here.
- **`constants.ts`** — engine versions, default weights, confidence floor, illiquidity discount.

## Rules

- No business logic. Schemas + types + constants only.
- No upstream dependencies on any other `@vantage/*` package.
- Every other package imports from here.
