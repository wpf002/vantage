import pino from 'pino';
import { and, eq, isNotNull } from 'drizzle-orm';
import { runLivePublicScore, type LivePublicScoreConfig } from '@vantage/core-public/orchestrator';
import { harmonize } from '@vantage/harmonizer';
import { InsufficientDataError } from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { ensureCompany, persistPublicScore } from './../db/signalStore.js';

/**
 * Phase 8 — daily universe re-scoring.
 *
 * Re-runs the live Public Score for every seeded public ticker. Each run logs
 * a fresh decision (and triggers classification downstream), so the decision
 * log — and the meta-learning loop that grades it — keeps growing on its own
 * with no manual input. Pure server-side; same path as POST /v1/public/score-live.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.universe.score' });

const INTER_TICKER_DELAY_MS = Number(process.env.UNIVERSE_SCORE_DELAY_MS ?? 1500);

export interface UniverseScoreResult {
  scanned: number;
  scored: number;
  skipped: number; // insufficient data
  failed: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function scoreUniverse(opts: { limit?: number } = {}): Promise<UniverseScoreResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY not set — cannot re-score universe');

  const rows = await db
    .select({ ticker: schema.platformCompanies.ticker })
    .from(schema.platformCompanies)
    .where(
      and(
        eq(schema.platformCompanies.marketType, 'public'),
        isNotNull(schema.platformCompanies.ticker),
      ),
    );

  let tickers = rows.map((r) => r.ticker).filter((t): t is string => !!t);
  if (opts.limit) tickers = tickers.slice(0, opts.limit);

  const result: UniverseScoreResult = { scanned: tickers.length, scored: 0, skipped: 0, failed: 0 };
  log.info({ count: tickers.length }, 'universe score: start');

  for (const ticker of tickers) {
    try {
      const config: LivePublicScoreConfig = {
        ticker,
        fmpApiKey: apiKey,
        ...(process.env.ML_SERVICE_URL ? { mlServiceUrl: process.env.ML_SERVICE_URL } : {}),
      };
      const run = await runLivePublicScore(config);
      const signal = harmonize(run.signal);
      await ensureCompany(db, run.inputs.profile);
      await persistPublicScore(db, { ...run, signal });
      result.scored++;
      log.info({ ticker, score: run.result.score.toFixed(1) }, 'universe score: scored');
    } catch (err) {
      if (err instanceof InsufficientDataError) {
        result.skipped++;
        log.warn({ ticker }, 'universe score: insufficient data — skipped');
      } else {
        result.failed++;
        log.error({ ticker, err: (err as Error).message }, 'universe score: failed');
      }
    }
    if (INTER_TICKER_DELAY_MS > 0) await sleep(INTER_TICKER_DELAY_MS);
  }

  log.info(result, 'universe score: done');
  return result;
}
