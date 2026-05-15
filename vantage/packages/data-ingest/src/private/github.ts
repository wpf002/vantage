import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * GitHub org-velocity fetcher.
 *
 * Scans up to 20 non-archived / non-fork repos and counts commits + unique
 * authors over a trailing 90-day window. Per-repo failures (404, rate limit)
 * are skipped so a single bad repo doesn't fail the whole org scan.
 */

const GITHUB_BASE = 'https://api.github.com';
const TIMEOUT_MS = 15_000;
const MAX_REPOS = 20;
const WINDOW_DAYS = 90;

const RepoEntry = z
  .object({
    name: z.string(),
    archived: z.boolean().optional(),
    fork: z.boolean().optional(),
    pushed_at: z.string().nullable().optional(),
  })
  .passthrough();

const CommitEntry = z
  .object({
    author: z.object({ login: z.string() }).nullable().optional(),
  })
  .passthrough();

export interface GitHubVelocity {
  org: string;
  commits90d: number;
  activeContributors90d: number;
  reposScanned: number;
  asOf: string;
}

function headers(token?: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'vantage-data-ingest',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function getJson<T>(
  url: string,
  schema: z.ZodType<T>,
  token?: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: headers(token), signal: controller.signal });
    if (!resp.ok) throw new UpstreamError('github', `HTTP ${resp.status}`);
    return schema.parse(await resp.json());
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('github', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGitHubVelocity(
  org: string,
  token?: string,
): Promise<GitHubVelocity> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const repos = await getJson(
    `${GITHUB_BASE}/orgs/${org}/repos?per_page=100&sort=pushed`,
    z.array(RepoEntry),
    token,
  );

  const candidates = repos
    .filter((r) => !r.archived && !r.fork)
    .slice(0, MAX_REPOS);

  let commits90d = 0;
  let reposScanned = 0;
  const contributors = new Set<string>();

  const perRepo = await Promise.all(
    candidates.map(async (repo) => {
      try {
        const commits = await getJson(
          `${GITHUB_BASE}/repos/${org}/${repo.name}/commits?since=${since}&per_page=100`,
          z.array(CommitEntry),
          token,
        );
        return commits;
      } catch {
        return null; // skip 404 / rate-limited repos
      }
    }),
  );

  for (const commits of perRepo) {
    if (commits === null) continue;
    reposScanned += 1;
    commits90d += commits.length;
    for (const c of commits) {
      if (c.author?.login) contributors.add(c.author.login);
    }
  }

  return {
    org,
    commits90d,
    activeContributors90d: contributors.size,
    reposScanned,
    asOf: new Date().toISOString(),
  };
}
