import pino from 'pino';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { FmpClient, type FmpHistoricalPrice } from '@vantage/data-ingest/public';
import { db, schema } from '../db/client.js';

/**
 * Phase 8 — step 2: outcome capture (the "teacher").
 *
 * Every decision Vantage makes is logged to platform_decisions with a null
 * outcome. This job closes the loop: once a decision is older than the
 * measurement horizon, it pulls the realized forward price move from FMP and
 * writes it back as the outcome, graded against what the decision implied.
 *
 * Only price-gradable decision types are processed — `public_score` (the
 * Public Score's directional read) and `classification` (the asset-class
 * verdict). Portfolio/simulation outcomes need a different yardstick and are
 * left for a later pass.
 *
 * Nothing here is synthetic: priceStart/priceEnd are real EOD closes, the
 * return is real, and `correct` compares the realized direction to the
 * prediction's intent.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.meta.outcome' });

/** Production measurement horizon in calendar days. Overridable for backfills. */
export const DEFAULT_HORIZON_DAYS = Number(process.env.META_OUTCOME_HORIZON_DAYS ?? 30);

/**
 * Safety ceiling on decisions graded per run. High enough to clear a full day's
 * matured set (~5k) plus backlog in one nightly pass — so grading keeps pace
 * with scoring instead of falling behind 1k/day — but bounded so a pathological
 * backlog can't run unbounded. Overridable via opts.limit.
 */
const MAX_DECISIONS_PER_RUN = Number(process.env.META_OUTCOME_MAX_DECISIONS ?? 50000);

/**
 * Bounded concurrency for per-ticker price-history fetches. Without this, grading
 * a large matured set would fire thousands of FMP calls at once and trip rate
 * limits. If FMP 429s appear, lower META_OUTCOME_FETCH_CONCURRENCY.
 */
const PRICE_FETCH_CONCURRENCY = Number(process.env.META_OUTCOME_FETCH_CONCURRENCY ?? 5);

/** A "neutral" read is correct if the stock barely moved, within this band. */
const NEUTRAL_BAND = 0.02;

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export type Expected = 'up' | 'down' | 'flat';

export interface OutcomePayload {
  kind: 'public_score' | 'classification';
  horizonDays: number;
  startDate: string;
  endDate: string;
  priceStart: number;
  priceEnd: number;
  forwardReturn: number; // (end - start) / start
  expected: Expected;
  correct: boolean;
  // public_score context
  label?: string;
  score?: number;
  direction?: string;
  // classification context
  assetClass?: string;
}

export interface CaptureResult {
  horizonDays: number;
  scanned: number;
  graded: number;
  skipped: number; // matured but no usable price (private entity, thin history)
}

/** History is sorted DESC by date; return the first close on or before `target`. */
function priceOnOrBefore(sorted: FmpHistoricalPrice[], target: string): FmpHistoricalPrice | null {
  for (const row of sorted) if (row.date <= target) return row;
  return null;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Run `fn` over `items` with at most `limit` promises in flight at once. */
async function forEachLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(runners);
}

/** Map a Public Score direction onto an expected price move. */
function expectedFromDirection(direction: string): Expected {
  if (direction === 'bullish') return 'up';
  if (direction === 'bearish') return 'down';
  return 'flat';
}

/** Map an asset class onto an expected price move. */
function expectedFromClass(assetClass: string): Expected {
  return assetClass === 'AVOID' ? 'down' : 'up';
}

function grade(expected: Expected, ret: number): boolean {
  if (expected === 'up') return ret > 0;
  if (expected === 'down') return ret < 0;
  return Math.abs(ret) <= NEUTRAL_BAND;
}

/**
 * Capture outcomes for every matured, ungraded, price-gradable decision.
 * Idempotent: a decision is only touched while its outcome is still null.
 */
export async function captureOutcomes(
  opts: { horizonDays?: number; limit?: number } = {},
): Promise<CaptureResult> {
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY not set — cannot capture outcomes');
  const fmp = new FmpClient({ apiKey });

  // Matured = decision is at least `horizonDays` old.
  const cutoff = new Date(Date.now() - horizonDays * DAY_MS);
  const decisions = await db
    .select()
    .from(schema.platformDecisions)
    .where(
      and(
        isNull(schema.platformDecisions.outcomePayload),
        inArray(schema.platformDecisions.decisionType, ['public_score', 'classification']),
        lte(schema.platformDecisions.createdAt, cutoff),
      ),
    )
    .orderBy(schema.platformDecisions.createdAt)
    .limit(opts.limit ?? MAX_DECISIONS_PER_RUN);

  const result: CaptureResult = { horizonDays, scanned: decisions.length, graded: 0, skipped: 0 };
  if (decisions.length === 0) return result;

  // Tickers only (skip private-entity UUIDs — no public price series).
  const tickers = [...new Set(decisions.map((d) => d.entity).filter((e) => !UUID_RE.test(e)))];

  // Fetch price history once per ticker, with bounded concurrency so a large
  // matured set doesn't burst thousands of FMP calls at once.
  const historyByTicker = new Map<string, FmpHistoricalPrice[]>();
  await forEachLimit(tickers, PRICE_FETCH_CONCURRENCY, async (t) => {
    try {
      const rows = await fmp.historicalPrices(t, 400);
      rows.sort((a, b) => (a.date < b.date ? 1 : -1)); // DESC
      historyByTicker.set(t, rows);
    } catch (err) {
      log.warn({ ticker: t, err: (err as Error).message }, 'price history fetch failed');
    }
  });

  // For public_score grading we need the score's direction/label/score. Pull
  // every score for the involved tickers once and match by nearest as_of.
  const scoresByTicker = new Map<string, Array<{ asOf: number; score: number; label: string; direction: string }>>();
  if (tickers.length > 0) {
    const scoreRows = await db
      .select({
        ticker: schema.publicScores.ticker,
        score: schema.publicScores.score,
        label: schema.publicScores.label,
        direction: schema.publicScores.direction,
        asOf: schema.publicScores.asOf,
      })
      .from(schema.publicScores)
      .where(inArray(schema.publicScores.ticker, tickers));
    for (const r of scoreRows) {
      const list = scoresByTicker.get(r.ticker) ?? [];
      list.push({ asOf: r.asOf.getTime(), score: r.score, label: r.label, direction: r.direction });
      scoresByTicker.set(r.ticker, list);
    }
  }

  for (const d of decisions) {
    const ticker = d.entity;
    if (UUID_RE.test(ticker)) {
      result.skipped++;
      continue;
    }
    const history = historyByTicker.get(ticker);
    if (!history || history.length === 0) {
      result.skipped++;
      continue;
    }

    const decisionDate = d.createdAt;
    const startISO = toISODate(decisionDate);
    const endISO = toISODate(new Date(decisionDate.getTime() + horizonDays * DAY_MS));
    const start = priceOnOrBefore(history, startISO);
    const end = priceOnOrBefore(history, endISO);
    if (!start || !end || start.close === 0) {
      result.skipped++;
      continue;
    }

    const forwardReturn = (end.close - start.close) / start.close;

    let expected: Expected;
    const payload: OutcomePayload = {
      kind: d.decisionType as OutcomePayload['kind'],
      horizonDays,
      startDate: start.date,
      endDate: end.date,
      priceStart: start.close,
      priceEnd: end.close,
      forwardReturn,
      expected: 'flat',
      correct: false,
    };

    if (d.decisionType === 'public_score') {
      // Nearest score by as_of to the decision time.
      const scores = scoresByTicker.get(ticker) ?? [];
      const target = decisionDate.getTime();
      const nearest = scores.reduce<(typeof scores)[number] | null>((best, s) => {
        if (!best) return s;
        return Math.abs(s.asOf - target) < Math.abs(best.asOf - target) ? s : best;
      }, null);
      const direction = nearest?.direction ?? 'neutral';
      expected = expectedFromDirection(direction);
      payload.label = nearest?.label;
      payload.score = nearest?.score;
      payload.direction = direction;
    } else {
      // classification — read the asset class out of the logged decision.
      const dp = (d.decisionPayload ?? {}) as { result?: { classification?: string } };
      const assetClass = dp.result?.classification ?? 'CORE';
      expected = expectedFromClass(assetClass);
      payload.assetClass = assetClass;
    }

    payload.expected = expected;
    payload.correct = grade(expected, forwardReturn);

    await db
      .update(schema.platformDecisions)
      .set({ outcomePayload: payload, outcomeAt: new Date() })
      .where(eq(schema.platformDecisions.id, d.id));
    result.graded++;
  }

  log.info(result, 'outcome capture complete');
  return result;
}
