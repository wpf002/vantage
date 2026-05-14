# @vantage/data-ingest

All upstream data clients. Two trees:

## `private/` — free-only sources

| Source | What it gives | Auth |
|--------|---------------|------|
| SEC EDGAR (Form D) | Private funding leakage | User-Agent header |
| FRED | Macro context | API key (free) |
| GitHub | Engineering velocity | PAT |
| USPTO PatentsView | IP filings | none |
| Google Trends (via proxy) | Search demand | proxy URL |
| BuiltWith | Tech-stack change | API key (free tier) |
| Cloudflare Radar / Tranco | Domain rank | none |

Cost: **$0/mo**.

## `public/` — Financial Modeling Prep

Single client. Free tier 250 calls/day for dev. Production: Starter $22/mo or Premium $79/mo.

Endpoints wrapped: profile, earnings, price-target consensus, revenue segments (product + geographic).

## Adding a source

Drop a `createX(config): XClient` factory next to the existing ones and re-export from `src/private/index.ts` or `src/public/index.ts`. Errors must propagate as `UpstreamError` from `@vantage/shared`.
