import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import {
  type Decision,
  type DecisionMethod,
  type DecisionType,
  decisionHit,
  decisionReturn,
} from '@vantage/shared';
import type { AssetClass, Sector, LifeStage } from '@vantage/shared';
import { schema, type DB } from './client.js';

/**
 * Meta-learning data layer (Phase 8).
 *
 * Maps raw platform_decisions rows — plus the company / signal joins they need
 * — into the normalized `Decision` shape the pure calibration & tuning
 * libraries consume. All IO lives here; the libraries stay pure.
 */

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CALIBRATION_ROW_CAP = 10_000;

const CALIBRATION_TYPES: DecisionType[] = [
  'public_score',
  'private_valuation',
  'classification',
  'portfolio_construction',
];

interface DecisionRecord {
  id: string;
  entity: string;
  decisionType: string;
  decisionPayload: unknown;
  outcomePayload: unknown;
  createdAt: Date;
}

interface CompanyInfo {
  name: string;
  sector: Sector;
  lifeStage: LifeStage;
}

interface PrivateInfo {
  confidence: number;
  methods: DecisionMethod[];
}

/** entity (ticker or company UUID) → company metadata. */
async function buildCompanyInfo(db: DB, entities: string[]): Promise<Map<string, CompanyInfo>> {
  const map = new Map<string, CompanyInfo>();
  if (entities.length === 0) return map;
  const tickers = entities.filter((e) => !UUID_SHAPE.test(e));
  const ids = entities.filter((e) => UUID_SHAPE.test(e));

  const conditions = [];
  if (tickers.length > 0) conditions.push(inArray(schema.platformCompanies.ticker, tickers));
  if (ids.length > 0) conditions.push(inArray(schema.platformCompanies.id, ids));
  if (conditions.length === 0) return map;

  const rows = await db
    .select({
      id: schema.platformCompanies.id,
      ticker: schema.platformCompanies.ticker,
      name: schema.platformCompanies.name,
      sector: schema.platformCompanies.sector,
      lifeStage: schema.platformCompanies.lifeStage,
    })
    .from(schema.platformCompanies)
    .where(conditions.length === 1 ? conditions[0]! : or(...conditions)!);

  for (const r of rows) {
    const info: CompanyInfo = {
      name: r.name,
      sector: r.sector as Sector,
      lifeStage: r.lifeStage as LifeStage,
    };
    if (r.ticker) map.set(r.ticker, info);
    map.set(r.id, info);
  }
  return map;
}

/**
 * Per private-name method confidence & blend weight, read from the latest
 * blended-valuation signal metadata. Sparse by nature (a handful of covered
 * companies) so a per-entity query is fine.
 */
async function buildPrivateInfo(db: DB, entities: string[]): Promise<Map<string, PrivateInfo>> {
  const map = new Map<string, PrivateInfo>();
  for (const entity of entities) {
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
    if (rows.length === 0) continue;
    const meta = (rows[0]!.metadata ?? {}) as Record<string, unknown>;
    const confidence = typeof meta.confidence === 'number' ? meta.confidence : NaN;
    const weights = (meta.weights ?? {}) as Record<string, number>;
    const results = (meta.methodResults ?? []) as Array<{ method?: string; confidence?: number }>;
    const methods: DecisionMethod[] = results
      .map((r) => {
        const key = (r.method ?? '').toLowerCase();
        const label =
          key === 'dcf' ? 'DCF' : key === 'comps' ? 'Comps' : key === 'lbo' ? 'LBO' : null;
        if (!label) return null;
        return {
          method: label,
          confidence: typeof r.confidence === 'number' ? r.confidence : NaN,
          weight: typeof weights[key] === 'number' ? weights[key]! : 0,
        } as DecisionMethod;
      })
      .filter((m): m is DecisionMethod => m !== null);
    map.set(entity, { confidence, methods });
  }
  return map;
}

function mapToDecision(
  row: DecisionRecord,
  companies: Map<string, CompanyInfo>,
  privates: Map<string, PrivateInfo>,
): Decision {
  const company = companies.get(row.entity);
  const payload = (row.decisionPayload ?? {}) as Record<string, any>;
  const outcome = (row.outcomePayload ?? null) as Decision['outcome'];

  const base: Decision = {
    id: row.id,
    decisionType: row.decisionType as DecisionType,
    confidence: NaN,
    createdAt: row.createdAt.toISOString(),
    payload: {
      ...(company ? { sector: company.sector, lifeStage: company.lifeStage } : {}),
    },
    outcome,
  };

  switch (row.decisionType) {
    case 'classification': {
      base.confidence = numberOr(payload.result?.confidence, NaN);
      base.payload.assetClass = payload.result?.classification as AssetClass | undefined;
      break;
    }
    case 'public_score': {
      const o = (outcome ?? {}) as Record<string, any>;
      base.confidence = numberOr(o.originalConfidence, NaN);
      base.payload.label = o.originalLabel ?? undefined;
      base.payload.direction = o.originalDirection ?? undefined;
      break;
    }
    case 'private_valuation': {
      const info = privates.get(row.entity);
      base.confidence = info ? info.confidence : NaN;
      if (info) base.payload.methods = info.methods;
      break;
    }
    case 'portfolio_construction':
    default:
      base.confidence = NaN; // no single stated confidence; hit is alpha-based
      break;
  }
  return base;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export interface DecisionCounts {
  total: number;
  resolved: number;
}

/** Total vs. resolved predictive decisions (excludes simulations). */
export async function decisionCounts(db: DB, fromDate?: Date): Promise<DecisionCounts> {
  const typeFilter = inArray(schema.platformDecisions.decisionType, CALIBRATION_TYPES);
  const dateFilter = fromDate ? gte(schema.platformDecisions.createdAt, fromDate) : undefined;

  const totalWhere = dateFilter ? and(typeFilter, dateFilter) : typeFilter;
  const resolvedWhere = and(
    typeFilter,
    isNotNull(schema.platformDecisions.outcomePayload),
    ...(dateFilter ? [dateFilter] : []),
  );

  const [tot] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.platformDecisions)
    .where(totalWhere);
  const [res] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.platformDecisions)
    .where(resolvedWhere);

  return { total: tot?.c ?? 0, resolved: res?.c ?? 0 };
}

export interface LoadCalibrationOpts {
  decisionType?: string;
  fromDate?: Date;
  sector?: string;
}

/**
 * Load every resolved decision (outcomePayload present), mapped to the pure
 * `Decision` shape. Optional filters by type, sector, and start date.
 */
export async function loadCalibrationDecisions(
  db: DB,
  opts: LoadCalibrationOpts = {},
): Promise<Decision[]> {
  const conditions = [isNotNull(schema.platformDecisions.outcomePayload)];
  if (opts.decisionType) {
    conditions.push(eq(schema.platformDecisions.decisionType, opts.decisionType));
  } else {
    conditions.push(inArray(schema.platformDecisions.decisionType, CALIBRATION_TYPES));
  }
  if (opts.fromDate) conditions.push(gte(schema.platformDecisions.createdAt, opts.fromDate));

  const rows = (await db
    .select({
      id: schema.platformDecisions.id,
      entity: schema.platformDecisions.entity,
      decisionType: schema.platformDecisions.decisionType,
      decisionPayload: schema.platformDecisions.decisionPayload,
      outcomePayload: schema.platformDecisions.outcomePayload,
      createdAt: schema.platformDecisions.createdAt,
    })
    .from(schema.platformDecisions)
    .where(and(...conditions))
    .orderBy(desc(schema.platformDecisions.createdAt))
    .limit(CALIBRATION_ROW_CAP)) as DecisionRecord[];

  const entities = Array.from(new Set(rows.map((r) => r.entity)));
  const companies = await buildCompanyInfo(db, entities);
  const privateEntities = Array.from(
    new Set(rows.filter((r) => r.decisionType === 'private_valuation').map((r) => r.entity)),
  );
  const privates = await buildPrivateInfo(db, privateEntities);

  let decisions = rows.map((r) => mapToDecision(r, companies, privates));
  if (opts.sector) decisions = decisions.filter((d) => d.payload.sector === opts.sector);
  return decisions;
}

export interface DecisionFeedItem {
  id: string;
  decisionType: string;
  entity: string;
  companyName: string | null;
  confidence: number | null;
  createdAt: string;
  resolved: boolean;
  realizedReturn: number | null;
  hit: boolean | null;
}

export interface DecisionFeed {
  items: DecisionFeedItem[];
  nextCursor: string | null;
}

export interface ListDecisionsOpts {
  decisionType?: string;
  resolved?: boolean;
  cursor?: string;
  limit?: number;
}

/** Paginated raw decision feed for the /meta/decisions drill-in. */
export async function listDecisionFeed(
  db: DB,
  opts: ListDecisionsOpts = {},
): Promise<DecisionFeed> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const conditions = [
    inArray(schema.platformDecisions.decisionType, [...CALIBRATION_TYPES, 'simulation']),
  ];
  if (opts.decisionType) {
    conditions[0] = eq(schema.platformDecisions.decisionType, opts.decisionType);
  }
  if (opts.resolved === true) {
    conditions.push(isNotNull(schema.platformDecisions.outcomePayload));
  } else if (opts.resolved === false) {
    conditions.push(isNull(schema.platformDecisions.outcomePayload));
  }
  if (opts.cursor) conditions.push(lt(schema.platformDecisions.createdAt, new Date(opts.cursor)));

  const rows = (await db
    .select({
      id: schema.platformDecisions.id,
      entity: schema.platformDecisions.entity,
      decisionType: schema.platformDecisions.decisionType,
      decisionPayload: schema.platformDecisions.decisionPayload,
      outcomePayload: schema.platformDecisions.outcomePayload,
      createdAt: schema.platformDecisions.createdAt,
    })
    .from(schema.platformDecisions)
    .where(and(...conditions))
    .orderBy(desc(schema.platformDecisions.createdAt))
    .limit(limit + 1)) as DecisionRecord[];

  const page = rows.slice(0, limit);
  const entities = Array.from(new Set(page.map((r) => r.entity)));
  const companies = await buildCompanyInfo(db, entities);
  const privateEntities = Array.from(
    new Set(page.filter((r) => r.decisionType === 'private_valuation').map((r) => r.entity)),
  );
  const privates = await buildPrivateInfo(db, privateEntities);

  const items: DecisionFeedItem[] = page.map((r) => {
    const d = mapToDecision(r, companies, privates);
    return {
      id: r.id,
      decisionType: r.decisionType,
      entity: r.entity,
      companyName: companies.get(r.entity)?.name ?? null,
      confidence: Number.isFinite(d.confidence) ? d.confidence : null,
      createdAt: r.createdAt.toISOString(),
      resolved: r.outcomePayload !== null,
      realizedReturn: decisionReturn(d),
      hit: decisionHit(d),
    };
  });

  const nextCursor =
    rows.length > limit ? page[page.length - 1]!.createdAt.toISOString() : null;
  return { items, nextCursor };
}
