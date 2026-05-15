import { apiServerGetNullable } from '@/lib/api-server';
import type { PortfolioDetail } from '@/lib/portfolios';
import { PortfolioDetailView } from '@/components/PortfolioDetail';
import { formatDate } from '@/lib/format';

export default async function SystemPortfolioPage() {
  const portfolio = await apiServerGetNullable<PortfolioDetail>('/v1/portfolios/system');

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Standing Position</p>
        <h1 className="font-display text-5xl tracking-editorial">Default</h1>
        <p className="font-serif italic text-deck text-ink-700 max-w-measure mt-6">
          Rebuilt nightly from current classifications. No manual overrides. A standing reference
          position derived from the universe Vantage currently scores.
        </p>
        {portfolio ? (
          <p className="font-mono text-eyebrow uppercase text-ink-900 tracking-wider mt-6">
            Last Rebuilt {formatDate(portfolio.asOf)}
          </p>
        ) : null}
      </header>

      {portfolio ? (
        <div className="col-span-12">
          <PortfolioDetailView portfolio={portfolio} />
        </div>
      ) : (
        <div className="col-span-12">
          <p className="font-serif italic text-ink-700">
            Default hasn&apos;t been built yet. The nightly worker assembles it from current
            classifications at 02:00 UTC. An administrator can also trigger a rebuild on demand.
          </p>
        </div>
      )}
    </div>
  );
}
