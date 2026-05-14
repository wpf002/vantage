import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * Private-side data sources. ALL FREE.
 *
 * Each client implements `fetch(target)` and returns a normalized payload.
 * Errors propagate as UpstreamError so the harmonizer can downstream-drop
 * the signal cleanly.
 */

// ── SEC EDGAR — Form D funding leakage ─────────────────────────────────────
export interface SecEdgarClient {
  fetchFormDFilings(cik: string): Promise<Array<{ filedAt: string; offeringAmount: number }>>;
}

export function createSecEdgar(userAgent: string): SecEdgarClient {
  return {
    async fetchFormDFilings(cik: string) {
      const url = `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`;
      const resp = await fetch(url, { headers: { 'user-agent': userAgent } });
      if (!resp.ok) throw new UpstreamError('sec-edgar', `HTTP ${resp.status}`);
      // Phase 1 stub: real parsing happens in Phase 2 / data backfill.
      return [];
    },
  };
}

// ── FRED — macro context ───────────────────────────────────────────────────
export interface FredClient {
  fetchSeries(seriesId: string): Promise<Array<{ date: string; value: number }>>;
}

export function createFred(apiKey: string): FredClient {
  return {
    async fetchSeries(seriesId: string) {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json`;
      const resp = await fetch(url);
      if (!resp.ok) throw new UpstreamError('fred', `HTTP ${resp.status}`);
      const json = (await resp.json()) as { observations: Array<{ date: string; value: string }> };
      return json.observations
        .filter((o) => o.value !== '.')
        .map((o) => ({ date: o.date, value: Number(o.value) }));
    },
  };
}

// ── GitHub — engineering velocity ──────────────────────────────────────────
export interface GitHubClient {
  fetchOrgVelocity(org: string): Promise<{ commits90d: number; activeContributors90d: number }>;
}

export function createGitHub(token: string): GitHubClient {
  const headers = { authorization: `Bearer ${token}`, 'user-agent': 'vantage' };
  return {
    async fetchOrgVelocity(org: string) {
      const url = `https://api.github.com/orgs/${org}/repos?per_page=100`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) throw new UpstreamError('github', `HTTP ${resp.status}`);
      // Phase 1 stub.
      return { commits90d: 0, activeContributors90d: 0 };
    },
  };
}

// ── USPTO — IP filings ─────────────────────────────────────────────────────
export interface UsptoClient {
  fetchPatentsByAssignee(assignee: string): Promise<Array<{ filedAt: string; title: string }>>;
}

export function createUspto(_apiKey?: string): UsptoClient {
  return {
    async fetchPatentsByAssignee(assignee: string) {
      const url = `https://api.patentsview.org/patents/query?q={"assignee_organization":"${assignee}"}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new UpstreamError('uspto', `HTTP ${resp.status}`);
      return [];
    },
  };
}

// ── Google Trends (via proxy) — search demand ──────────────────────────────
export interface GoogleTrendsClient {
  fetchInterest(keyword: string): Promise<Array<{ date: string; value: number }>>;
}

export function createGoogleTrends(proxyUrl: string): GoogleTrendsClient {
  return {
    async fetchInterest(keyword: string) {
      const url = `${proxyUrl}?keyword=${encodeURIComponent(keyword)}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new UpstreamError('google-trends', `HTTP ${resp.status}`);
      return [];
    },
  };
}

// ── BuiltWith — tech-stack change ──────────────────────────────────────────
export interface BuiltWithClient {
  fetchDomain(domain: string): Promise<{ technologies: string[] }>;
}

export function createBuiltWith(apiKey: string): BuiltWithClient {
  return {
    async fetchDomain(domain: string) {
      const url = `https://api.builtwith.com/free1/api.json?KEY=${apiKey}&LOOKUP=${domain}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new UpstreamError('builtwith', `HTTP ${resp.status}`);
      return { technologies: [] };
    },
  };
}

// ── Cloudflare Radar + Tranco — domain rank ────────────────────────────────
export interface DomainRankClient {
  fetchTrancoRank(domain: string): Promise<number | null>;
}

export function createDomainRank(): DomainRankClient {
  return {
    async fetchTrancoRank(domain: string) {
      const url = `https://tranco-list.eu/api/ranks/domain/${domain}`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const json = (await resp.json()) as { ranks: Array<{ rank: number }> };
      return json.ranks[0]?.rank ?? null;
    },
  };
}
