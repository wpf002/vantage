import pino from 'pino';
import { sql } from 'drizzle-orm';
import { Public } from '@vantage/data-ingest';
import { db, schema } from '../db/client.js';

type UniverseRow = Public.UniverseRow;

/**
 * Universe loader — pulls the Russell-3000 approximation from FMP
 * (`fetchPublicUniverse`) and upserts each row into `platform_companies`.
 *
 * Runs as a one-shot bootstrap (`pnpm load:universe`) and again on a
 * repeatable schedule so the table tracks Russell rebalances and IPOs.
 *
 * Idempotent: the unique index on `ticker` makes the same name a no-op on
 * a re-run, with `name`, `sector`, `lifeStage`, and `metadata` refreshed in
 * place. Rows that drop out of the universe are *not* deleted — historical
 * scores stay queryable; they just stop getting re-scored once filtered out
 * of the next universe pull (still in `platform_companies`, but the
 * universe-score job would re-score them anyway since it iterates the whole
 * table — see operational notes in README).
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.universe.load' });

export interface LoadUniverseResult {
  fetched: number;
  inserted: number;
  updated: number;
  failed: number;
}

export interface LoadUniverseOpts {
  /** Override the $200M default — useful for smaller test runs. */
  minMarketCapUsd?: number;
  /** Hard cap on rows processed (after fetch). Useful for staged rollouts. */
  limit?: number;
}

export async function loadUniverse(opts: LoadUniverseOpts = {}): Promise<LoadUniverseResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY not set — cannot load universe');

  const client = new Public.FmpClient({ apiKey });
  const rows: UniverseRow[] = await Public.fetchPublicUniverse(client, {
    minMarketCapUsd: opts.minMarketCapUsd,
  });

  const capped = opts.limit ? rows.slice(0, opts.limit) : rows;
  log.info({ fetched: rows.length, processing: capped.length }, 'universe load: start');

  const result: LoadUniverseResult = {
    fetched: capped.length,
    inserted: 0,
    updated: 0,
    failed: 0,
  };

  // Per-row upsert keeps a single failure from poisoning the whole batch.
  // Throughput is fine — ~3,000 inserts is sub-second against Postgres.
  for (const row of capped) {
    try {
      const ret = await db
        .insert(schema.platformCompanies)
        .values({
          name: row.name,
          marketType: 'public',
          ticker: row.ticker,
          sector: row.sector,
          lifeStage: row.lifeStage,
          country: 'US',
          metadata: {
            source: 'fmp.company-screener',
            marketCapUsd: row.marketCapUsd,
            exchange: row.exchange,
            loadedAt: new Date().toISOString(),
          },
        })
        .onConflictDoUpdate({
          target: schema.platformCompanies.ticker,
          // The unique index on (ticker) is partial — WHERE ticker IS NOT NULL —
          // because private rows share this table and have null tickers. Postgres
          // requires the inferenced predicate to match exactly, or it can't pick
          // the index and ON CONFLICT throws "no unique or exclusion constraint
          // matching the ON CONFLICT specification".
          targetWhere: sql`ticker IS NOT NULL`,
          set: {
            name: row.name,
            sector: row.sector,
            lifeStage: row.lifeStage,
            metadata: {
              source: 'fmp.company-screener',
              marketCapUsd: row.marketCapUsd,
              exchange: row.exchange,
              loadedAt: new Date().toISOString(),
            },
            updatedAt: sql`now()`,
          },
        })
        .returning({
          // Postgres lets us tell INSERT vs UPDATE apart via xmax: a fresh
          // insert leaves xmax = 0; an update sets it to the current xid.
          // Drizzle doesn't expose system columns directly, so we just diff
          // created/updated. Approximate: if created==updated this run, it's
          // an insert; otherwise an update.
          createdAt: schema.platformCompanies.createdAt,
          updatedAt: schema.platformCompanies.updatedAt,
        });

      const r = ret[0];
      if (r && r.createdAt.getTime() === r.updatedAt.getTime()) {
        result.inserted++;
      } else {
        result.updated++;
      }
    } catch (err) {
      result.failed++;
      log.error(
        { ticker: row.ticker, err: (err as Error).message },
        'universe load: row failed',
      );
    }
  }

  log.info(result, 'universe load: done');
  return result;
}
