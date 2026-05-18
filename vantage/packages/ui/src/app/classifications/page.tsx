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
    label: 'High Asymmetry',
    deck: 'Bullish with controlled downside. Sized for upside if the thesis holds up.',
  },
  TACTICAL: {
    label: 'Tactical',
    deck: 'Bullish but timing-dependent. Narrative heat is elevated, so entry matters.',
  },
  AVOID: {
    label: 'Avoid',
    deck: 'Weak structure or net-bearish signal mix.',
  },
};

const FILTERS: Array<{ key: AssetClass | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'CORE', label: 'Core' },
  { key: 'HIGH_ASYMMETRY', label: 'High Asymmetry' },
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

export default async function ClassificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}) {
  const sp = await searchParams;
  const requested = (sp.class ?? 'ALL').toUpperCase();
  const active: AssetClass | 'ALL' =
    requested === 'CORE' || requested === 'HIGH_ASYMMETRY' || requested === 'TACTICAL' || requested === 'AVOID'
      ? requested
      : 'ALL';

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
      <nav className="col-span-12 flex flex-wrap gap-6 border-b border-ink-100 pb-4">
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

      <section className="col-span-12 space-y-16">
        {groupsToRender.map((cls, idx) => {
          const meta = CLASS_META[cls];
          const items = grouped[cls];
          return (
            <div key={cls} className={idx > 0 ? 'border-t border-ink-100 pt-16' : ''}>
              <div className="border-b border-ink-100 pb-4 mb-6">
                <p className="eyebrow mb-2">{meta.label}</p>
                <p className="font-serif text-base text-ink-700 max-w-measure leading-relaxed">
                  {meta.deck}
                </p>
              </div>

              {items.length === 0 ? (
                <p className="font-serif italic text-ink-500">
                  No companies in this bucket yet.
                </p>
              ) : (
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
              )}
            </div>
          );
        })}
      </section>
    </article>
  );
}
