import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { AuthorizationError, NotFoundError } from '@vantage/shared';
import { schema, type DB } from './client.js';
import type { AlertChannels, AlertRuleType } from '../alerts/config.js';

/**
 * Phase 10 — alert rule + event + push-subscription persistence. Rules are
 * owner-scoped and attached to a watchlist; the evaluator worker matches the
 * signal stream against active rules and records events here.
 */

export type AlertRuleRow = typeof schema.platformAlertRules.$inferSelect;
export type AlertEventRow = typeof schema.platformAlertEvents.$inferSelect;
export type PushSubscriptionRow = typeof schema.platformPushSubscriptions.$inferSelect;

// ── Rules ──────────────────────────────────────────────────────────────────

export async function listRulesForUser(db: DB, userId: string): Promise<AlertRuleRow[]> {
  return db
    .select()
    .from(schema.platformAlertRules)
    .where(eq(schema.platformAlertRules.ownerUserId, userId))
    .orderBy(desc(schema.platformAlertRules.createdAt));
}

export async function listRulesForWatchlist(
  db: DB,
  watchlistId: string,
): Promise<AlertRuleRow[]> {
  return db
    .select()
    .from(schema.platformAlertRules)
    .where(eq(schema.platformAlertRules.watchlistId, watchlistId))
    .orderBy(desc(schema.platformAlertRules.createdAt));
}

export async function createRule(
  db: DB,
  input: {
    watchlistId: string;
    ownerUserId: string;
    ruleType: AlertRuleType;
    config: Record<string, unknown>;
    channels: AlertChannels;
  },
): Promise<{ id: string }> {
  // Ownership: the watchlist must be owned by this user (system watchlists
  // can't carry personal rules).
  const wl = await db
    .select({ ownerUserId: schema.platformWatchlists.ownerUserId, kind: schema.platformWatchlists.kind })
    .from(schema.platformWatchlists)
    .where(eq(schema.platformWatchlists.id, input.watchlistId))
    .limit(1);
  if (wl.length === 0) throw new NotFoundError('watchlist', input.watchlistId);
  if (wl[0]!.kind === 'system' || wl[0]!.ownerUserId !== input.ownerUserId) {
    throw new AuthorizationError('you can only add rules to your own watchlists');
  }
  const [row] = await db
    .insert(schema.platformAlertRules)
    .values({
      watchlistId: input.watchlistId,
      ownerUserId: input.ownerUserId,
      ruleType: input.ruleType,
      config: input.config,
      channels: input.channels,
    })
    .returning({ id: schema.platformAlertRules.id });
  return { id: row!.id };
}

async function requireOwnedRule(db: DB, id: string, userId: string): Promise<AlertRuleRow> {
  const rows = await db
    .select()
    .from(schema.platformAlertRules)
    .where(eq(schema.platformAlertRules.id, id))
    .limit(1);
  if (rows.length === 0) throw new NotFoundError('alert rule', id);
  if (rows[0]!.ownerUserId !== userId) {
    throw new AuthorizationError('only the owner may modify this rule');
  }
  return rows[0]!;
}

export async function updateRule(
  db: DB,
  id: string,
  userId: string,
  patch: { config?: Record<string, unknown>; channels?: AlertChannels; active?: boolean },
): Promise<{ id: string }> {
  await requireOwnedRule(db, id, userId);
  const set: Partial<typeof schema.platformAlertRules.$inferInsert> = {};
  if (patch.config !== undefined) set.config = patch.config;
  if (patch.channels !== undefined) set.channels = patch.channels;
  if (patch.active !== undefined) set.active = patch.active;
  await db.update(schema.platformAlertRules).set(set).where(eq(schema.platformAlertRules.id, id));
  return { id };
}

export async function deleteRule(db: DB, id: string, userId: string): Promise<void> {
  await requireOwnedRule(db, id, userId);
  await db.delete(schema.platformAlertRules).where(eq(schema.platformAlertRules.id, id));
}

export async function getRuleById(db: DB, id: string): Promise<AlertRuleRow | null> {
  const rows = await db
    .select()
    .from(schema.platformAlertRules)
    .where(eq(schema.platformAlertRules.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Active rules whose watchlist contains `entity`, optionally filtered by type. */
export async function activeRulesForEntity(
  db: DB,
  entity: string,
  ruleTypes?: AlertRuleType[],
): Promise<AlertRuleRow[]> {
  const rows = await db
    .select({ rule: schema.platformAlertRules })
    .from(schema.platformAlertRules)
    .innerJoin(
      schema.platformWatchlistItems,
      eq(schema.platformWatchlistItems.watchlistId, schema.platformAlertRules.watchlistId),
    )
    .where(
      and(
        eq(schema.platformAlertRules.active, true),
        eq(schema.platformWatchlistItems.entity, entity),
      ),
    );
  // A rule may match more than once if multiple of the user's watchlists hold
  // the entity — dedupe by rule id.
  const seen = new Map<string, AlertRuleRow>();
  for (const r of rows) {
    if (ruleTypes && !ruleTypes.includes(r.rule.ruleType as AlertRuleType)) continue;
    seen.set(r.rule.id, r.rule);
  }
  return [...seen.values()];
}

export async function listActiveDigestRules(db: DB): Promise<AlertRuleRow[]> {
  return db
    .select()
    .from(schema.platformAlertRules)
    .where(
      and(
        eq(schema.platformAlertRules.active, true),
        eq(schema.platformAlertRules.ruleType, 'morning_digest'),
      ),
    );
}

export async function markRuleFired(db: DB, id: string): Promise<void> {
  await db
    .update(schema.platformAlertRules)
    .set({ lastFiredAt: new Date() })
    .where(eq(schema.platformAlertRules.id, id));
}

// ── Events ───────────────────────────────────────────────────────────────────

/** Idempotency guard: has this (rule, signal) pair already produced an event? */
export async function eventExists(
  db: DB,
  ruleId: string,
  triggerSignalId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.platformAlertEvents.id })
    .from(schema.platformAlertEvents)
    .where(
      and(
        eq(schema.platformAlertEvents.ruleId, ruleId),
        eq(schema.platformAlertEvents.triggerSignalId, triggerSignalId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertEvent(
  db: DB,
  input: {
    ruleId: string;
    ownerUserId: string;
    entity: string;
    triggerSignalId: string | null;
    payload: Record<string, unknown>;
    channels: AlertChannels;
    channelResults?: Record<string, string>;
  },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.platformAlertEvents)
    .values({
      ruleId: input.ruleId,
      ownerUserId: input.ownerUserId,
      entity: input.entity,
      triggerSignalId: input.triggerSignalId,
      payload: input.payload,
      channels: input.channels,
      channelResults: input.channelResults ?? {},
    })
    .returning({ id: schema.platformAlertEvents.id });
  return { id: row!.id };
}

export async function setEventChannelResults(
  db: DB,
  id: string,
  channelResults: Record<string, string>,
): Promise<void> {
  await db
    .update(schema.platformAlertEvents)
    .set({ channelResults })
    .where(eq(schema.platformAlertEvents.id, id));
}

export interface EventFeedItem {
  id: string;
  ruleId: string;
  entity: string;
  ruleType: string;
  payload: Record<string, unknown>;
  watchlistId: string | null;
  watchlistName: string | null;
  dispatchedAt: string;
  acknowledgedAt: string | null;
}

/** Cursor-paginated event feed for a user, newest first. Cursor is ISO dispatchedAt. */
export async function listEvents(
  db: DB,
  userId: string,
  opts: { cursor?: string; limit: number; unreadOnly?: boolean },
): Promise<{ events: EventFeedItem[]; nextCursor: string | null }> {
  const conds = [eq(schema.platformAlertEvents.ownerUserId, userId)];
  if (opts.unreadOnly) conds.push(isNull(schema.platformAlertEvents.acknowledgedAt));
  if (opts.cursor) conds.push(lt(schema.platformAlertEvents.dispatchedAt, new Date(opts.cursor)));

  const rows = await db
    .select({
      id: schema.platformAlertEvents.id,
      ruleId: schema.platformAlertEvents.ruleId,
      entity: schema.platformAlertEvents.entity,
      payload: schema.platformAlertEvents.payload,
      dispatchedAt: schema.platformAlertEvents.dispatchedAt,
      acknowledgedAt: schema.platformAlertEvents.acknowledgedAt,
      ruleType: schema.platformAlertRules.ruleType,
      watchlistId: schema.platformAlertRules.watchlistId,
      watchlistName: schema.platformWatchlists.name,
    })
    .from(schema.platformAlertEvents)
    .leftJoin(
      schema.platformAlertRules,
      eq(schema.platformAlertRules.id, schema.platformAlertEvents.ruleId),
    )
    .leftJoin(
      schema.platformWatchlists,
      eq(schema.platformWatchlists.id, schema.platformAlertRules.watchlistId),
    )
    .where(and(...conds))
    .orderBy(desc(schema.platformAlertEvents.dispatchedAt))
    .limit(opts.limit + 1);

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const events: EventFeedItem[] = page.map((r) => ({
    id: r.id,
    ruleId: r.ruleId,
    entity: r.entity,
    ruleType: r.ruleType ?? 'unknown',
    payload: (r.payload ?? {}) as Record<string, unknown>,
    watchlistId: r.watchlistId ?? null,
    watchlistName: r.watchlistName ?? null,
    dispatchedAt: r.dispatchedAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt ? r.acknowledgedAt.toISOString() : null,
  }));
  const nextCursor = hasMore ? page[page.length - 1]!.dispatchedAt.toISOString() : null;
  return { events, nextCursor };
}

export async function countUnread(db: DB, userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.platformAlertEvents)
    .where(
      and(
        eq(schema.platformAlertEvents.ownerUserId, userId),
        isNull(schema.platformAlertEvents.acknowledgedAt),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function acknowledgeEvent(db: DB, id: string, userId: string): Promise<void> {
  await db
    .update(schema.platformAlertEvents)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        eq(schema.platformAlertEvents.id, id),
        eq(schema.platformAlertEvents.ownerUserId, userId),
      ),
    );
}

export async function acknowledgeAll(db: DB, userId: string): Promise<number> {
  const updated = await db
    .update(schema.platformAlertEvents)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        eq(schema.platformAlertEvents.ownerUserId, userId),
        isNull(schema.platformAlertEvents.acknowledgedAt),
      ),
    )
    .returning({ id: schema.platformAlertEvents.id });
  return updated.length;
}

// ── Push subscriptions ───────────────────────────────────────────────────────

export async function listPushSubscriptions(
  db: DB,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(schema.platformPushSubscriptions)
    .where(eq(schema.platformPushSubscriptions.userId, userId));
}

export async function upsertPushSubscription(
  db: DB,
  input: { userId: string; endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string | null },
): Promise<void> {
  await db
    .insert(schema.platformPushSubscriptions)
    .values({
      userId: input.userId,
      endpoint: input.endpoint,
      keys: input.keys,
      userAgent: input.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.platformPushSubscriptions.userId, schema.platformPushSubscriptions.endpoint],
      set: { keys: input.keys, userAgent: input.userAgent ?? null },
    });
}

export async function deletePushSubscription(
  db: DB,
  userId: string,
  endpoint?: string,
): Promise<void> {
  const conds = [eq(schema.platformPushSubscriptions.userId, userId)];
  if (endpoint) conds.push(eq(schema.platformPushSubscriptions.endpoint, endpoint));
  await db.delete(schema.platformPushSubscriptions).where(and(...conds));
}

// ── Evaluation reads — latest two scores / classifications for an entity ──────

export interface ScoreSnapshot {
  score: number;
  label: string;
  asOf: string;
}

export async function latestTwoScores(db: DB, ticker: string): Promise<ScoreSnapshot[]> {
  const rows = await db
    .select({
      score: schema.publicScores.score,
      label: schema.publicScores.label,
      asOf: schema.publicScores.asOf,
    })
    .from(schema.publicScores)
    .where(eq(schema.publicScores.ticker, ticker))
    .orderBy(desc(schema.publicScores.asOf))
    .limit(2);
  return rows.map((r) => ({ score: r.score, label: r.label, asOf: r.asOf.toISOString() }));
}

export interface ClassSnapshot {
  assetClass: string;
  asOf: string;
}

export async function latestTwoClassifications(db: DB, entity: string): Promise<ClassSnapshot[]> {
  const rows = await db
    .select({ assetClass: schema.platformClassifications.assetClass, asOf: schema.platformClassifications.asOf })
    .from(schema.platformClassifications)
    .where(eq(schema.platformClassifications.entity, entity))
    .orderBy(desc(schema.platformClassifications.asOf))
    .limit(2);
  return rows.map((r) => ({ assetClass: r.assetClass, asOf: r.asOf.toISOString() }));
}
