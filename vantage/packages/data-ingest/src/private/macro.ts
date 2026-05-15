import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * Macro-environment fetcher.
 *
 * Pulls the FRED 10-year treasury yield (DGS10) for the risk-free rate that
 * feeds WACC. FRED publishes "." for non-trading days, so we request the
 * latest 10 observations and walk back to the first real value.
 *
 * Equity risk premium is a slow-moving estimate (Damodaran) — held constant
 * here rather than fetched, since it is not a live series.
 */

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const TIMEOUT_MS = 15_000;
const EQUITY_RISK_PREMIUM = 0.055;

const FredResponse = z
  .object({
    observations: z.array(
      z.object({ date: z.string(), value: z.string() }).passthrough(),
    ),
  })
  .passthrough();

export interface MacroEnvironment {
  riskFreeRate: number;
  equityRiskPremium: number;
  asOf: string;
  source: string;
}

export async function fetchMacroEnvironment(fredApiKey: string): Promise<MacroEnvironment> {
  if (!fredApiKey) throw new UpstreamError('fred', 'missing API key');

  const url =
    `${FRED_BASE}?series_id=DGS10&api_key=${fredApiKey}` +
    `&file_type=json&sort_order=desc&limit=10`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new UpstreamError('fred', `HTTP ${resp.status}`);
    const parsed = FredResponse.parse(await resp.json());
    const observation = parsed.observations.find((o) => o.value !== '.');
    if (!observation) throw new UpstreamError('fred', 'no valid DGS10 observation in last 10');

    const value = Number(observation.value);
    if (!Number.isFinite(value)) {
      throw new UpstreamError('fred', `non-numeric DGS10 value "${observation.value}"`);
    }

    return {
      riskFreeRate: value / 100,
      equityRiskPremium: EQUITY_RISK_PREMIUM,
      asOf: observation.date,
      source: 'FRED DGS10 + Damodaran ERP',
    };
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('fred', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
