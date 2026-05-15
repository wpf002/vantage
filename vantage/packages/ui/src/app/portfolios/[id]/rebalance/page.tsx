import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { auth } from '@/lib/auth';
import { apiServerGet, apiServerGetNullable, apiServerPost } from '@/lib/api-server';
import type { PortfolioDetail } from '@/lib/portfolios';
import { SECTOR_LABELS, sectorLabel } from '@/lib/portfolios';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

interface Candidate {
  entity: string;
  name: string;
  sector: string;
  assetClass: 'CORE' | 'HIGH_ASYMMETRY' | 'TACTICAL' | 'AVOID';
  conviction: number;
}

// All Sector enum values, in the order we want them rendered.
const ALL_SECTORS: readonly string[] = [
  'technology',
  'healthcare',
  'financials',
  'consumer_discretionary',
  'consumer_staples',
  'industrials',
  'energy',
  'materials',
  'utilities',
  'real_estate',
  'communication_services',
  'other',
];

export default async function RebalancePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const portfolio = await apiServerGetNullable<PortfolioDetail>(`/v1/portfolios/${id}`);
  if (!portfolio) notFound();
  if (portfolio.ownerUserId !== userId) notFound();

  const candidates = await apiServerGet<Candidate[]>('/v1/portfolios/candidates');

  // What's currently in the portfolio — drives which chips and stocks come
  // up pre-checked when the user opens this page.
  const currentEntities = new Set(portfolio.allocations.map((a) => a.entity));
  const currentSectors = new Set(portfolio.allocations.map((a) => a.sector));

  // If there's no portfolio history yet (e.g., a brand-new build with no
  // allocations), default to "all selected" so the picker reflects the full
  // universe. Otherwise, mirror what's actually held — explicit deselects
  // from the last rebalance survive.
  const noPriorState = currentEntities.size === 0;

  async function submitRebalance(formData: FormData) {
    'use server';
    const checkedSectors = formData.getAll('sectors').map(String);
    // Send sectorFilter only when the user has narrowed — leaving every
    // sector checked means "no filter," matching the engine's default.
    const sectorFilter =
      checkedSectors.length > 0 && checkedSectors.length < ALL_SECTORS.length
        ? checkedSectors
        : undefined;

    const keptEntities = new Set(
      Array.from(formData.entries())
        .filter(([k]) => k.startsWith('keep-'))
        .map(([k]) => k.slice('keep-'.length)),
    );
    const excludeEntities = candidates
      .filter((c) => !keptEntities.has(c.entity))
      .map((c) => c.entity);

    try {
      const result = await apiServerPost<{ portfolioId: string }>(
        `/v1/portfolios/${id}/rebalance`,
        {
          sectorFilter,
          excludeEntities: excludeEntities.length > 0 ? excludeEntities : undefined,
        },
      );
      redirect(`/portfolios/${result.portfolioId}` as Route);
    } catch (err) {
      if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err;
      const msg = err instanceof Error ? err.message : 'unknown error';
      const match = msg.match(/"message":"([^"]+)"/);
      const reason = match ? match[1] : msg;
      redirect(`/portfolios/${id}/rebalance?error=${encodeURIComponent(reason)}` as Route);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Rebalance</p>
        <h1 className="font-display text-5xl tracking-editorial">{portfolio.name}</h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure mt-6">
          Pick which sectors and which stocks the engine should pull from. Unchecked items are
          left out. A new version is created — the original portfolio stays untouched.
        </p>
      </header>

      {error ? (
        <div className="col-span-12">
          <p className="font-serif italic text-editorial">{error}</p>
        </div>
      ) : null}

      <form action={submitRebalance} className="col-span-12 space-y-12">
        <section>
          <p className="eyebrow mb-3">Company Categories</p>
          <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
            Every sector Vantage tracks. Uncheck a sector to exclude its stocks from this rebuild.
          </p>
          <div className="flex flex-wrap gap-3">
            {ALL_SECTORS.map((s) => (
              <ChipCheckbox
                key={s}
                name="sectors"
                value={s}
                label={SECTOR_LABELS[s] ?? s}
                defaultChecked={noPriorState || currentSectors.has(s)}
              />
            ))}
          </div>
        </section>

        <section>
          <p className="eyebrow mb-3">Stocks</p>
          <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
            Every classified company. Check the ones to include, uncheck the rest. AVOID-classified
            companies are skipped at build time, even if you leave them checked.
          </p>

          {candidates.length === 0 ? (
            <p className="font-serif italic text-ink-700">
              No candidates available yet — score a few companies first.
            </p>
          ) : (
            <table className="editorial-table">
              <thead>
                <tr>
                  <th className="w-12"></th>
                  <th>Holding</th>
                  <th>Ticker</th>
                  <th>Sector</th>
                  <th>Class</th>
                  <th className="num">Conviction</th>
                  <th>In Book</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.entity}>
                    <td>
                      <input
                        type="checkbox"
                        name={`keep-${c.entity}`}
                        defaultChecked={noPriorState || currentEntities.has(c.entity)}
                        className="h-4 w-4 accent-editorial cursor-pointer"
                      />
                    </td>
                    <td className="font-serif">{c.name}</td>
                    <td className="font-mono text-xs">{c.entity}</td>
                    <td className="font-sans text-sm text-ink-700">{sectorLabel(c.sector)}</td>
                    <td className="font-sans text-xs uppercase tracking-wider text-ink-900">
                      {c.assetClass === 'AVOID' ? (
                        <span className="text-editorial">{c.assetClass}</span>
                      ) : (
                        c.assetClass
                      )}
                    </td>
                    <td className="num">{(c.conviction * 100).toFixed(0)}%</td>
                    <td className="font-sans text-xs">
                      {currentEntities.has(c.entity) ? (
                        <span className="text-editorial">Yes</span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="font-sans text-xs text-ink-700 mt-4 leading-snug max-w-measure">
            Don&apos;t see a company you want? Score it first at{' '}
            <span className="font-mono">/public/{`{ticker}`}</span> or{' '}
            <span className="font-mono">/private/{`{id}`}</span> — the worker classifies it within
            a few seconds and it appears here on the next visit.
          </p>
        </section>

        <div className="flex items-baseline justify-between gap-6">
          <button
            type="submit"
            className="font-display text-2xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Rebuild Portfolio &rarr;
          </button>
          <Link
            href={`/portfolios/${id}` as Route}
            className="font-sans text-sm text-ink-700 hover:text-editorial"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

/**
 * Editorial chip checkbox — visible toggle state with no client JS. Selected
 * state shows ink-900 background; deselected is the cream/ink-300 outline.
 */
function ChipCheckbox({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex items-center cursor-pointer select-none">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span
        className="
          font-sans text-xs uppercase tracking-wider
          border border-ink-300 text-ink-500 px-3 py-2
          peer-checked:bg-ink-900 peer-checked:text-cream peer-checked:border-ink-900
          hover:border-editorial
        "
      >
        {label}
      </span>
    </label>
  );
}
