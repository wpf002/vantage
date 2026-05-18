import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { NotFoundError } from '@vantage/shared';

const SignalIdParams = z.object({ signalId: z.string().uuid() });
const EntityParams = z.object({ entity: z.string().min(1) });
const ListQuery = z.object({
  signalType: z.string().optional(),
  entity: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().datetime().optional(),
});

interface SignalRow {
  id: string;
  entity: string;
  signalType: string;
  direction: 'bullish' | 'neutral' | 'bearish';
  magnitude: number;
  confidence: number;
  sourceVersion: string;
  rationale: string;
  metadata: unknown;
  timestamp: Date;
}

/**
 * For a batch of signals, build a map from entity → human label. Entities can
 * be:
 *   - public tickers (e.g. 'NVDA')        → platform_companies.name
 *   - company UUIDs                       → platform_companies.name
 *   - portfolio UUIDs (simulation signals)→ platform_portfolios.name
 * Looked up in two queries (companies + portfolios).
 */
async function buildEntityNameMap(rows: SignalRow[]): Promise<Map<string, string>> {
  const entities = Array.from(new Set(rows.map((r) => r.entity)));
  if (entities.length === 0) return new Map();
  const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tickers = entities.filter((e) => !uuidShape.test(e));
  const ids = entities.filter((e) => uuidShape.test(e));

  const map = new Map<string, string>();

  const companyConditions = [];
  if (tickers.length > 0) companyConditions.push(inArray(schema.platformCompanies.ticker, tickers));
  if (ids.length > 0) companyConditions.push(inArray(schema.platformCompanies.id, ids));
  if (companyConditions.length > 0) {
    const companies = await db
      .select({
        id: schema.platformCompanies.id,
        name: schema.platformCompanies.name,
        ticker: schema.platformCompanies.ticker,
      })
      .from(schema.platformCompanies)
      .where(companyConditions.length === 1 ? companyConditions[0]! : or(...companyConditions)!);
    for (const c of companies) {
      if (c.ticker) map.set(c.ticker, c.name);
      map.set(c.id, c.name);
    }
  }

  // Anything still unresolved that's UUID-shaped might be a portfolio.
  const unresolvedIds = ids.filter((id) => !map.has(id));
  if (unresolvedIds.length > 0) {
    const portfolios = await db
      .select({
        id: schema.platformPortfolios.id,
        name: schema.platformPortfolios.name,
      })
      .from(schema.platformPortfolios)
      .where(inArray(schema.platformPortfolios.id, unresolvedIds));
    for (const p of portfolios) map.set(p.id, p.name);
  }

  return map;
}

function shapeSignal(row: SignalRow, companyName: string | null) {
  return {
    signalId: row.id,
    entity: row.entity,
    companyName,
    signalType: row.signalType,
    direction: row.direction,
    magnitude: row.magnitude,
    confidence: row.confidence,
    sourceVersion: row.sourceVersion,
    rationale: row.rationale,
    timestamp: row.timestamp.toISOString(),
  };
}

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── List: recent signals across the platform ───────────────────────────
  app.get('/', { schema: { querystring: ListQuery } }, async (req) => {
    const limit = req.query.limit ?? 50;
    const filters = [];
    if (req.query.signalType) {
      filters.push(eq(schema.platformSignals.signalType, req.query.signalType));
    }
    if (req.query.entity) {
      filters.push(eq(schema.platformSignals.entity, req.query.entity));
    }
    if (req.query.cursor) {
      filters.push(lt(schema.platformSignals.timestamp, new Date(req.query.cursor)));
    }

    const rows = await db
      .select()
      .from(schema.platformSignals)
      .where(filters.length === 0 ? undefined : filters.length === 1 ? filters[0]! : and(...filters)!)
      .orderBy(desc(schema.platformSignals.timestamp))
      .limit(limit);

    const names = await buildEntityNameMap(rows as SignalRow[]);
    return (rows as SignalRow[]).map((r) => shapeSignal(r, names.get(r.entity) ?? null));
  });

  // ── List for a single entity ───────────────────────────────────────────
  app.get('/by-entity/:entity', { schema: { params: EntityParams } }, async (req) => {
    const { entity } = req.params;
    const rows = await db
      .select()
      .from(schema.platformSignals)
      .where(eq(schema.platformSignals.entity, entity))
      .orderBy(desc(schema.platformSignals.timestamp))
      .limit(50);

    const names = await buildEntityNameMap(rows as SignalRow[]);
    return (rows as SignalRow[]).map((r) => shapeSignal(r, names.get(r.entity) ?? null));
  });

  // ── Read one signal + its transform chain ──────────────────────────────
  app.get(
    '/:signalId',
    { schema: { params: SignalIdParams } },
    async (req) => {
      const { signalId } = req.params;
      const signal = await db
        .select()
        .from(schema.platformSignals)
        .where(eq(schema.platformSignals.id, signalId))
        .limit(1);
      if (signal.length === 0) throw new NotFoundError('signal', signalId);

      const lineage = await db
        .select()
        .from(schema.platformAudit)
        .where(eq(schema.platformAudit.signalId, signalId))
        .orderBy(asc(schema.platformAudit.step));

      const names = await buildEntityNameMap(signal as SignalRow[]);
      const s = signal[0]! as SignalRow;
      return {
        signal: shapeSignal(s, names.get(s.entity) ?? null),
        lineage: lineage.map((l) => ({
          step: l.step,
          op: l.op,
          inputs: l.inputs,
          output: l.output,
          weight: l.weight,
          timestamp: l.timestamp.toISOString(),
        })),
      };
    },
  );
};
