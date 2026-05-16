import { sql, type SQLWrapper } from 'drizzle-orm';
import type { AssetAssumption } from './index.js';

/**
 * Per-asset μ / σ derivation for Phase 6 simulation runs.
 *
 * Inputs: a Drizzle db handle + a list of entities (ticker or companyId UUID).
 * Output: one AssumptionWithSource per entity with the source labelled so the
 * UI can show users when the engine is using real data vs a default.
 *
 * IMPORTANT: this is pure library code — it accepts a Drizzle handle but does
 * no HTTP, reads no env, and writes nothing. A caller (the API route, the CLI)
 * may pass an optional `priceHistory` fetcher to enable the historical branch
 * for public tickers; without it, public entities fall back to sector defaults.
 *
 * Per-asset independence is still assumed in runMonteCarlo — adding correlated
 * draws is a future enhancement (Phase 6.5 or Phase 8 meta-learning).
 */

export type AssumptionSource =
  | 'historical'
  | 'peer_implied'
  | 'sector_default'
  | 'life_stage_default';

export interface AssumptionWithSource extends AssetAssumption {
  source: AssumptionSource;
}

export interface EntityRef {
  /** Either a ticker symbol or a platform_companies UUID (matches allocation.entity). */
  entity: string;
  name?: string;
  sector?: string;
  ticker?: string | null;
  marketType?: 'public' | 'private' | null;
  lifeStage?: string | null;
}

export interface PriceHistoryPoint {
  date: string; // ISO date — "YYYY-MM-DD" or a full timestamp
  close: number;
}

/** Optional callback so the API/CLI layer can wire in FMP historical fetches. */
export type PriceHistoryFetcher = (
  ticker: string,
  days: number,
) => Promise<PriceHistoryPoint[]>;

export interface DeriveAssumptionOptions {
  priceHistory?: PriceHistoryFetcher;
  /** Trailing window for historical derivation. Default 36 months ≈ 1095 days. */
  historicalDays?: number;
}

// ── Defaults ──────────────────────────────────────────────────────────────
//
// These are placeholders, not magic numbers from a published paper. Long-run
// US sector averages from broad investor education sources (Damodaran, NYU
// Stern), rounded to the nearest 1%. Phase 8 meta-learning can refine these
// per-sector once the decision log accumulates outcomes.

const SECTOR_DEFAULTS: Record<string, { mu: number; sigma: number }> = {
  technology: { mu: 0.12, sigma: 0.24 },
  healthcare: { mu: 0.1, sigma: 0.18 },
  financials: { mu: 0.09, sigma: 0.2 },
  consumer_discretionary: { mu: 0.1, sigma: 0.22 },
  consumer_staples: { mu: 0.07, sigma: 0.12 },
  industrials: { mu: 0.09, sigma: 0.18 },
  energy: { mu: 0.06, sigma: 0.3 },
  materials: { mu: 0.07, sigma: 0.22 },
  utilities: { mu: 0.06, sigma: 0.14 },
  real_estate: { mu: 0.08, sigma: 0.18 },
  communication_services: { mu: 0.09, sigma: 0.2 },
  other: { mu: 0.08, sigma: 0.2 },
};

// Private-side fallback, keyed by life_stage. Wider σ at earlier stages
// reflects higher dispersion of outcomes pre-product-market-fit. These are
// crude — Phase 8 meta-learning is the path to refining them properly.
const LIFE_STAGE_DEFAULTS: Record<string, { mu: number; sigma: number }> = {
  seed: { mu: 0.4, sigma: 0.8 },
  series_a: { mu: 0.3, sigma: 0.6 },
  series_b: { mu: 0.25, sigma: 0.5 },
  series_c_plus: { mu: 0.2, sigma: 0.4 },
  pre_ipo: { mu: 0.15, sigma: 0.3 },
  public_early: { mu: 0.14, sigma: 0.28 },
  public_mature: { mu: 0.1, sigma: 0.2 },
};

const FALLBACK_SECTOR = SECTOR_DEFAULTS.other!;
const FALLBACK_LIFE_STAGE = LIFE_STAGE_DEFAULTS.public_mature!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDrizzle = { execute: (query: string | SQLWrapper) => Promise<any> };

interface CompanyRow {
  id: string;
  name: string;
  market_type: 'public' | 'private';
  ticker: string | null;
  sector: string;
  life_stage: string;
}

interface CompsPeerRow {
  company_id: string;
  peer_set: unknown;
  illiquidity_discount: number;
}

interface BlendedSignalRow {
  entity: string;
  metadata: unknown;
}

/**
 * For each entity, return an AssetAssumption + source. Best-effort: missing
 * data falls back to sector / life-stage defaults rather than throwing.
 */
export async function deriveAssetAssumptions(
  db: AnyDrizzle,
  entities: EntityRef[],
  options: DeriveAssumptionOptions = {},
): Promise<AssumptionWithSource[]> {
  if (entities.length === 0) return [];

  const historicalDays = options.historicalDays ?? 1095;

  // Resolve company metadata for every entity that doesn't already carry it.
  // entity may be either a UUID (private) or a ticker (public). The lookup
  // is best-effort — entities that don't resolve fall through to defaults.
  const idCandidates = entities
    .map((e) => e.entity)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  const tickerCandidates = entities
    .map((e) => e.ticker ?? e.entity)
    .filter((s): s is string => typeof s === 'string' && !/^[0-9a-f-]{36}$/i.test(s));

  let companyRows: CompanyRow[] = [];
  if (idCandidates.length > 0 || tickerCandidates.length > 0) {
    const idList = idCandidates.length > 0 ? idCandidates : ['00000000-0000-0000-0000-000000000000'];
    const tickerList = tickerCandidates.length > 0 ? tickerCandidates : [''];
    const idPlaceholders = sql.join(
      idList.map((v) => sql`${v}`),
      sql`, `,
    );
    const tickerPlaceholders = sql.join(
      tickerList.map((v) => sql`${v}`),
      sql`, `,
    );
    companyRows = (await db.execute(sql`
      SELECT id::text AS id, name, market_type, ticker, sector, life_stage
      FROM platform_companies
      WHERE id::text IN (${idPlaceholders})
         OR ticker IN (${tickerPlaceholders})
    `)) as unknown as CompanyRow[];
  }
  const companyByEntity = new Map<string, CompanyRow>();
  for (const c of companyRows) {
    companyByEntity.set(c.id, c);
    if (c.ticker) companyByEntity.set(c.ticker, c);
  }

  // Private-side: load most recent comps + blended valuation per private entity.
  const privateIds = entities
    .map((e) => e.entity)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));

  const compsByCompanyId = new Map<string, CompsPeerRow>();
  const blendedByEntity = new Map<string, BlendedSignalRow>();
  if (privateIds.length > 0) {
    const privatePlaceholders = sql.join(
      privateIds.map((v) => sql`${v}`),
      sql`, `,
    );
    const compsRows = (await db.execute(sql`
      SELECT DISTINCT ON (company_id)
        company_id::text AS company_id, peer_set, illiquidity_discount
      FROM private_comps_peers
      WHERE company_id::text IN (${privatePlaceholders})
      ORDER BY company_id, as_of DESC
    `)) as unknown as CompsPeerRow[];
    for (const r of compsRows) compsByCompanyId.set(r.company_id, r);

    const blendedRows = (await db.execute(sql`
      SELECT DISTINCT ON (entity)
        entity, metadata
      FROM platform_signals
      WHERE signal_type = 'private.blended_valuation'
        AND entity IN (${privatePlaceholders})
      ORDER BY entity, timestamp DESC
    `)) as unknown as BlendedSignalRow[];
    for (const r of blendedRows) blendedByEntity.set(r.entity, r);
  }

  const out: AssumptionWithSource[] = [];

  for (const e of entities) {
    const company = companyByEntity.get(e.entity);
    const marketType =
      e.marketType ?? company?.market_type ?? (e.ticker ? 'public' : null);
    const sector = (e.sector ?? company?.sector ?? 'other').toLowerCase();
    const lifeStage = e.lifeStage ?? company?.life_stage ?? null;
    const ticker = e.ticker ?? company?.ticker ?? null;

    let derived: AssumptionWithSource | null = null;

    // ─── Public branch ──────────────────────────────────────────────────
    if (marketType === 'public' || (!marketType && ticker)) {
      if (options.priceHistory && ticker) {
        try {
          const prices = await options.priceHistory(ticker, historicalDays);
          const historical = computeFromHistoricalPrices(prices);
          if (historical) {
            derived = {
              entity: e.entity,
              annualReturn: historical.mu,
              annualVol: historical.sigma,
              source: 'historical',
            };
          }
        } catch {
          // Fall through to defaults — fetch failure is not fatal.
        }
      }
      if (!derived) {
        const def = SECTOR_DEFAULTS[sector] ?? FALLBACK_SECTOR;
        derived = {
          entity: e.entity,
          annualReturn: def.mu,
          annualVol: def.sigma,
          source: 'sector_default',
        };
      }
    } else {
      // ─── Private branch ─────────────────────────────────────────────
      const comps = company ? compsByCompanyId.get(company.id) : undefined;
      const blended = blendedByEntity.get(e.entity);

      const peerSigma = extractPeerSigma(comps?.peer_set);
      const impliedMu = extractImpliedGrowth(blended?.metadata);

      if (peerSigma !== null && impliedMu !== null) {
        derived = {
          entity: e.entity,
          annualReturn: impliedMu,
          annualVol: peerSigma,
          source: 'peer_implied',
        };
      } else {
        const stageKey = lifeStage ?? 'public_mature';
        const def = LIFE_STAGE_DEFAULTS[stageKey] ?? FALLBACK_LIFE_STAGE;
        derived = {
          entity: e.entity,
          annualReturn: def.mu,
          annualVol: def.sigma,
          source: 'life_stage_default',
        };
      }
    }

    out.push(derived);
  }

  return out;
}

/**
 * Compute annualized μ and σ from a daily-close series. Returns null if there
 * aren't at least 12 calendar months of data (≈252 trading days).
 */
function computeFromHistoricalPrices(
  prices: PriceHistoryPoint[],
): { mu: number; sigma: number } | null {
  if (prices.length < 252) return null;

  // Sort ascending by date and bucket to month-end. The FMP feed returns
  // daily closes; we sample the last close of each month to get monthly
  // returns, which keeps σ comparable to the documented sector defaults.
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const monthly = new Map<string, number>(); // YYYY-MM → last close in month
  for (const p of sorted) {
    const key = p.date.slice(0, 7);
    monthly.set(key, p.close);
  }
  const monthCloses = Array.from(monthly.values());
  if (monthCloses.length < 12) return null;

  const logRets: number[] = [];
  for (let i = 1; i < monthCloses.length; i++) {
    const a = monthCloses[i - 1]!;
    const b = monthCloses[i]!;
    if (a > 0 && b > 0) logRets.push(Math.log(b / a));
  }
  if (logRets.length < 11) return null;

  const mean = logRets.reduce((acc, x) => acc + x, 0) / logRets.length;
  const variance =
    logRets.reduce((acc, x) => acc + (x - mean) ** 2, 0) / Math.max(1, logRets.length - 1);
  const monthlySigma = Math.sqrt(variance);

  return { mu: mean * 12, sigma: monthlySigma * Math.sqrt(12) };
}

/**
 * Peer-set σ extraction. The comps engine stores per-peer return / vol stats
 * under several possible shapes (`peerVol`, `volatility`, or per-peer rows).
 * Best-effort: returns null if no σ is recoverable.
 */
function extractPeerSigma(peerSet: unknown): number | null {
  if (!peerSet || typeof peerSet !== 'object') return null;
  const obj = peerSet as Record<string, unknown>;
  const direct =
    asPositive(obj.peerSigma) ?? asPositive(obj.peerVol) ?? asPositive(obj.volatility);
  if (direct !== null) return direct;

  const peers = obj.peers;
  if (Array.isArray(peers) && peers.length > 0) {
    const vols = peers
      .map((p) => {
        if (!p || typeof p !== 'object') return null;
        const pr = p as Record<string, unknown>;
        return asPositive(pr.sigma) ?? asPositive(pr.vol) ?? asPositive(pr.volatility);
      })
      .filter((v): v is number => v !== null);
    if (vols.length > 0) {
      return vols.reduce((a, b) => a + b, 0) / vols.length;
    }
  }
  return null;
}

/** Implied μ extraction from a blended-valuation Signal metadata blob. */
function extractImpliedGrowth(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const obj = metadata as Record<string, unknown>;
  return (
    asFinite(obj.impliedGrowth) ??
    asFinite(obj.expectedGrowth) ??
    asFinite(obj.growthRate) ??
    null
  );
}

function asPositive(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) return null;
  return x;
}
function asFinite(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return x;
}

export const SIMULATION_DEFAULTS = {
  SECTOR_DEFAULTS,
  LIFE_STAGE_DEFAULTS,
} as const;
