import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * Public-side data source: Financial Modeling Prep (FMP).
 *
 * Uses FMP's current "stable" API (https://financialmodelingprep.com/stable).
 * The legacy /api/v3 and /api/v4 endpoints were retired in 2025; the stable
 * endpoints take the symbol as a `?symbol=` query parameter rather than a
 * path segment, and several response fields were renamed — those renames are
 * normalized inside each method so the public return shapes stay stable.
 *
 * All public-market data (profile, prices, earnings, estimates, segments,
 * price targets, ratings) flows through this single client.
 */

export interface FmpConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export const FmpProfile = z.object({
  symbol: z.string(),
  companyName: z.string(),
  // FMP returns null sector/industry for shells/SPACs — tolerate it (.optional()
  // alone rejects an explicit null) so these tickers parse instead of erroring.
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  marketCap: z.number().optional(),
  beta: z.number().optional(),
  price: z.number().optional(),
  exchange: z.string().optional(),
  exchangeShortName: z.string().optional(),
  exchangeFullName: z.string().optional(),
});
export type FmpProfile = z.infer<typeof FmpProfile>;

export const FmpEarning = z.object({
  date: z.string(),
  symbol: z.string(),
  eps: z.number().nullable(),
  epsEstimated: z.number().nullable(),
  revenue: z.number().nullable(),
  revenueEstimated: z.number().nullable(),
});
export type FmpEarning = z.infer<typeof FmpEarning>;

/** Raw stable-API earnings row — `epsActual` / `revenueActual` are remapped. */
const FmpEarningRaw = z.object({
  symbol: z.string(),
  date: z.string(),
  epsActual: z.number().nullable().optional(),
  epsEstimated: z.number().nullable().optional(),
  revenueActual: z.number().nullable().optional(),
  revenueEstimated: z.number().nullable().optional(),
});

export const FmpPriceTarget = z.object({
  symbol: z.string(),
  targetConsensus: z.number().optional(),
  targetHigh: z.number().optional(),
  targetLow: z.number().optional(),
  targetMedian: z.number().optional(),
  numberOfAnalysts: z.number().optional(),
});
export type FmpPriceTarget = z.infer<typeof FmpPriceTarget>;

export const FmpSegment = z.object({
  date: z.string(),
  segments: z.record(z.number()),
});
export type FmpSegment = z.infer<typeof FmpSegment>;

/**
 * Stock news article (Phase 10 — narrative tagging). Tolerant of the stable
 * API's field names (`publishedDate`, `site`) and normalized to a stable shape.
 */
const FmpStockNewsRaw = z.object({
  symbol: z.string().optional(),
  publishedDate: z.string().optional(),
  date: z.string().optional(),
  title: z.string(),
  text: z.string().optional(),
  site: z.string().optional(),
  publisher: z.string().optional(),
  url: z.string().optional(),
});

export const FmpStockNews = z.object({
  title: z.string(),
  text: z.string(),
  publishedAt: z.string(),
  source: z.string(),
  url: z.string(),
});
export type FmpStockNews = z.infer<typeof FmpStockNews>;

/**
 * Price-target consensus rolled up by recency window — carries the history the
 * single-snapshot consensus endpoint lacks, so the trailing-90d move is real.
 */
export const FmpPriceTargetSummary = z.object({
  symbol: z.string(),
  lastMonthCount: z.number().optional(),
  lastMonthAvgPriceTarget: z.number().nullable().optional(),
  lastQuarterCount: z.number().optional(),
  lastQuarterAvgPriceTarget: z.number().nullable().optional(),
  lastYearCount: z.number().optional(),
  lastYearAvgPriceTarget: z.number().nullable().optional(),
  allTimeCount: z.number().optional(),
  allTimeAvgPriceTarget: z.number().nullable().optional(),
});
export type FmpPriceTargetSummary = z.infer<typeof FmpPriceTargetSummary>;

/** Raw stable-API segmentation row — the flat map lives under `data`. */
const FmpSegmentRaw = z.object({
  date: z.string(),
  data: z.record(z.number()),
});

export const FmpHistoricalPrice = z.object({
  date: z.string(),
  close: z.number(),
});
export type FmpHistoricalPrice = z.infer<typeof FmpHistoricalPrice>;

/** Raw stable-API EOD-light row — `price` is remapped to `close`. */
const FmpHistoricalPriceRaw = z.object({
  date: z.string(),
  price: z.number(),
});

/**
 * FMP's monthly analyst-grades rows. Field casing has drifted across FMP plan
 * tiers, so the bullish/bearish counts are all optional and the lowercase
 * `analystRatingsbuy` variant is accepted alongside the camelCase one.
 */
export const FmpAnalystRecommendation = z.object({
  date: z.string(),
  analystRatingsStrongBuy: z.number().optional(),
  analystRatingsBuy: z.number().optional(),
  analystRatingsbuy: z.number().optional(),
  analystRatingsHold: z.number().optional(),
  analystRatingsSell: z.number().optional(),
  analystRatingsStrongSell: z.number().optional(),
});

/** Normalized monthly analyst posture. */
export interface AnalystRecommendationMonth {
  date: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export const FmpRatiosTtm = z
  .object({
    priceToSalesRatioTTM: z.number().nullable().optional(),
  })
  .passthrough();
export type FmpRatiosTtm = z.infer<typeof FmpRatiosTtm>;

export const FmpKeyMetrics = z
  .object({
    date: z.string().optional(),
    priceToSalesRatio: z.number().nullable().optional(),
  })
  .passthrough();
export type FmpKeyMetrics = z.infer<typeof FmpKeyMetrics>;

/** A name-search hit — one listing of a company on one exchange. */
export const FmpSearchHit = z.object({
  symbol: z.string(),
  name: z.string(),
  currency: z.string().optional(),
  exchange: z.string().optional(),
  exchangeFullName: z.string().optional(),
});
export type FmpSearchHit = z.infer<typeof FmpSearchHit>;

/**
 * One row of FMP's `/company-screener` response — the universe-listing
 * endpoint used to populate `platform_companies` for the Russell-3000
 * approximation. FMP omits sector/marketCap on a small number of micro-cap
 * rows, so both are nullable.
 */
export const FmpScreenerRow = z.object({
  symbol: z.string(),
  companyName: z.string(),
  marketCap: z.number().nullable().optional(),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  exchange: z.string().optional(),
  exchangeShortName: z.string().optional(),
  country: z.string().optional(),
  isEtf: z.boolean().optional(),
  isFund: z.boolean().optional(),
  isActivelyTrading: z.boolean().optional(),
});
export type FmpScreenerRow = z.infer<typeof FmpScreenerRow>;

export class FmpClient {
  private base: string;
  private key: string;
  private timeout: number;

  constructor(cfg: FmpConfig) {
    this.base = cfg.baseUrl ?? 'https://financialmodelingprep.com/stable';
    this.key = cfg.apiKey;
    this.timeout = cfg.timeoutMs ?? 10_000;
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = `${this.base}${path}${path.includes('?') ? '&' : '?'}apikey=${this.key}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeout);
    try {
      const resp = await fetch(url, { signal: ctl.signal });
      if (!resp.ok) throw new UpstreamError('fmp', `HTTP ${resp.status} on ${path}`);
      const json = await resp.json();
      return schema.parse(json);
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError('fmp', err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * FMP uses dash-separated share classes (`BRK-B`), not the dot-form
   * (`BRK.B`) that the rest of the app uses. Normalize at the wire boundary
   * so domain code can keep the canonical ticker.
   */
  private wireSymbol(symbol: string): string {
    return symbol.replace(/\./g, '-');
  }

  async profile(symbol: string): Promise<FmpProfile | null> {
    const arr = await this.get(`/profile?symbol=${this.wireSymbol(symbol)}`, z.array(FmpProfile));
    return arr[0] ?? null;
  }

  async earnings(symbol: string, limit = 8): Promise<FmpEarning[]> {
    const rows = await this.get(
      `/earnings?symbol=${this.wireSymbol(symbol)}&limit=${limit}`,
      z.array(FmpEarningRaw),
    );
    return rows.map((r) => ({
      date: r.date,
      symbol: r.symbol,
      eps: r.epsActual ?? null,
      epsEstimated: r.epsEstimated ?? null,
      revenue: r.revenueActual ?? null,
      revenueEstimated: r.revenueEstimated ?? null,
    }));
  }

  async priceTarget(symbol: string): Promise<FmpPriceTarget | null> {
    const arr = await this.get(
      `/price-target-consensus?symbol=${this.wireSymbol(symbol)}`,
      z.array(FmpPriceTarget),
    );
    return arr[0] ?? null;
  }

  /** Price-target averages by recency window — used for the trailing-90d move. */
  async priceTargetSummary(symbol: string): Promise<FmpPriceTargetSummary | null> {
    const arr = await this.get(
      `/price-target-summary?symbol=${this.wireSymbol(symbol)}`,
      z.array(FmpPriceTargetSummary),
    );
    return arr[0] ?? null;
  }

  async revenueSegmentsProduct(symbol: string): Promise<FmpSegment[]> {
    const rows = await this.get(
      `/revenue-product-segmentation?symbol=${this.wireSymbol(symbol)}`,
      z.array(FmpSegmentRaw),
    );
    return rows.map((r) => ({ date: r.date, segments: r.data }));
  }

  async revenueSegmentsGeo(symbol: string): Promise<FmpSegment[]> {
    const rows = await this.get(
      `/revenue-geographic-segmentation?symbol=${this.wireSymbol(symbol)}`,
      z.array(FmpSegmentRaw),
    );
    return rows.map((r) => ({ date: r.date, segments: r.data }));
  }

  /** Daily close history, filtered to the trailing `days` window. */
  async historicalPrices(symbol: string, days = 365): Promise<FmpHistoricalPrice[]> {
    const rows = await this.get(
      `/historical-price-eod/light?symbol=${this.wireSymbol(symbol)}`,
      z.array(FmpHistoricalPriceRaw),
    );
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return rows
      .map((r) => ({ date: r.date, close: r.price }))
      .filter((p) => {
        const ts = new Date(p.date).getTime();
        return Number.isFinite(ts) && ts >= cutoff;
      });
  }

  /** Monthly analyst upgrade/downgrade posture, normalized to a stable shape. */
  async analystRecommendations(symbol: string): Promise<AnalystRecommendationMonth[]> {
    const rows = await this.get(
      `/grades-historical?symbol=${this.wireSymbol(symbol)}`,
      z.array(FmpAnalystRecommendation),
    );
    return rows.map((r) => ({
      date: r.date,
      strongBuy: r.analystRatingsStrongBuy ?? 0,
      buy: r.analystRatingsBuy ?? r.analystRatingsbuy ?? 0,
      hold: r.analystRatingsHold ?? 0,
      sell: r.analystRatingsSell ?? 0,
      strongSell: r.analystRatingsStrongSell ?? 0,
    }));
  }

  /** Free-text company-name search — returns listings across all exchanges. */
  async searchByName(query: string, limit = 10): Promise<FmpSearchHit[]> {
    return this.get(
      `/search-name?query=${encodeURIComponent(query)}&limit=${limit}`,
      z.array(FmpSearchHit),
    );
  }

  /**
   * Company screener — used as the universe source. FMP doesn't expose a
   * Russell-3000 constituent endpoint, so we approximate it with a market-cap
   * cut on US-listed common stocks (NYSE/NASDAQ, actively trading, no ETFs
   * or funds). A `marketCapMoreThan` of $200M yields ~3,000 names, matching
   * the Russell 3000 universe within methodology drift.
   *
   * Results come back sorted by market cap descending. `limit` is enforced
   * server-side and the endpoint accepts large values (3,000+) in a single
   * call — no cursor pagination is needed.
   */
  async companyScreener(opts: {
    marketCapMoreThan?: number;
    exchanges?: string[]; // e.g. ['NYSE', 'NASDAQ']
    country?: string;
    isActivelyTrading?: boolean;
    isEtf?: boolean;
    isFund?: boolean;
    limit?: number;
  }): Promise<FmpScreenerRow[]> {
    const parts: string[] = [];
    if (opts.marketCapMoreThan !== undefined)
      parts.push(`marketCapMoreThan=${Math.round(opts.marketCapMoreThan)}`);
    if (opts.exchanges && opts.exchanges.length > 0)
      parts.push(`exchange=${opts.exchanges.join(',')}`);
    if (opts.country) parts.push(`country=${opts.country}`);
    if (opts.isActivelyTrading !== undefined)
      parts.push(`isActivelyTrading=${opts.isActivelyTrading}`);
    if (opts.isEtf !== undefined) parts.push(`isEtf=${opts.isEtf}`);
    if (opts.isFund !== undefined) parts.push(`isFund=${opts.isFund}`);
    if (opts.limit !== undefined) parts.push(`limit=${opts.limit}`);
    return this.get(`/company-screener?${parts.join('&')}`, z.array(FmpScreenerRow));
  }

  /** Trailing-twelve-month ratios — we care about price/sales. */
  async ratiosTtm(symbol: string): Promise<FmpRatiosTtm | null> {
    const arr = await this.get(
      `/ratios-ttm?symbol=${this.wireSymbol(symbol)}`,
      z.array(FmpRatiosTtm),
    );
    return arr[0] ?? null;
  }

  /**
   * Historical annual ratios — the price/revenue baseline. Uses the stable
   * `/ratios` endpoint, which (unlike `/key-metrics`) carries
   * `priceToSalesRatio` per period.
   */
  async keyMetricsHistorical(symbol: string, limit = 20): Promise<FmpKeyMetrics[]> {
    return this.get(
      `/ratios?symbol=${this.wireSymbol(symbol)}&period=annual&limit=${limit}`,
      z.array(FmpKeyMetrics),
    );
  }

  /**
   * Recent stock news headlines + summaries (Phase 10 — narrative tagging).
   * Uses the stable `/news/stock` endpoint; normalizes the published date and
   * source field names so callers get a stable shape.
   */
  async stockNews(symbol: string, limit = 50): Promise<FmpStockNews[]> {
    const rows = await this.get(
      `/news/stock?symbols=${this.wireSymbol(symbol)}&limit=${limit}`,
      z.array(FmpStockNewsRaw),
    );
    return rows.map((r) => ({
      title: r.title,
      text: r.text ?? '',
      publishedAt: r.publishedDate ?? r.date ?? '',
      source: r.site ?? r.publisher ?? '',
      url: r.url ?? '',
    }));
  }
}

export * from './live-fetchers.js';
export * from './universe.js';
