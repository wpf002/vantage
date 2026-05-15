import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, sql, inArray, desc, eq } from 'drizzle-orm';
import { NotFoundError } from '@vantage/shared';
import { db, schema } from '../db/client.js';

/**
 * Read-only access to the platform_classifications table, surfacing only the
 * most recent classification per entity (history is preserved in the table
 * but never returned in bulk).
 *
 * Production writes happen via the worker queue — see queues/workers.ts. The
 * older POST /v1/classify endpoint is still wired for ad-hoc testing but is
 * no longer the canonical path.
 */

const ListQuery = z.object({
  class: z.enum(['CORE', 'HIGH_ASYMMETRY', 'TACTICAL', 'AVOID']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime().optional(),
});

const EntityParams = z.object({ entity: z.string() });

/**
 * DISTINCT ON (entity) — one row per entity, the most recent. Postgres-only
 * but we're Postgres-only by design.
 */
const latestPerEntitySQL = sql`
  SELECT DISTINCT ON (entity)
    id, entity, asset_class, confidence, rationale, contributing_signals, as_of
  FROM platform_classifications
  ORDER BY entity, as_of DESC
`;

interface LatestRow {
  id: string;
  entity: string;
  asset_class: 'CORE' | 'HIGH_ASYMMETRY' | 'TACTICAL' | 'AVOID';
  confidence: number;
  rationale: string;
  contributing_signals: unknown;
  // Postgres returns this as an ISO string via db.execute(); not a Date.
  as_of: string;
}

export const classificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── GET / ─────────────────────────────────────────────────────────────
  app.get(
    '/',
    { schema: { querystring: ListQuery } },
    async (req) => {
      const { class: assetClass, limit, cursor } = req.query;

      const rawRows = (await db.execute(latestPerEntitySQL)) as unknown as LatestRow[];
      // The pg driver hands timestamps back as ISO strings via raw execute(),
      // so normalize once up front instead of converting at every comparison.
      const rows = rawRows.map((r) => ({ ...r, asOfMs: new Date(r.as_of).getTime() }));

      let filtered = rows;
      if (assetClass) filtered = filtered.filter((r) => r.asset_class === assetClass);
      if (cursor) {
        const cutoff = new Date(cursor).getTime();
        filtered = filtered.filter((r) => r.asOfMs < cutoff);
      }
      filtered.sort((a, b) => b.asOfMs - a.asOfMs);
      filtered = filtered.slice(0, limit);

      const entities = filtered.map((r) => r.entity);
      const companyById = new Map<string, typeof schema.platformCompanies.$inferSelect>();
      const companyByTicker = new Map<string, typeof schema.platformCompanies.$inferSelect>();
      if (entities.length > 0) {
        const idGuess = entities.filter((e) => /^[0-9a-f-]{36}$/i.test(e));
        const tickerGuess = entities.filter((e) => !/^[0-9a-f-]{36}$/i.test(e));

        if (idGuess.length > 0) {
          const byId = await db
            .select()
            .from(schema.platformCompanies)
            .where(inArray(schema.platformCompanies.id, idGuess));
          for (const c of byId) companyById.set(c.id, c);
        }
        if (tickerGuess.length > 0) {
          const byTicker = await db
            .select()
            .from(schema.platformCompanies)
            .where(inArray(schema.platformCompanies.ticker, tickerGuess));
          for (const c of byTicker) {
            if (c.ticker) companyByTicker.set(c.ticker, c);
          }
        }
      }

      return filtered.map((r) => {
        const company = companyById.get(r.entity) ?? companyByTicker.get(r.entity);
        return {
          entity: r.entity,
          name: company?.name ?? r.entity,
          ticker: company?.ticker ?? null,
          marketType: company?.marketType ?? null,
          sector: company?.sector ?? null,
          assetClass: r.asset_class,
          confidence: r.confidence,
          rationale: r.rationale,
          asOf: new Date(r.as_of).toISOString(),
        };
      });
    },
  );

  // ── GET /:entity — most recent + expanded contributing signals ───────
  app.get(
    '/:entity',
    { schema: { params: EntityParams } },
    async (req) => {
      const { entity } = req.params;

      const rows = await db
        .select()
        .from(schema.platformClassifications)
        .where(eq(schema.platformClassifications.entity, entity))
        .orderBy(desc(schema.platformClassifications.asOf))
        .limit(1);
      if (rows.length === 0) throw new NotFoundError('classification', entity);
      const c = rows[0]!;

      // contributingSignals is a jsonb array of signal-type strings; pull the
      // latest matching signal per type for the same entity so the UI can
      // render the underlying scores and confidences.
      const types = Array.isArray(c.contributingSignals)
        ? (c.contributingSignals as string[])
        : [];
      const recentSignals =
        types.length === 0
          ? []
          : await db
              .select()
              .from(schema.platformSignals)
              .where(
                and(
                  eq(schema.platformSignals.entity, entity),
                  inArray(schema.platformSignals.signalType, types),
                ),
              )
              .orderBy(desc(schema.platformSignals.timestamp))
              .limit(50);

      // Keep only the most recent per signalType.
      const seen = new Set<string>();
      const contributing: typeof recentSignals = [];
      for (const s of recentSignals) {
        if (seen.has(s.signalType)) continue;
        seen.add(s.signalType);
        contributing.push(s);
      }

      // Optional company chrome.
      const isUuid = /^[0-9a-f-]{36}$/i.test(entity);
      const companyRow = isUuid
        ? await db
            .select()
            .from(schema.platformCompanies)
            .where(eq(schema.platformCompanies.id, entity))
            .limit(1)
        : await db
            .select()
            .from(schema.platformCompanies)
            .where(eq(schema.platformCompanies.ticker, entity))
            .limit(1);
      const company = companyRow[0] ?? null;

      return {
        entity: c.entity,
        name: company?.name ?? c.entity,
        ticker: company?.ticker ?? null,
        marketType: company?.marketType ?? null,
        sector: company?.sector ?? null,
        assetClass: c.assetClass,
        confidence: c.confidence,
        rationale: c.rationale,
        contributingSignals: contributing.map((s) => ({
          signalType: s.signalType,
          direction: s.direction,
          magnitude: s.magnitude,
          confidence: s.confidence,
          rationale: s.rationale,
          timestamp: s.timestamp.toISOString(),
        })),
        asOf: c.asOf.toISOString(),
      };
    },
  );
};
