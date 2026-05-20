import { and, desc, eq, lte } from 'drizzle-orm';
import type { FmpClient, FmpHistoricalPrice } from '@vantage/data-ingest/public';
import { schema, type DB } from '../../db/client.js';

/**
 * Shared IO helpers for the Phase 8 outcome resolvers.
 *
 * Resolvers are best-effort: every function here returns null rather than
 * throwing when the data simply isn't there (delisted ticker, never-scored
 * private company, missing valuation metadata). A null bubbles up to the
 * dispatcher as "skipped — insufficient data"; the decision stays unresolved
 * and the next nightly run tries again. Genuine errors (network, bad key) are
 * left to throw so the dispatcher counts them as failures.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The slice of a platform_decisions row each resolver works from. */
export interface DecisionRow {
  id: string;
  entity: string;
  decisionType: string;
  decisionPayload: unknown;
  createdAt: Date;
}

/** Shared upstream handles passed to every resolver. */
export interface OutcomeContext {
  fmp: FmpClient | null; // null when FMP_API_KEY is unset
  fmpApiKey: string | null;
}

/** A resolved outcome payload, or null when there isn't enough data to resolve. */
export type ResolvedOutcome = Record<string, unknown> | null;

/** Daily closes for a symbol, ascending by date, covering [from, now]. */
export async function fetchPriceSeries(
  fmp: FmpClient,
  symbol: string,
  from: Date,
): Promise<FmpHistoricalPrice[]> {
  const days = Math.ceil((Date.now() - from.getTime()) / DAY_MS) + 5;
  const rows = await fmp.historicalPrices(symbol, days);
  return [...rows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/** Close on the last trading day at or before `target`; first available if none precede it. */
export function priceAsOf(series: FmpHistoricalPrice[], target: Date): number | null {
  if (series.length === 0) return null;
  const t = target.getTime();
  let chosen: number | null = null;
  for (const p of series) {
    if (new Date(p.date).getTime() <= t) chosen = p.close;
    else break;
  }
  return chosen ?? series[0]!.close;
}

export interface HorizonReturns {
  base: number | null;
  realizedReturn30d?: number;
  realizedReturn60d?: number;
  realizedReturn90d?: number;
  realizedReturn180d?: number;
}

/** Forward returns at 30/60/90/180 days from `from`, where the series reaches that far. */
export function horizonReturns(series: FmpHistoricalPrice[], from: Date): HorizonReturns {
  const base = priceAsOf(series, from);
  if (base === null || base === 0 || series.length === 0) return { base: null };
  const lastTs = new Date(series[series.length - 1]!.date).getTime();
  const out: HorizonReturns = { base };
  const horizons: Array<[keyof HorizonReturns, number]> = [
    ['realizedReturn30d', 30],
    ['realizedReturn60d', 60],
    ['realizedReturn90d', 90],
    ['realizedReturn180d', 180],
  ];
  for (const [key, days] of horizons) {
    const target = from.getTime() + days * DAY_MS;
    if (target > lastTs) continue; // not enough history yet
    const px = priceAsOf(series, new Date(target));
    if (px !== null) out[key] = (px - base) / base;
  }
  return out;
}

/** Simple price change from `from` to the most recent close. */
export function priceReturnToNow(series: FmpHistoricalPrice[], from: Date): number | null {
  const base = priceAsOf(series, from);
  if (base === null || base === 0 || series.length === 0) return null;
  const latest = series[series.length - 1]!.close;
  return (latest - base) / base;
}

/** Read `finalValuation.base` from a private blended-valuation signal's metadata. */
function blendedBaseFromMetadata(metadata: unknown): number | null {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const fv = meta.finalValuation as Record<string, unknown> | undefined;
  const base = fv?.base;
  return typeof base === 'number' && Number.isFinite(base) ? base : null;
}

/**
 * The blended private valuation base for `entity` as of `at` (most recent
 * blended_valuation signal at or before that time). Used to anchor the
 * "original" base for private-valuation and private-classification outcomes.
 */
export async function blendedBaseAsOf(
  db: DB,
  entity: string,
  at: Date,
): Promise<number | null> {
  const rows = await db
    .select({ metadata: schema.platformSignals.metadata })
    .from(schema.platformSignals)
    .where(
      and(
        eq(schema.platformSignals.entity, entity),
        eq(schema.platformSignals.signalType, 'private.blended_valuation'),
        lte(schema.platformSignals.timestamp, at),
      ),
    )
    .orderBy(desc(schema.platformSignals.timestamp))
    .limit(1);
  if (rows.length === 0) return null;
  return blendedBaseFromMetadata(rows[0]!.metadata);
}

/** The most recent blended private valuation base for `entity` (latest of all). */
export async function blendedBaseLatest(db: DB, entity: string): Promise<number | null> {
  const rows = await db
    .select({ metadata: schema.platformSignals.metadata })
    .from(schema.platformSignals)
    .where(
      and(
        eq(schema.platformSignals.entity, entity),
        eq(schema.platformSignals.signalType, 'private.blended_valuation'),
      ),
    )
    .orderBy(desc(schema.platformSignals.timestamp))
    .limit(1);
  if (rows.length === 0) return null;
  return blendedBaseFromMetadata(rows[0]!.metadata);
}

/** True if `entity` has ever produced a private blended valuation (i.e. is a private name). */
export async function isPrivateEntity(db: DB, entity: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.platformSignals.id })
    .from(schema.platformSignals)
    .where(
      and(
        eq(schema.platformSignals.entity, entity),
        eq(schema.platformSignals.signalType, 'private.blended_valuation'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Realized return for any entity between `from` and now.
 *   - private name → change in blended valuation base
 *   - public ticker → price change from FMP
 * Returns null when neither path has data.
 */
export async function realizedReturnForEntity(
  db: DB,
  entity: string,
  from: Date,
  fmp: FmpClient | null,
): Promise<number | null> {
  if (await isPrivateEntity(db, entity)) {
    const base = await blendedBaseAsOf(db, entity, from);
    const latest = await blendedBaseLatest(db, entity);
    if (base === null || latest === null || base === 0) return null;
    return (latest - base) / base;
  }
  if (!fmp || UUID_SHAPE.test(entity)) return null;
  try {
    const series = await fetchPriceSeries(fmp, entity, from);
    return priceReturnToNow(series, from);
  } catch {
    return null;
  }
}
