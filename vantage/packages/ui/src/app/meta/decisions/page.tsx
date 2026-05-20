import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { apiServerGet } from '@/lib/api-server';

/**
 * /meta/decisions — every read, every outcome. Admin-only raw drill-in over
 * the decision log: what each decision predicted and what actually happened.
 */

interface DecisionFeedItem {
  id: string;
  decisionType: string;
  entity: string;
  companyName: string | null;
  confidence: number | null;
  createdAt: string;
  resolved: boolean;
  realizedReturn: number | null;
  hit: boolean | null;
}

interface DecisionFeed {
  items: DecisionFeedItem[];
  nextCursor: string | null;
}

const FILTERS: Array<{ label: string; key: string }> = [
  { label: 'All', key: 'all' },
  { label: 'Public Scores', key: 'public_score' },
  { label: 'Private Valuations', key: 'private_valuation' },
  { label: 'Classifications', key: 'classification' },
  { label: 'Portfolios', key: 'portfolio_construction' },
  { label: 'Resolved Only', key: 'resolved' },
];

const TYPE_DISPLAY: Record<string, string> = {
  public_score: 'Public Score',
  private_valuation: 'Private Valuation',
  classification: 'Classification',
  portfolio_construction: 'Portfolio',
  simulation: 'Simulation',
};

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tearSheetHref(decisionType: string, entity: string): string | null {
  if (decisionType === 'portfolio_construction') return null; // owner/system, not a tear sheet
  if (decisionType === 'public_score') return `/public/${entity}`;
  if (decisionType === 'private_valuation') return `/private/${entity}`;
  // classification — disambiguate by shape
  if (UUID_SHAPE.test(entity)) return `/private/${entity}`;
  return `/public/${entity}`;
}

function relativeTime(iso: string): string {
  const delta = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(delta / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function signedPct(x: number): string {
  const sign = x >= 0 ? '+' : '';
  return `${sign}${(x * 100).toFixed(1)}%`;
}

interface PageProps {
  searchParams: Promise<{ filter?: string; cursor?: string }>;
}

export default async function MetaDecisionsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) notFound();

  const { filter = 'all', cursor } = await searchParams;

  const qs = new URLSearchParams();
  qs.set('limit', '50');
  if (filter === 'resolved') qs.set('resolved', 'true');
  else if (filter !== 'all') qs.set('decisionType', filter);
  if (cursor) qs.set('cursor', cursor);

  let feed: DecisionFeed = { items: [], nextCursor: null };
  let fetchError: string | null = null;
  try {
    feed = await apiServerGet<DecisionFeed>(`/v1/meta/decisions?${qs.toString()}`);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'unknown error';
  }

  const filterHref = (key: string) =>
    (key === 'all' ? '/meta/decisions' : `/meta/decisions?filter=${key}`) as Route;

  return (
    <div className="max-w-page">
      <header className="border-b border-ink-100 pb-10 mb-8">
        <p className="eyebrow mb-3">Decision Log</p>
        <h1 className="font-display text-5xl tracking-editorial mb-6">Every Read, Every Outcome</h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure leading-snug">
          The raw log — what each decision predicted, and what the market did next.
        </p>
      </header>

      <nav className="mb-8 border-b border-ink-100 pb-4 overflow-x-auto">
        <div className="flex flex-nowrap items-center gap-x-8 whitespace-nowrap">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Link
                key={f.key}
                href={filterHref(f.key)}
                className={`font-sans text-eyebrow uppercase tracking-wider transition-colors flex-shrink-0 ${
                  active
                    ? 'text-editorial border-b-2 border-editorial pb-1'
                    : 'text-ink-700 hover:text-editorial'
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {fetchError ? (
        <p className="font-serif italic text-editorial">Unable to load decisions. {fetchError}</p>
      ) : feed.items.length === 0 ? (
        <p className="font-serif italic text-ink-700">No decisions in this view yet.</p>
      ) : (
        <>
          <table className="editorial-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Entity</th>
                <th className="num">Confidence</th>
                <th className="num">Outcome</th>
                <th className="num">Hit</th>
              </tr>
            </thead>
            <tbody>
              {feed.items.map((d) => {
                const href = tearSheetHref(d.decisionType, d.entity);
                const name = d.companyName ?? d.entity;
                return (
                  <tr key={d.id}>
                    <td className="font-mono text-xs text-ink-500 whitespace-nowrap">
                      {relativeTime(d.createdAt)}
                    </td>
                    <td>
                      <span className="font-sans text-eyebrow uppercase tracking-wider text-ink-900">
                        {TYPE_DISPLAY[d.decisionType] ?? d.decisionType}
                      </span>
                    </td>
                    <td>
                      {href ? (
                        <Link
                          href={href as Route}
                          className="font-serif text-ink-900 hover:text-editorial border-b border-transparent hover:border-editorial"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span className="font-serif text-ink-900">{name}</span>
                      )}
                    </td>
                    <td className="num">
                      {d.confidence !== null ? (
                        `${(d.confidence * 100).toFixed(0)}%`
                      ) : (
                        <span className="font-serif italic text-ink-500">—</span>
                      )}
                    </td>
                    <td className="num">
                      {d.resolved && d.realizedReturn !== null ? (
                        signedPct(d.realizedReturn)
                      ) : (
                        <span className="font-serif italic text-ink-500">—</span>
                      )}
                    </td>
                    <td className="num">
                      {!d.resolved || d.hit === null ? (
                        <span className="font-serif italic text-ink-500">—</span>
                      ) : (
                        <span
                          aria-label={d.hit ? 'hit' : 'miss'}
                          className={`inline-block h-2.5 w-2.5 rounded-full ${
                            d.hit ? 'bg-editorial' : 'bg-ink-300'
                          }`}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-6 flex items-center justify-between gap-4">
            {cursor ? (
              <Link
                href={filterHref(filter)}
                className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
              >
                &larr; Back to Start
              </Link>
            ) : (
              <span />
            )}
            {feed.nextCursor ? (
              <Link
                href={
                  `/meta/decisions?${filter !== 'all' ? `filter=${filter}&` : ''}cursor=${encodeURIComponent(feed.nextCursor)}` as Route
                }
                className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
              >
                Next &rarr;
              </Link>
            ) : (
              <span />
            )}
          </div>
        </>
      )}
    </div>
  );
}
