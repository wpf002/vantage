import pino from 'pino';
import { and, gte, eq, sql } from 'drizzle-orm';
import { FmpClient } from '@vantage/data-ingest/public';
import { fetchRecentNews, tagNarrativeSegments } from '@vantage/core-public/narrative-tagging';
import { db, schema } from '../db/client.js';

/**
 * Phase 10 — news-assisted narrative tagging worker job. For one ticker:
 * fetch revenue segments + recent news, ask Claude which segment(s) the
 * dominant narrative is on, persist to public_narrative_tags. When there's no
 * recent news (or no segments), persist a source='fallback' row and skip the
 * LLM. A daily cost cap is the safety valve.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.narrative-tag' });

const EST_COST_PER_TICKER_USD = 0.05;
const DAILY_BUDGET_USD = Number(process.env.NARRATIVE_TAGGING_DAILY_BUDGET_USD ?? 50);

/** Tidy raw FMP segment keys into display names (drops camelCase / underscores). */
function normalizeSegmentName(raw: string): string {
  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function knownSegments(ticker: string, fmpApiKey: string): Promise<string[]> {
  try {
    const client = new FmpClient({ apiKey: fmpApiKey });
    const segs = await client.revenueSegmentsProduct(ticker);
    if (!segs || segs.length === 0) return [];
    const latest = [...segs].sort((a, b) => b.date.localeCompare(a.date))[0]!;
    return Object.keys(latest.segments)
      .filter((n) => (latest.segments[n] ?? 0) > 0)
      .map(normalizeSegmentName);
  } catch (err) {
    log.warn({ ticker, err: (err as Error).message }, 'narrative-tag: segment fetch failed');
    return [];
  }
}

/** Count of source='news' tags created today → estimated spend today. */
async function spentTodayUsd(): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.publicNarrativeTags)
    .where(
      and(
        eq(schema.publicNarrativeTags.source, 'news'),
        gte(schema.publicNarrativeTags.createdAt, startOfDay),
      ),
    );
  return Number(rows[0]?.n ?? 0) * EST_COST_PER_TICKER_USD;
}

async function persistTags(input: {
  ticker: string;
  segments: Array<{ name: string; confidence: number }>;
  rationale: string | null;
  modelVersion: string;
  source: 'news' | 'fallback';
}): Promise<void> {
  await db
    .insert(schema.publicNarrativeTags)
    .values({
      ticker: input.ticker,
      asOf: new Date(),
      narrativeSegments: input.segments,
      rationale: input.rationale,
      modelVersion: input.modelVersion,
      source: input.source,
    })
    .onConflictDoNothing();
}

export interface NarrativeTagResult {
  ticker: string;
  source: 'news' | 'fallback';
  segments: Array<{ name: string; confidence: number }>;
  estimatedCostUsd: number;
}

export async function tagNarrativeForTicker(ticker: string): Promise<NarrativeTagResult> {
  const upper = ticker.toUpperCase();
  const fmpApiKey = process.env.FMP_API_KEY;
  if (!fmpApiKey) throw new Error('FMP_API_KEY not set — cannot tag narrative');

  // Cost cap — once today's estimated spend exceeds the budget, stop calling
  // the LLM and persist fallbacks for the rest of the day.
  const spent = await spentTodayUsd();
  if (spent >= DAILY_BUDGET_USD) {
    log.warn({ ticker: upper, spent }, 'narrative-tag: daily budget exceeded — skipping LLM');
    await persistTags({
      ticker: upper,
      segments: [],
      rationale: 'daily narrative-tagging budget exceeded',
      modelVersion: 'none',
      source: 'fallback',
    });
    return { ticker: upper, source: 'fallback', segments: [], estimatedCostUsd: 0 };
  }

  const news = await fetchRecentNews(upper, 14, fmpApiKey);
  if (news.length === 0) {
    log.info({ ticker: upper }, 'narrative-tag: no recent news — fallback');
    await persistTags({
      ticker: upper,
      segments: [],
      rationale: 'no news in trailing 14 days',
      modelVersion: 'none',
      source: 'fallback',
    });
    return { ticker: upper, source: 'fallback', segments: [], estimatedCostUsd: 0 };
  }

  const segments = await knownSegments(upper, fmpApiKey);
  const result = await tagNarrativeSegments(upper, news, segments, process.env.ANTHROPIC_API_KEY);

  if (!result) {
    log.info({ ticker: upper }, 'narrative-tag: LLM returned nothing — fallback');
    await persistTags({
      ticker: upper,
      segments: [],
      rationale: 'LLM tagging unavailable or no confident match',
      modelVersion: 'none',
      source: 'fallback',
    });
    return { ticker: upper, source: 'fallback', segments: [], estimatedCostUsd: 0 };
  }

  const segs = result.tags.map((t) => ({ name: t.segment, confidence: t.confidence }));
  await persistTags({
    ticker: upper,
    segments: segs,
    rationale: result.rationale,
    modelVersion: result.modelVersion,
    source: 'news',
  });
  log.info(
    { ticker: upper, segments: segs.length, estCost: EST_COST_PER_TICKER_USD },
    'narrative-tag: tagged via news',
  );
  return { ticker: upper, source: 'news', segments: segs, estimatedCostUsd: EST_COST_PER_TICKER_USD };
}

/** Are this ticker's narrative tags stale (>24h) or missing? */
export async function narrativeTagsStale(ticker: string): Promise<boolean> {
  const rows = await db
    .select({ asOf: schema.publicNarrativeTags.asOf })
    .from(schema.publicNarrativeTags)
    .where(eq(schema.publicNarrativeTags.ticker, ticker.toUpperCase()))
    .orderBy(sql`${schema.publicNarrativeTags.asOf} desc`)
    .limit(1);
  if (rows.length === 0) return true;
  return Date.now() - rows[0]!.asOf.getTime() > 24 * 60 * 60 * 1000;
}
