import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { AuthorizationError, NotFoundError } from '@vantage/shared';
import { schema, type DB } from './client.js';

/**
 * Phase 10 — watchlist persistence. Personal watchlists are owner-scoped;
 * system watchlists (kind='system', ownerUserId=null) are read-only and
 * visible to every signed-in user — analogous to The Default portfolio.
 */

export interface WatchlistSummary {
  id: string;
  name: string;
  kind: 'system' | 'personal';
  description: string | null;
  ownerUserId: string | null;
  itemCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistItemDetail {
  entity: string;
  addedAt: string;
  ticker: string | null;
  name: string | null;
  sector: string | null;
  assetClass: string | null;
  classConfidence: number | null;
  score: number | null;
  label: string | null;
  scoreConfidence: number | null;
  scoredAt: string | null;
}

export interface WatchlistDetail extends WatchlistSummary {
  items: WatchlistItemDetail[];
}

/** Item count + most-recent added_at, keyed by watchlist id. */
async function itemStats(
  db: DB,
  watchlistIds: string[],
): Promise<Map<string, { count: number; last: string | null }>> {
  const out = new Map<string, { count: number; last: string | null }>();
  if (watchlistIds.length === 0) return out;
  const rows = await db
    .select({
      watchlistId: schema.platformWatchlistItems.watchlistId,
      count: sql<number>`count(*)::int`,
      // postgres-js returns aggregate timestamps as ISO strings, not Date.
      last: sql<string | null>`max(${schema.platformWatchlistItems.addedAt})`,
    })
    .from(schema.platformWatchlistItems)
    .where(inArray(schema.platformWatchlistItems.watchlistId, watchlistIds))
    .groupBy(schema.platformWatchlistItems.watchlistId);
  for (const r of rows) out.set(r.watchlistId, { count: Number(r.count), last: r.last });
  return out;
}

function toSummary(
  row: typeof schema.platformWatchlists.$inferSelect,
  stat: { count: number; last: string | null } | undefined,
): WatchlistSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    ownerUserId: row.ownerUserId,
    itemCount: stat?.count ?? 0,
    lastActivityAt: stat?.last ? new Date(stat.last).toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A user's personal watchlists plus every system watchlist. */
export async function listWatchlistsForUser(
  db: DB,
  userId: string,
): Promise<{ mine: WatchlistSummary[]; system: WatchlistSummary[] }> {
  const rows = await db
    .select()
    .from(schema.platformWatchlists)
    .where(
      or(
        eq(schema.platformWatchlists.ownerUserId, userId),
        eq(schema.platformWatchlists.kind, 'system'),
      ),
    )
    .orderBy(desc(schema.platformWatchlists.updatedAt));
  const stats = await itemStats(
    db,
    rows.map((r) => r.id),
  );
  const mine: WatchlistSummary[] = [];
  const system: WatchlistSummary[] = [];
  for (const row of rows) {
    const s = toSummary(row, stats.get(row.id));
    if (row.kind === 'system') system.push(s);
    else mine.push(s);
  }
  return { mine, system };
}

export async function listSystemWatchlists(db: DB): Promise<WatchlistSummary[]> {
  const rows = await db
    .select()
    .from(schema.platformWatchlists)
    .where(eq(schema.platformWatchlists.kind, 'system'))
    .orderBy(desc(schema.platformWatchlists.updatedAt));
  const stats = await itemStats(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toSummary(r, stats.get(r.id)));
}

export async function getWatchlistRow(
  db: DB,
  id: string,
): Promise<typeof schema.platformWatchlists.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.platformWatchlists)
    .where(eq(schema.platformWatchlists.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fetch a watchlist with its items, each joined to company metadata + the
 * latest classification and public score so the UI renders current state in
 * one round-trip. Match is on ticker first, falling back to company UUID for
 * private entities.
 */
export async function getWatchlistWithItems(
  db: DB,
  id: string,
): Promise<WatchlistDetail | null> {
  const row = await getWatchlistRow(db, id);
  if (!row) return null;
  const stats = await itemStats(db, [id]);

  const items = (await db.execute(sql`
    select
      i.entity,
      i.added_at,
      c.ticker,
      c.name,
      c.sector,
      lc.asset_class,
      lc.confidence as class_confidence,
      ls.score,
      ls.label,
      ls.confidence as score_confidence,
      ls.as_of as scored_at
    from ${schema.platformWatchlistItems} i
    left join ${schema.platformCompanies} c
      on c.ticker = i.entity or c.id::text = i.entity
    left join lateral (
      select asset_class, confidence
      from ${schema.platformClassifications}
      where entity = i.entity
      order by as_of desc
      limit 1
    ) lc on true
    left join lateral (
      select score, label, confidence, as_of
      from ${schema.publicScores}
      where ticker = i.entity
      order by as_of desc
      limit 1
    ) ls on true
    where i.watchlist_id = ${id}::uuid
    order by i.added_at desc
  `)) as unknown as Array<{
    entity: string;
    added_at: string;
    ticker: string | null;
    name: string | null;
    sector: string | null;
    asset_class: string | null;
    class_confidence: number | null;
    score: number | null;
    label: string | null;
    score_confidence: number | null;
    scored_at: string | null;
  }>;

  const mapped: WatchlistItemDetail[] = items.map((r) => ({
    entity: r.entity,
    addedAt: new Date(r.added_at).toISOString(),
    ticker: r.ticker,
    name: r.name,
    sector: r.sector,
    assetClass: r.asset_class,
    classConfidence: r.class_confidence,
    score: r.score,
    label: r.label,
    scoreConfidence: r.score_confidence,
    scoredAt: r.scored_at ? new Date(r.scored_at).toISOString() : null,
  }));

  return { ...toSummary(row, stats.get(id)), items: mapped };
}

export async function createWatchlist(
  db: DB,
  input: { ownerUserId: string; name: string; description?: string | null },
): Promise<{ id: string }> {
  const [created] = await db
    .insert(schema.platformWatchlists)
    .values({
      ownerUserId: input.ownerUserId,
      kind: 'personal',
      name: input.name,
      description: input.description ?? null,
    })
    .returning({ id: schema.platformWatchlists.id });
  return { id: created!.id };
}

/** Owner-only mutations throw NotFound (hide existence) / Authorization. */
async function requireOwned(
  db: DB,
  id: string,
  userId: string,
): Promise<typeof schema.platformWatchlists.$inferSelect> {
  const row = await getWatchlistRow(db, id);
  if (!row) throw new NotFoundError('watchlist', id);
  if (row.kind === 'system' || row.ownerUserId !== userId) {
    throw new AuthorizationError('only the owner may modify this watchlist');
  }
  return row;
}

export async function updateWatchlist(
  db: DB,
  id: string,
  userId: string,
  patch: { name?: string; description?: string | null },
): Promise<{ id: string }> {
  await requireOwned(db, id, userId);
  const set: Partial<typeof schema.platformWatchlists.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  await db
    .update(schema.platformWatchlists)
    .set(set)
    .where(eq(schema.platformWatchlists.id, id));
  return { id };
}

export async function deleteWatchlist(db: DB, id: string, userId: string): Promise<void> {
  await requireOwned(db, id, userId);
  await db.delete(schema.platformWatchlists).where(eq(schema.platformWatchlists.id, id));
}

export async function addWatchlistItem(
  db: DB,
  id: string,
  userId: string,
  entity: string,
): Promise<{ added: boolean }> {
  await requireOwned(db, id, userId);
  const inserted = await db
    .insert(schema.platformWatchlistItems)
    .values({ watchlistId: id, entity })
    .onConflictDoNothing()
    .returning({ id: schema.platformWatchlistItems.id });
  await db
    .update(schema.platformWatchlists)
    .set({ updatedAt: new Date() })
    .where(eq(schema.platformWatchlists.id, id));
  return { added: inserted.length > 0 };
}

export async function removeWatchlistItem(
  db: DB,
  id: string,
  userId: string,
  entity: string,
): Promise<void> {
  await requireOwned(db, id, userId);
  await db
    .delete(schema.platformWatchlistItems)
    .where(
      and(
        eq(schema.platformWatchlistItems.watchlistId, id),
        eq(schema.platformWatchlistItems.entity, entity),
      ),
    );
}

/** Watchlists (any kind) whose items include `entity` — used by the evaluator. */
export async function watchlistsContainingEntity(
  db: DB,
  entity: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ watchlistId: schema.platformWatchlistItems.watchlistId })
    .from(schema.platformWatchlistItems)
    .where(eq(schema.platformWatchlistItems.entity, entity));
  return rows.map((r) => r.watchlistId);
}

