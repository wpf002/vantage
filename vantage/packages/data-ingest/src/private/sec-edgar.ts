import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * SEC EDGAR Form D fetcher — funding-leakage signal.
 *
 * Uses EDGAR's full-text search index to count Form D filings (exempt
 * offerings) naming the company over the trailing 12 months. SEC requires a
 * descriptive User-Agent on every request; it is passed in, never hardcoded.
 */

const EFTS_BASE = 'https://efts.sec.gov/LATEST/search-index';
const TIMEOUT_MS = 15_000;

const SearchResponse = z
  .object({
    hits: z
      .object({
        total: z.object({ value: z.number() }).passthrough(),
        hits: z
          .array(
            z
              .object({
                _source: z
                  .object({
                    file_date: z.string().nullable().optional(),
                    display_names: z.array(z.string()).nullable().optional(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough(),
  })
  .passthrough();

export interface FormDActivity {
  filerName: string;
  filingsTrailing12m: number;
  mostRecent: string | null;
  asOf: string;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function fetchFormDActivity(
  companyName: string,
  userAgent: string,
): Promise<FormDActivity> {
  if (!userAgent) throw new UpstreamError('sec-edgar', 'missing SEC User-Agent');

  const startdt = isoDaysAgo(365);
  const enddt = new Date().toISOString().slice(0, 10);
  const url =
    `${EFTS_BASE}?q=${encodeURIComponent(`"${companyName}"`)}` +
    `&forms=D&dateRange=custom&startdt=${startdt}&enddt=${enddt}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { 'user-agent': userAgent, accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) throw new UpstreamError('sec-edgar', `HTTP ${resp.status}`);
    const parsed = SearchResponse.parse(await resp.json());
    const hits = parsed.hits.hits;
    const mostRecent =
      hits
        .map((h) => h._source.file_date)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null;

    return {
      filerName: companyName,
      filingsTrailing12m: parsed.hits.total.value,
      mostRecent,
      asOf: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('sec-edgar', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
