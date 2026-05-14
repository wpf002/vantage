import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * Public-side data source: Financial Modeling Prep (FMP).
 *
 * Free tier: 250 calls/day.
 * Starter: $22/mo.
 * Premium: $79/mo.
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
  sector: z.string().optional(),
  industry: z.string().optional(),
  marketCap: z.number().optional(),
  beta: z.number().optional(),
  price: z.number().optional(),
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

export class FmpClient {
  private base: string;
  private key: string;
  private timeout: number;

  constructor(cfg: FmpConfig) {
    this.base = cfg.baseUrl ?? 'https://financialmodelingprep.com/api';
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

  async profile(symbol: string): Promise<FmpProfile | null> {
    const arr = await this.get(`/v3/profile/${symbol}`, z.array(FmpProfile));
    return arr[0] ?? null;
  }

  async earnings(symbol: string, limit = 8): Promise<FmpEarning[]> {
    return this.get(
      `/v3/historical/earning_calendar/${symbol}?limit=${limit}`,
      z.array(FmpEarning),
    );
  }

  async priceTarget(symbol: string): Promise<FmpPriceTarget | null> {
    const arr = await this.get(
      `/v4/price-target-consensus?symbol=${symbol}`,
      z.array(FmpPriceTarget),
    );
    return arr[0] ?? null;
  }

  async revenueSegmentsProduct(symbol: string): Promise<FmpSegment[]> {
    return this.get(
      `/v4/revenue-product-segmentation?symbol=${symbol}&structure=flat&period=annual`,
      z.array(FmpSegment),
    );
  }

  async revenueSegmentsGeo(symbol: string): Promise<FmpSegment[]> {
    return this.get(
      `/v4/revenue-geographic-segmentation?symbol=${symbol}&structure=flat&period=annual`,
      z.array(FmpSegment),
    );
  }
}
