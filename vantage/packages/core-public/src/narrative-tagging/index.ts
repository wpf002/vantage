import { sql, type SQL } from 'drizzle-orm';

/**
 * Phase 10 — narrative tag reads. core-public stays DB-agnostic: callers pass
 * a drizzle handle. We read the most recent public_narrative_tags row for a
 * ticker and treat tags older than 24h (or missing) as stale, returning null
 * so the caller can trigger re-tagging via the cron — never on page load.
 */

export interface NarrativeSegmentTag {
  name: string;
  confidence: number;
}

export interface NarrativeTags {
  ticker: string;
  asOf: string;
  segments: NarrativeSegmentTag[];
  source: string;
  modelVersion: string;
}

/** Minimal drizzle surface — avoids depending on the api schema. */
export interface NarrativeTagDb {
  execute(query: SQL): Promise<unknown>;
}

const STALE_MS = 24 * 60 * 60 * 1000;

export async function getNarrativeTagsForTicker(
  db: NarrativeTagDb,
  ticker: string,
): Promise<NarrativeTags | null> {
  const rows = (await db.execute(sql`
    select ticker, as_of, narrative_segments, source, model_version
    from public_narrative_tags
    where ticker = ${ticker} and as_of <= now()
    order by as_of desc
    limit 1
  `)) as unknown as Array<{
    ticker: string;
    as_of: string | Date;
    narrative_segments: unknown;
    source: string;
    model_version: string;
  }>;

  const row = rows[0];
  if (!row) return null;

  const asOf = new Date(row.as_of);
  if (Date.now() - asOf.getTime() > STALE_MS) return null;

  const segments = Array.isArray(row.narrative_segments)
    ? (row.narrative_segments as Array<{ name: string; confidence: number }>)
    : [];

  return {
    ticker: row.ticker,
    asOf: asOf.toISOString(),
    segments: segments.map((s) => ({ name: s.name, confidence: s.confidence })),
    source: row.source,
    modelVersion: row.model_version,
  };
}

export * from './news-fetcher.js';
export * from './tagger.js';
