import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * Tranco domain-rank fetcher.
 *
 * Tranco is a research-grade, manipulation-resistant domain ranking. We use
 * the rank (and its log10) as a coarse proxy for reach / market presence.
 * A 404 means the domain isn't ranked — that's a legitimate null, not a fault.
 */

const TRANCO_BASE = 'https://tranco-list.eu/api/ranks/domain';
const TIMEOUT_MS = 10_000;

const RankResponse = z
  .object({
    ranks: z
      .array(z.object({ date: z.string(), rank: z.number() }).passthrough())
      .default([]),
  })
  .passthrough();

export interface TrancoRank {
  domain: string;
  currentRank: number;
  rankLog: number;
  asOf: string;
}

export async function fetchTrancoRank(domain: string): Promise<TrancoRank | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${TRANCO_BASE}/${domain}`, {
      headers: { 'user-agent': 'vantage-data-ingest', accept: 'application/json' },
      signal: controller.signal,
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new UpstreamError('tranco', `HTTP ${resp.status}`);
    const parsed = RankResponse.parse(await resp.json());
    const latest = parsed.ranks[0];
    if (!latest) return null;
    return {
      domain,
      currentRank: latest.rank,
      rankLog: Math.log10(Math.max(1, latest.rank)),
      asOf: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('tranco', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
