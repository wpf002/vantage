import { createHash } from 'node:crypto';
import pino from 'pino';
import { and, gte, eq, desc, sql } from 'drizzle-orm';
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

// Per-tag cost estimate used only for the daily budget guard. Tuned to the
// actual model: Haiku 4.5 with ~1-2k input + <=256 output ≈ $0.002-0.003/call.
// (Was 0.05 for Opus — leaving it stale made the $50 cap fall ~2/3 of the
// universe back to the heuristic despite real spend being only a few dollars.)
const EST_COST_PER_TICKER_USD = Number(process.env.NARRATIVE_TAG_EST_COST_USD ?? 0.003);
const DAILY_BUDGET_USD = Number(process.env.NARRATIVE_TAGGING_DAILY_BUDGET_USD ?? 50);

// Narrative segments (which product line is the story) are slow-moving, so a
// weekly refresh is plenty — re-tagging every 24h was the main token sink.
const STALE_AFTER_MS = Number(process.env.NARRATIVE_TAG_TTL_HOURS ?? 168) * 60 * 60 * 1000;

/** Stable hash of the headlines a tag is derived from (mirrors the tagger's
 * top-40 slice), so we can skip the LLM when news is unchanged. */
function hashNews(news: Array<{ title: string }>): string {
  const basis = news
    .slice(0, 40)
    .map((n) => n.title.trim())
    .join('\n');
  return createHash('sha256').update(basis).digest('hex');
}

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
  newsHash?: string | null;
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
      newsHash: input.newsHash ?? null,
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

  // News-change dedup — if the headlines are identical to the last news-based
  // tag, the narrative hasn't moved. Refresh freshness (so the daily sweep
  // won't re-enqueue it) and skip the LLM call entirely.
  const newsHash = hashNews(news);
  const [prior] = await db
    .select({
      id: schema.publicNarrativeTags.id,
      newsHash: schema.publicNarrativeTags.newsHash,
      source: schema.publicNarrativeTags.source,
      narrativeSegments: schema.publicNarrativeTags.narrativeSegments,
    })
    .from(schema.publicNarrativeTags)
    .where(eq(schema.publicNarrativeTags.ticker, upper))
    .orderBy(desc(schema.publicNarrativeTags.asOf))
    .limit(1);
  if (prior && prior.source === 'news' && prior.newsHash && prior.newsHash === newsHash) {
    await db
      .update(schema.publicNarrativeTags)
      .set({ asOf: new Date() })
      .where(eq(schema.publicNarrativeTags.id, prior.id));
    const segs = prior.narrativeSegments as Array<{ name: string; confidence: number }>;
    log.info({ ticker: upper }, 'narrative-tag: news unchanged — refreshed, skipped LLM');
    return { ticker: upper, source: 'news', segments: segs, estimatedCostUsd: 0 };
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
    newsHash,
  });
  log.info(
    { ticker: upper, segments: segs.length, estCost: EST_COST_PER_TICKER_USD },
    'narrative-tag: tagged via news',
  );
  return { ticker: upper, source: 'news', segments: segs, estimatedCostUsd: EST_COST_PER_TICKER_USD };
}

/** Are this ticker's narrative tags stale (older than the TTL) or missing? */
export async function narrativeTagsStale(ticker: string): Promise<boolean> {
  const rows = await db
    .select({ asOf: schema.publicNarrativeTags.asOf })
    .from(schema.publicNarrativeTags)
    .where(eq(schema.publicNarrativeTags.ticker, ticker.toUpperCase()))
    .orderBy(sql`${schema.publicNarrativeTags.asOf} desc`)
    .limit(1);
  if (rows.length === 0) return true;
  return Date.now() - rows[0]!.asOf.getTime() > STALE_AFTER_MS;
}
