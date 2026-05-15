import { InsufficientDataError } from '@vantage/shared';
import type {
  FmpClient,
  FmpProfile,
  FmpEarning,
  FmpHistoricalPrice,
  FmpSegment,
  FmpPriceTarget,
  FmpPriceTargetSummary,
  AnalystRecommendationMonth,
  FmpRatiosTtm,
  FmpKeyMetrics,
} from './index.js';

/**
 * Orchestrator-facing public-data layer.
 *
 * `fetchAllPublicData` fans out the eight FMP calls a Public Score needs in
 * parallel and assembles a `PublicDataBundle`. Per-source nulls are tolerated
 * for segments, price targets, analyst recs, and key metrics — some tickers
 * simply don't report them. Profile, earnings, price history, and TTM ratios
 * are required: if any is missing the run raises `InsufficientDataError`.
 */

export interface PublicDataBundle {
  profile: FmpProfile;
  earnings: FmpEarning[];
  prices: FmpHistoricalPrice[];
  segments: FmpSegment[] | null;
  priceTarget: FmpPriceTarget | null;
  priceTargetSummary: FmpPriceTargetSummary | null;
  analystRecs: AnalystRecommendationMonth[] | null;
  ratios: FmpRatiosTtm;
  keyMetrics: FmpKeyMetrics[] | null;
  fetchedAt: string;
}

export async function fetchAllPublicData(
  ticker: string,
  fmp: FmpClient,
): Promise<PublicDataBundle> {
  const [
    profile,
    earnings,
    prices,
    segments,
    priceTarget,
    priceTargetSummary,
    analystRecs,
    ratios,
    keyMetrics,
  ] = await Promise.all([
    // Required sources — a thrown UpstreamError here propagates as a 502.
    fmp.profile(ticker),
    fmp.earnings(ticker, 8),
    fmp.historicalPrices(ticker, 365),
    // Optional sources — degrade to null so the score still computes.
    fmp.revenueSegmentsProduct(ticker).catch(() => null),
    fmp.priceTarget(ticker).catch(() => null),
    fmp.priceTargetSummary(ticker).catch(() => null),
    fmp.analystRecommendations(ticker).catch(() => null),
    // Required source.
    fmp.ratiosTtm(ticker),
    // Optional source.
    fmp.keyMetricsHistorical(ticker, 20).catch(() => null),
  ]);

  const missing: string[] = [];
  if (!profile) missing.push('company profile');
  if (!earnings || earnings.length === 0) missing.push('earnings history');
  if (!prices || prices.length === 0) missing.push('price history');
  if (!ratios) missing.push('TTM ratios');
  if (missing.length > 0) {
    throw new InsufficientDataError(
      'public.score',
      `FMP returned no ${missing.join(', ')} for ${ticker} — not a usable US-listed ticker`,
    );
  }

  return {
    profile: profile!,
    earnings,
    prices,
    segments: segments && segments.length > 0 ? segments : null,
    priceTarget,
    priceTargetSummary,
    analystRecs: analystRecs && analystRecs.length > 0 ? analystRecs : null,
    ratios: ratios!,
    keyMetrics: keyMetrics && keyMetrics.length > 0 ? keyMetrics : null,
    fetchedAt: new Date().toISOString(),
  };
}
