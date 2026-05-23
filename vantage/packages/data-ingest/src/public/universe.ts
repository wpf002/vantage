import { type FmpClient, type FmpScreenerRow } from './index.js';

/**
 * Public universe loader — a Russell-3000-style listing of US-listed common
 * stocks pulled from FMP's `/company-screener` endpoint.
 *
 * FMP does not expose a Russell 3000 constituent endpoint, so this module
 * approximates it with a market-cap cut on actively-traded NYSE/NASDAQ
 * common stocks (no ETFs, no funds). A $200M threshold yields ~3,000 names
 * — matching the Russell 3000 universe to within annual reconstitution drift.
 *
 * Output is normalized into the shape the rest of the platform expects:
 *   • canonical dot-form ticker (BRK.B, not the FMP dash-form BRK-B)
 *   • snake_case sector matching the screener filter taxonomy
 *   • a coarse `lifeStage` derived from market cap
 */

export interface UniverseRow {
  /** Canonical ticker — dot-form for share classes (BRK.B). */
  ticker: string;
  name: string;
  /** snake_case sector matching the /screener filter taxonomy. */
  sector: string;
  /** Heuristic life stage from market cap (mega/large = mature, mid/small = early). */
  lifeStage: 'public_mature' | 'public_early';
  marketCapUsd: number;
  exchange: string;
}

export interface FetchPublicUniverseOpts {
  /** Default 200M — yields ~3,000 names, matching the Russell 3000. */
  minMarketCapUsd?: number;
  /** Hard ceiling on rows returned. Default 3500 leaves headroom for the cut. */
  maxRows?: number;
}

const DEFAULT_MIN_MARKET_CAP = 200_000_000;
const DEFAULT_MAX_ROWS = 3500;

/** Boundary between `public_early` and `public_mature`. $2B is a common large-cap line. */
const MATURE_MARKET_CAP_FLOOR = 2_000_000_000;

/**
 * FMP returns dash-form share classes (BRK-B); the rest of the app stores
 * dot-form (BRK.B). Convert only single trailing dash-letter suffixes — that
 * pattern is unambiguously a share class. Other dashes (units, warrants,
 * preferreds) are left as-is and would be filtered upstream anyway.
 */
function canonicalTicker(symbol: string): string {
  return symbol.replace(/-([A-Z])$/, '.$1');
}

/**
 * FMP uses GICS sector names with spaces; the screener filter UI and the DB
 * downstream want snake_case. Anything unrecognized falls into `other` so
 * the filter list doesn't sprout one-off values.
 */
const SECTOR_MAP: Record<string, string> = {
  Technology: 'technology',
  Healthcare: 'healthcare',
  'Financial Services': 'financials',
  'Communication Services': 'communication_services',
  'Consumer Cyclical': 'consumer_discretionary',
  'Consumer Defensive': 'consumer_staples',
  Industrials: 'industrials',
  Energy: 'energy',
  'Basic Materials': 'materials',
  Utilities: 'utilities',
  'Real Estate': 'real_estate',
};

function normalizeSector(raw: string | null | undefined): string {
  if (!raw) return 'other';
  return SECTOR_MAP[raw] ?? 'other';
}

function lifeStageFromMarketCap(cap: number): 'public_mature' | 'public_early' {
  return cap >= MATURE_MARKET_CAP_FLOOR ? 'public_mature' : 'public_early';
}

/**
 * Fetch the Russell-3000 approximation as one batched call to FMP. The
 * endpoint accepts large `limit` values and returns sorted-by-market-cap
 * descending, so no pagination is needed.
 *
 * Rows missing a market cap (rare, micro-caps with stale FMP data) are
 * dropped — they can't be life-staged and aren't worth scoring.
 */
export async function fetchPublicUniverse(
  client: FmpClient,
  opts: FetchPublicUniverseOpts = {},
): Promise<UniverseRow[]> {
  const minCap = opts.minMarketCapUsd ?? DEFAULT_MIN_MARKET_CAP;
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;

  const raw: FmpScreenerRow[] = await client.companyScreener({
    marketCapMoreThan: minCap,
    exchanges: ['NYSE', 'NASDAQ'],
    country: 'US',
    isActivelyTrading: true,
    isEtf: false,
    isFund: false,
    limit: maxRows,
  });

  return raw
    .filter((r) => typeof r.marketCap === 'number' && r.marketCap > 0)
    .map((r): UniverseRow => ({
      ticker: canonicalTicker(r.symbol),
      name: r.companyName,
      sector: normalizeSector(r.sector ?? null),
      lifeStage: lifeStageFromMarketCap(r.marketCap!),
      marketCapUsd: r.marketCap!,
      exchange: r.exchangeShortName ?? r.exchange ?? 'UNKNOWN',
    }));
}
