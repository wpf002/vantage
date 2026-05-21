import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

/**
 * Phase 9 — the Screener. A browsable, paginated view over the entire scored
 * public universe. Pure reads against public_scores + platform_companies +
 * platform_classifications; no fresh FMP calls, no scoring.
 *
 * Pagination is cursor-based (not offset), so the result set is stable as new
 * scores land underneath an open page. The cursor encodes the chosen sort
 * key's value plus the entity id as a tiebreaker.
 */

// Canonical label values match the DB (snake_case — see core-public/labels.ts).
// The spec's PascalCase examples are display forms; we filter on the stored
// value.
const PUBLIC_LABELS = [
  'aligned_strength',
  'expected_weakness',
  'validated_story',
  'temporary_relief',
  'cracks_forming',
  'story_on_thin_ice',
  'market_underreaction',
  'narrative_breakdown',
] as const;

const ASSET_CLASSES = ['CORE', 'HIGH_ASYMMETRY', 'TACTICAL', 'AVOID'] as const;
const SORT_FIELDS = ['score', 'recency', 'name', 'sector', 'confidence'] as const;
type SortField = (typeof SORT_FIELDS)[number];

/** Repeatable query params arrive as a single value or an array — normalize. */
const repeatable = <T extends z.ZodTypeAny>(inner: T) =>
  z
    .union([inner, z.array(inner)])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]));

const ScreenerQuery = z.object({
  label: repeatable(z.enum(PUBLIC_LABELS)),
  sector: repeatable(z.string()),
  class: repeatable(z.enum(ASSET_CLASSES)),
  scoreMin: z.coerce.number().min(0).max(100).optional(),
  scoreMax: z.coerce.number().min(0).max(100).optional(),
  confidenceMin: z.coerce.number().min(0).max(1).optional(),
  marketCapMin: z.coerce.number().min(0).optional(), // millions USD
  marketCapMax: z.coerce.number().min(0).optional(), // millions USD
  sortBy: z.enum(SORT_FIELDS).default('score'),
  sortDir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
type ScreenerQuery = z.infer<typeof ScreenerQuery>;

interface Cursor {
  k: string | number | null; // last row's sort-key value
  id: string; // last row's entity id (tiebreaker)
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf-8').toString('base64url');
}
function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
    if (parsed && typeof parsed.id === 'string') return parsed as Cursor;
    return null;
  } catch {
    return null;
  }
}

/** Default direction per field: desc for magnitudes/recency, asc for text. */
function defaultDir(field: SortField): 'asc' | 'desc' {
  return field === 'name' || field === 'sector' ? 'asc' : 'desc';
}

/** The SQL expression the chosen sort field maps onto, in the joined query. */
function sortKeyExpr(field: SortField) {
  switch (field) {
    case 'score':
      return sql`ls.score`;
    case 'recency':
      return sql`ls.as_of`;
    case 'name':
      return sql`c.name`;
    case 'sector':
      return sql`c.sector`;
    case 'confidence':
      return sql`ls.confidence`;
  }
}

interface ScreenerRow {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  market_cap: number | null;
  score: number;
  label: string;
  direction: string;
  confidence: number;
  asset_class: string | null;
  class_confidence: number | null;
  last_scored_at: string;
}

export const screenerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { querystring: ScreenerQuery } }, async (req) => {
    const q = req.query as ScreenerQuery;
    const dir = q.sortDir ?? defaultDir(q.sortBy);

    // ── WHERE clause shared by the page query and the count query ─────────
    const conds = [sql`c.market_type = 'public'`, sql`c.ticker IS NOT NULL`];
    if (q.label.length > 0) conds.push(sql`ls.label IN ${q.label}`);
    if (q.sector.length > 0) conds.push(sql`c.sector IN ${q.sector}`);
    if (q.class.length > 0) conds.push(sql`lc.asset_class IN ${q.class}`);
    if (q.scoreMin !== undefined) conds.push(sql`ls.score >= ${q.scoreMin}`);
    if (q.scoreMax !== undefined) conds.push(sql`ls.score <= ${q.scoreMax}`);
    if (q.confidenceMin !== undefined) conds.push(sql`ls.confidence >= ${q.confidenceMin}`);
    // marketCap params are millions; metadata stores raw USD.
    if (q.marketCapMin !== undefined) {
      conds.push(sql`(c.metadata->>'marketCap')::numeric >= ${q.marketCapMin * 1_000_000}`);
    }
    if (q.marketCapMax !== undefined) {
      conds.push(sql`(c.metadata->>'marketCap')::numeric <= ${q.marketCapMax * 1_000_000}`);
    }

    const keyExpr = sortKeyExpr(q.sortBy);

    // ── Cursor predicate — (sortKey, id) strictly after the last row ──────
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (cursor) {
      const cmp = dir === 'desc' ? sql.raw('<') : sql.raw('>');
      const kVal =
        cursor.k === null
          ? sql`NULL`
          : q.sortBy === 'recency'
            ? sql`${cursor.k}::timestamptz`
            : sql`${cursor.k}`;
      // NULLs sort last in both directions by default; the tiebreaker keeps the
      // walk total. Rows with a NULL key only appear once the key value matches.
      conds.push(sql`(${keyExpr} ${cmp} ${kVal} OR (${keyExpr} = ${kVal} AND c.id::text ${cmp} ${cursor.id}))`);
    }

    const whereSql = sql.join(conds, sql` AND `);
    const dirSql = dir === 'desc' ? sql.raw('DESC') : sql.raw('ASC');

    // latest score per ticker, latest classification per entity.
    const base = sql`
      FROM platform_companies c
      JOIN (
        SELECT DISTINCT ON (ticker) ticker, score, label, direction, confidence, as_of
        FROM public_scores
        ORDER BY ticker, as_of DESC
      ) ls ON ls.ticker = c.ticker
      LEFT JOIN (
        SELECT DISTINCT ON (entity) entity, asset_class, confidence
        FROM platform_classifications
        ORDER BY entity, as_of DESC
      ) lc ON lc.entity = c.ticker
      WHERE ${whereSql}
    `;

    const pageSql = sql`
      SELECT c.id, c.ticker, c.name, c.sector,
             (c.metadata->>'marketCap')::numeric AS market_cap,
             ls.score, ls.label, ls.direction, ls.confidence,
             lc.asset_class, lc.confidence AS class_confidence,
             ls.as_of AS last_scored_at
      ${base}
      ORDER BY ${keyExpr} ${dirSql}, c.id::text ${dirSql}
      LIMIT ${q.limit}
    `;

    const rows = (await db.execute(pageSql)) as unknown as ScreenerRow[];

    // totalEstimate — count over the filtered set, capped at 5000.
    const countRows = (await db.execute(
      sql`SELECT count(*)::int AS n FROM (SELECT 1 ${base} LIMIT 5000) t`,
    )) as unknown as Array<{ n: number }>;
    const totalEstimate = countRows[0]?.n ?? 0;

    let nextCursor: string | null = null;
    if (rows.length === q.limit) {
      const last = rows[rows.length - 1]!;
      const keyVal: string | number | null =
        q.sortBy === 'recency'
          ? new Date(last.last_scored_at).toISOString()
          : q.sortBy === 'name'
            ? last.name
            : q.sortBy === 'sector'
              ? last.sector
              : q.sortBy === 'confidence'
                ? last.confidence
                : last.score;
      nextCursor = encodeCursor({ k: keyVal, id: last.id });
    }

    return {
      results: rows.map((r) => ({
        ticker: r.ticker,
        name: r.name,
        sector: r.sector,
        marketCap: r.market_cap === null ? null : Number(r.market_cap),
        score: r.score,
        label: r.label,
        direction: r.direction,
        confidence: r.confidence,
        assetClass: r.asset_class,
        classConfidence: r.class_confidence,
        lastScoredAt: new Date(r.last_scored_at).toISOString(),
      })),
      nextCursor,
      appliedFilters: {
        label: q.label,
        sector: q.sector,
        class: q.class,
        scoreMin: q.scoreMin ?? null,
        scoreMax: q.scoreMax ?? null,
        confidenceMin: q.confidenceMin ?? null,
        marketCapMin: q.marketCapMin ?? null,
        marketCapMax: q.marketCapMax ?? null,
        sortBy: q.sortBy,
        sortDir: dir,
        limit: q.limit,
      },
      totalEstimate,
    };
  });
};
