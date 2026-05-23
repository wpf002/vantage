import 'dotenv/config';
import { loadUniverse } from '../jobs/loadUniverse.js';
import { closeQueues } from '../queues/index.js';

/**
 * One-shot: bootstrap (or refresh) `platform_companies` from the FMP
 * Russell-3000 approximation. Idempotent — running again upserts each row.
 *
 * Run from the repo root:
 *   pnpm --filter @vantage/api load:universe
 * or with overrides:
 *   MIN_MARKET_CAP_USD=500000000 LIMIT=500 pnpm --filter @vantage/api load:universe
 *
 * The actual scoring of these tickers is handled by the existing daily
 * universe-score sweep (`scoreUniverse`) — this script only populates the
 * table the sweep iterates over.
 */

async function main(): Promise<void> {
  const minMarketCapUsd = process.env.MIN_MARKET_CAP_USD
    ? Number(process.env.MIN_MARKET_CAP_USD)
    : undefined;
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;

  process.stderr.write(
    `Loading public universe (minMarketCapUsd=${minMarketCapUsd ?? 'default 200M'}, limit=${limit ?? 'none'})…\n`,
  );

  const result = await loadUniverse({ minMarketCapUsd, limit });
  process.stderr.write(
    `Done. fetched=${result.fetched} inserted=${result.inserted} updated=${result.updated} failed=${result.failed}\n`,
  );

  // Universe loader doesn't touch the queue, but the script imports the
  // queues module transitively via the worker barrel — close cleanly so the
  // process can exit.
  await closeQueues();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`load-universe failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
