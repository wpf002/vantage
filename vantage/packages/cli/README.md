# @vantage/cli

Admin and batch utilities. Installs as `vantage` binary.

## Commands

```bash
vantage score-public -f ./inputs.json     # compute Public Score
vantage value-private -f ./inputs.json    # compute blended private valuation
vantage fetch-fmp -t NVDA                 # fetch FMP profile + earnings + targets
vantage health                            # ping the API gateway
```

## Local dev

```bash
pnpm --filter @vantage/cli dev -- score-public -f ./fixtures/sample.json
```
