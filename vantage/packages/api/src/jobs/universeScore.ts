import pino from 'pino';
import { and, eq, isNotNull } from 'drizzle-orm';
import { runLivePublicScore, type LivePublicScoreConfig } from '@vantage/core-public/orchestrator';
import { getNarrativeTagsForTicker } from '@vantage/core-public/narrative-tagging';
import { harmonize } from '@vantage/harmonizer';
import { InsufficientDataError } from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { ensureCompany, persistPublicScore } from './../db/signalStore.js';
import { narrativeTagQueue } from '../queues/index.js';
import { narrativeTagsStale } from './narrativeTag.js';

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

export async function scoreUniverse(
  opts: { limit?: number; skipScored?: boolean } = {},
): Promise<UniverseScoreResult> {
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

  // Resume mode: skip tickers that already have a persisted score so a killed
  // sweep can be relaunched without redoing completed work. The daily cron
  // leaves this off — it re-scores everything to keep the decision log fresh.
  if (opts.skipScored) {
    const scored = await db
      .selectDistinct({ ticker: schema.publicScores.ticker })
      .from(schema.publicScores);
    const done = new Set(scored.map((r) => r.ticker));
    const before = tickers.length;
    tickers = tickers.filter((t) => !done.has(t));
    log.info({ alreadyScored: done.size, remaining: tickers.length, total: before }, 'universe score: resume — skipping scored');
  }

  if (opts.limit) tickers = tickers.slice(0, opts.limit);

  const result: UniverseScoreResult = { scanned: tickers.length, scored: 0, skipped: 0, failed: 0 };
  log.info({ count: tickers.length }, 'universe score: start');

  for (const ticker of tickers) {
    try {
      // Phase 10 — feed news-assisted narrative tags into NIS when fresh.
      const tags = await getNarrativeTagsForTicker(db, ticker);
      const config: LivePublicScoreConfig = {
        ticker,
        fmpApiKey: apiKey,
        ...(process.env.ML_SERVICE_URL ? { mlServiceUrl: process.env.ML_SERVICE_URL } : {}),
        ...(tags ? { narrativeTags: tags.segments } : {}),
      };
      const run = await runLivePublicScore(config);
      const signal = harmonize(run.signal);
      await ensureCompany(db, run.inputs.profile);
      await persistPublicScore(db, { ...run, signal });
      result.scored++;
      log.info({ ticker, score: run.result.score.toFixed(1) }, 'universe score: scored');

      // Re-tag if stale/missing — runs out-of-band on its own queue so the
      // re-scoring sweep isn't blocked on Anthropic latency.
      try {
        if (await narrativeTagsStale(ticker)) {
          await narrativeTagQueue.add('tag', { ticker, reason: 'cron' });
        }
      } catch (err) {
        log.warn({ ticker, err: (err as Error).message }, 'universe score: enqueue narrative-tag failed');
      }
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
