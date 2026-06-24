import Link from 'next/link';
import type { Route } from 'next';
import { apiGet } from '@/lib/api';

/**
 * /classifications — the universe Vantage has scored, sorted into one of four
 * buckets. URL-driven filter (?class=CORE) makes the bar stateless. Each
 * bucket is rendered even when empty: the visible taxonomy is the point.
 */

type AssetClass = 'CORE' | 'HIGH_ASYMMETRY' | 'TACTICAL' | 'AVOID';

interface ClassificationRow {
  entity: string;
  name: string;
  ticker: string | null;
  marketType: 'public' | 'private' | null;
  sector: string | null;
  assetClass: AssetClass;
  confidence: number;
  rationale: string;
  asOf: string;
}

const CLASS_ORDER: AssetClass[] = ['CORE', 'HIGH_ASYMMETRY', 'TACTICAL', 'AVOID'];

const CLASS_META: Record<AssetClass, { label: string; deck: string }> = {
  CORE: {
    label: 'Core',
    deck: 'High-confidence holdings with durable fundamentals. Long-duration positions.',
  },
  HIGH_ASYMMETRY: {
    label: 'Opportunistic',
    deck: 'Bullish with controlled downside. Sized for upside if the thesis holds up.',
  },
  TACTICAL: {
    label: 'Tactical',
    deck: 'Bullish but timing-dependent. Speculative premium is elevated, so entry matters.',
  },
  AVOID: {
    label: 'Avoid',
    deck: 'Weak structure or net-bearish signal mix.',
  },
};

const FILTERS: Array<{ key: AssetClass | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'CORE', label: 'Core' },
  { key: 'HIGH_ASYMMETRY', label: 'Opportunistic' },
  { key: 'TACTICAL', label: 'Tactical' },
  { key: 'AVOID', label: 'Avoid' },
];

const SECTOR_LABEL: Record<string, string> = {
  technology: 'Technology',
  healthcare: 'Healthcare',
  financials: 'Financials',
  communication_services: 'Communications',
  consumer_discretionary: 'Consumer Discretionary',
  consumer_staples: 'Consumer Staples',
  industrials: 'Industrials',
  energy: 'Energy',
  materials: 'Materials',
  utilities: 'Utilities',
  real_estate: 'Real Estate',
  other: 'Other',
};

const HOUR_MS = 60 * 60 * 1000;
const PAGE_SIZE = 20;

function relativeAge(asOf: string): string {
  const ms = Date.now() - new Date(asOf).getTime();
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(ms / 60_000));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function truncate(s: string, n = 160): { display: string; full: string; truncated: boolean } {
  if (s.length <= n) return { display: s, full: s, truncated: false };
  const cut = s.slice(0, n).replace(/[\s,;:.-]+$/, '');
  return { display: `${cut}…`, full: s, truncated: true };
}

function hrefForRow(row: ClassificationRow): string | null {
  if (row.marketType === 'public' && row.ticker) return `/public/${row.ticker}`;
  if (row.marketType === 'private') return `/private/${row.entity}`;
  return null;
}

async function fetchClassifications(filter: AssetClass | 'ALL'): Promise<ClassificationRow[]> {
  const params = new URLSearchParams({ limit: '200' });
  if (filter !== 'ALL') params.set('class', filter);
  try {
    return await apiGet<ClassificationRow[]>(`/v1/classifications?${params.toString()}`);
  } catch {
    return [];
  }
}

function ClassTable({ items }: { items: ClassificationRow[] }) {
  return (
    <table className="editorial-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Ticker</th>
          <th>Sector</th>
          <th className="num">Confidence</th>
          <th>Why</th>
          <th>Last classified</th>
        </tr>
      </thead>
      <tbody>
        {items.map((row) => {
          const href = hrefForRow(row);
          const r = truncate(row.rationale, 160);
          const sectorDisplay = row.sector ? SECTOR_LABEL[row.sector] ?? row.sector : '—';
          return (
            <tr key={row.entity}>
              <td className="font-serif text-ink-900 align-top">
                {href ? (
                  <Link
                    href={href as Route}
                    className="hover:underline decoration-editorial underline-offset-4"
                  >
                    {row.name}
                  </Link>
                ) : (
                  row.name
                )}
              </td>
              <td className="font-mono text-xs text-ink-700 align-top">
                {row.ticker ?? '—'}
              </td>
              <td className="font-sans text-xs uppercase tracking-wider text-ink-700 align-top">
                {sectorDisplay}
              </td>
              <td className="num align-top">
                {(row.confidence * 100).toFixed(0)}%
              </td>
              <td
                className="font-serif italic text-ink-700 align-top leading-relaxed"
                title={r.truncated ? r.full : undefined}
              >
                <div className="max-w-[28rem]">{r.display}</div>
              </td>
              <td className="font-mono text-xs text-ink-500 align-top whitespace-nowrap">
                {relativeAge(row.asOf)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function ClassificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const requested = (sp.class ?? 'ALL').toUpperCase();
  const active: AssetClass | 'ALL' =
    requested === 'CORE' || requested === 'HIGH_ASYMMETRY' || requested === 'TACTICAL' || requested === 'AVOID'
      ? requested
      : 'ALL';

  const pageParam = Number(sp.page ?? '1');
  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

  const rows = await fetchClassifications(active);
  const grouped: Record<AssetClass, ClassificationRow[]> = {
    CORE: [],
    HIGH_ASYMMETRY: [],
    TACTICAL: [],
    AVOID: [],
  };
  for (const r of rows) grouped[r.assetClass].push(r);
  for (const c of CLASS_ORDER) grouped[c].sort((a, b) => b.confidence - a.confidence);

  const groupsToRender: AssetClass[] = active === 'ALL' ? CLASS_ORDER : [active];

  return (
    <article className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-8">
        <h1 className="font-display text-5xl xl:text-6xl tracking-editorial leading-tight mb-4">
          Where Every Read Lands
        </h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
          Every company Vantage has scored, sorted into one of four asset classes — Core, Opportunistic,
          Tactical, or Avoid.
        </p>
      </header>

      <nav className="col-span-12 -mt-10 flex flex-wrap items-center gap-6 border-b border-ink-100 py-4">
        {FILTERS.map((f) => {
          const isActive = active === f.key;
          const href = (f.key === 'ALL'
            ? '/classifications'
            : `/classifications?class=${f.key}`) as Route;
          return (
            <Link
              key={f.key}
              href={href}
              className={
                'font-sans text-xs uppercase tracking-wider ' +
                (isActive
                  ? 'text-editorial border-b-2 border-editorial pb-1 -mb-[2px]'
                  : 'text-ink-700 hover:text-editorial')
              }
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <section className="col-span-12 space-y-12">
        {groupsToRender.map((cls) => {
          const meta = CLASS_META[cls];
          const allItems = grouped[cls];

          if (active === 'ALL') {
            // In the overview, show top PAGE_SIZE per class with a link to see all
            const displayItems = allItems.slice(0, PAGE_SIZE);
            const hasMore = allItems.length >= PAGE_SIZE;
            return (
              <div key={cls}>
                <div className="flex items-center justify-between min-h-[2.75rem] border-b border-ink-100 mb-4">
                  <div>
                    <p className="eyebrow">{meta.label}</p>
                    <p className="font-sans text-xs text-ink-500 mt-0.5">{meta.deck}</p>
                  </div>
                  <Link
                    href={`/classifications?class=${cls}` as Route}
                    className="font-sans text-xs uppercase tracking-wider text-editorial hover:text-editorial-dark whitespace-nowrap ml-4"
                  >
                    View all →
                  </Link>
                </div>
                {displayItems.length === 0 ? (
                  <p className="font-serif italic text-ink-500">No companies in this bucket yet.</p>
                ) : (
                  <>
                    <ClassTable items={displayItems} />
                    {hasMore && (
                      <p className="font-sans text-xs text-ink-500 mt-3">
                        Showing top {displayItems.length} by confidence.{' '}
                        <Link href={`/classifications?class=${cls}` as Route} className="text-editorial hover:underline">
                          View all →
                        </Link>
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          }

          // Filtered view — paginate
          const start = (page - 1) * PAGE_SIZE;
          const displayItems = allItems.slice(start, start + PAGE_SIZE);
          const hasPrev = page > 1;
          const hasNext = allItems.length > start + PAGE_SIZE;

          const prevHref = hasPrev
            ? (`/classifications?class=${cls}&page=${page - 1}` as Route)
            : null;
          const nextHref = hasNext
            ? (`/classifications?class=${cls}&page=${page + 1}` as Route)
            : null;

          return (
            <div key={cls}>
              <div className="flex items-center min-h-[2.75rem] border-b border-ink-100 mb-6">
                <div>
                  <p className="eyebrow">{meta.label}</p>
                  <p className="font-sans text-xs text-ink-500 mt-0.5">{meta.deck}</p>
                </div>
              </div>

              {displayItems.length === 0 ? (
                <p className="font-serif italic text-ink-500">
                  No companies in this bucket yet.
                </p>
              ) : (
                <>
                  <ClassTable items={displayItems} />
                  <div className="flex items-center justify-between mt-6 pt-4">
                    {hasPrev && prevHref ? (
                      <Link href={prevHref} className="font-sans text-xs uppercase tracking-wider text-editorial hover:text-editorial-dark">
                        ← Previous
                      </Link>
                    ) : (
                      <span className="font-sans text-xs uppercase tracking-wider text-ink-300">← Previous</span>
                    )}
                    <span className="font-mono text-xs text-ink-500">
                      {start + 1}–{start + displayItems.length} of {allItems.length}{allItems.length >= 200 ? '+' : ''}
                    </span>
                    {hasNext && nextHref ? (
                      <Link href={nextHref} className="font-sans text-xs uppercase tracking-wider text-editorial hover:text-editorial-dark">
                        Next →
                      </Link>
                    ) : (
                      <span className="font-sans text-xs uppercase tracking-wider text-ink-300">Next →</span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>
    </article>
  );
}
