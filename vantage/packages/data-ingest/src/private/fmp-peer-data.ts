import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * FMP peer-financials fetcher for the private valuation orchestrator.
 *
 * Pulls profile + key-metrics-ttm + income-statement (last 2) per peer in
 * parallel, then aggregates across peers into a set of medians the
 * orchestrator uses to synthesize DCF / Comps / LBO inputs.
 *
 * Per-peer failures degrade gracefully (the peer is dropped); the run only
 * fails if fewer than 3 peers survive.
 */

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const TIMEOUT_MS = 15_000;
const MIN_PEERS = 3;

const ProfileEntry = z
  .object({
    symbol: z.string(),
    beta: z.coerce.number().nullable().optional(),
  })
  .passthrough();

const KeyMetricsTtmEntry = z
  .object({
    evToSalesTTM: z.number().nullable().optional(),
    evToEBITDATTM: z.number().nullable().optional(),
    capexToRevenueTTM: z.number().nullable().optional(),
  })
  .passthrough();

const IncomeStatementEntry = z
  .object({
    date: z.string(),
    revenue: z.number().nullable().optional(),
    ebitda: z.number().nullable().optional(),
  })
  .passthrough();

export interface PeerSnapshot {
  ticker: string;
  evToRevenue: number | null;
  evToEbitda: number | null;
  ebitdaMargin: number | null;
  revenueGrowthLtm: number | null;
  capexPctRevenue: number | null;
  beta: number | null;
}

export interface PeerMedians {
  evToRevenue: number;
  evToEbitda: number | null;
  ebitdaMargin: number;
  revenueGrowthLtm: number;
  capexPctRevenue: number;
  beta: number;
  peerCount: number;
  snapshots: PeerSnapshot[];
  asOf: string;
}

async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new UpstreamError('fmp', `HTTP ${resp.status}`);
    const json = await resp.json();
    return schema.parse(json);
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('fmp', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

async function fetchPeerSnapshot(ticker: string, apiKey: string): Promise<PeerSnapshot> {
  const [profileArr, keyMetricsArr, incomeArr] = await Promise.all([
    getJson(`${FMP_BASE}/profile?symbol=${ticker}&apikey=${apiKey}`, z.array(ProfileEntry)),
    getJson(
      `${FMP_BASE}/key-metrics-ttm?symbol=${ticker}&apikey=${apiKey}`,
      z.array(KeyMetricsTtmEntry),
    ),
    getJson(
      `${FMP_BASE}/income-statement?symbol=${ticker}&limit=2&apikey=${apiKey}`,
      z.array(IncomeStatementEntry),
    ),
  ]);

  const profile = profileArr[0];
  const km = keyMetricsArr[0];
  const latest = incomeArr[0];
  const prior = incomeArr[1];

  const evToRevenue = km?.evToSalesTTM ?? null;
  const evToEbitda =
    km?.evToEBITDATTM != null && km.evToEBITDATTM > 0 ? km.evToEBITDATTM : null;
  const capexPctRevenue = km?.capexToRevenueTTM != null ? Math.abs(km.capexToRevenueTTM) : null;
  const beta = profile?.beta ?? null;

  const ebitdaMargin =
    latest?.revenue != null && latest.revenue > 0 && latest.ebitda != null
      ? latest.ebitda / latest.revenue
      : null;

  const revenueGrowthLtm =
    latest?.revenue != null && prior?.revenue != null && prior.revenue > 0
      ? (latest.revenue - prior.revenue) / prior.revenue
      : null;

  return { ticker, evToRevenue, evToEbitda, ebitdaMargin, revenueGrowthLtm, capexPctRevenue, beta };
}

/**
 * Pull peer financials for `tickers` and reduce to a median set.
 * Throws InsufficientDataError-equivalent UpstreamError if <3 peers survive.
 */
export async function fetchPeerMedians(
  tickers: string[],
  apiKey: string,
): Promise<PeerMedians> {
  if (!apiKey) throw new UpstreamError('fmp', 'missing API key');

  const results = await Promise.all(
    tickers.map((t) => fetchPeerSnapshot(t, apiKey).catch(() => null)),
  );
  const snapshots = results.filter((s): s is PeerSnapshot => s !== null);

  // A peer is "valid" if it carries the three fields the engines hard-require.
  const valid = snapshots.filter(
    (s) => s.evToRevenue != null && s.ebitdaMargin != null && s.beta != null,
  );
  if (valid.length < MIN_PEERS) {
    throw new UpstreamError(
      'fmp',
      `only ${valid.length} valid peers (need ${MIN_PEERS}) from [${tickers.join(', ')}]`,
    );
  }

  const evToRevenue = median(valid.map((s) => s.evToRevenue!))!;
  const ebitdaMargin = median(valid.map((s) => s.ebitdaMargin!))!;
  const beta = median(valid.map((s) => s.beta!))!;

  const ebitdaValues = valid
    .map((s) => s.evToEbitda)
    .filter((v): v is number => v != null);
  const evToEbitda = ebitdaValues.length >= MIN_PEERS ? median(ebitdaValues) : null;

  const growthValues = valid
    .map((s) => s.revenueGrowthLtm)
    .filter((v): v is number => v != null);
  const revenueGrowthLtm = median(growthValues) ?? 0.15;

  const capexValues = valid
    .map((s) => s.capexPctRevenue)
    .filter((v): v is number => v != null);
  const capexPctRevenue = median(capexValues) ?? 0.05;

  return {
    evToRevenue,
    evToEbitda,
    ebitdaMargin,
    revenueGrowthLtm,
    capexPctRevenue,
    beta,
    peerCount: valid.length,
    snapshots,
    asOf: new Date().toISOString(),
  };
}
