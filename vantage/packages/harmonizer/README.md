# @vantage/harmonizer

Gatekeeper for every signal entering the platform. Validates against the universal `Signal` schema and enforces the rule:

> **Nothing scores without lineage.**

If a signal arrives with an empty `transformChain`, the harmonizer rejects it.

## API

- `harmonize(raw, opts?)` — validate + stamp version + optional confidence floor
- `dedupe(signals)` — collapse (entity, signalType, timestamp) duplicates, highest confidence wins
- `flattenLineage(signal)` — produce audit-log-ready rows for the `platform_audit` table
