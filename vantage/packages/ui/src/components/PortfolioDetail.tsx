import type { PortfolioDetail } from '@/lib/portfolios';
import { formatPercent, sectorLabel, sleeveLabel } from '@/lib/portfolios';

const SLEEVES: Array<'core' | 'growth' | 'defensive' | 'tactical'> = [
  'core',
  'growth',
  'defensive',
  'tactical',
];

export function PortfolioDetailView({ portfolio }: { portfolio: PortfolioDetail }) {
  const { constraints, sleeveWeights, cashWeight, allocations, warnings } = portfolio;
  const sleeveTargets = constraints.sleeveTargets;

  const sleeveHoldings: Record<string, number> = {};
  for (const a of allocations) {
    sleeveHoldings[a.sleeve] = (sleeveHoldings[a.sleeve] ?? 0) + 1;
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <section className="col-span-12 lg:col-span-7">
        <p className="eyebrow mb-2">Sleeve Allocation</p>
        <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
          Each group plays a different role: Core for steady compounders, Growth for higher-risk
          higher-upside names, Defensive for ballast, Tactical for shorter-term ideas.
        </p>
        <table className="editorial-table">
          <thead>
            <tr>
              <th>Group</th>
              <th className="num">Target</th>
              <th className="num">Held</th>
              <th className="num">Holdings</th>
            </tr>
          </thead>
          <tbody>
            {SLEEVES.map((s) => (
              <tr key={s}>
                <td className="font-serif">{sleeveLabel(s)}</td>
                <td className="num">{formatPercent(sleeveTargets[s], 0)}</td>
                <td className="num text-editorial">{formatPercent(sleeveWeights[s] ?? 0)}</td>
                <td className="num">{sleeveHoldings[s] ?? 0}</td>
              </tr>
            ))}
            <tr>
              <td className="font-serif italic">Cash, not yet invested</td>
              <td className="num text-ink-500">—</td>
              <td className="num">{formatPercent(cashWeight)}</td>
              <td className="num text-ink-500">—</td>
            </tr>
          </tbody>
        </table>
      </section>

      <aside className="col-span-12 lg:col-span-5 lg:border-l lg:border-ink-100 lg:pl-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-8">
          <div>
            <p className="eyebrow mb-4">Limits</p>
            <ul className="font-serif text-sm space-y-3 text-ink-900 list-disc list-outside pl-5 marker:text-ink-500">
              <li>
                No single holding above{' '}
                <span className="font-mono">{formatPercent(constraints.maxAssetWeight, 0)}</span>{' '}
                of the portfolio.
              </li>
              <li>
                No single sector above{' '}
                <span className="font-mono">{formatPercent(constraints.maxSectorWeight, 0)}</span>{' '}
                of the portfolio.
              </li>
              <li>
                Spread across at least{' '}
                <span className="font-mono">{constraints.minCrossSectorCount}</span> different
                sectors.
              </li>
            </ul>
          </div>

          {warnings.length > 0 ? (
            <div>
              <p className="eyebrow mb-2">Notes</p>
              <ul className="font-serif italic text-sm text-ink-900 space-y-2 list-disc list-outside pl-5 marker:text-ink-500 marker:not-italic">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="col-span-12">
        <hr className="border-ink-100 mb-8" />
        <p className="eyebrow mb-4">Holdings</p>
        {allocations.length === 0 ? (
          <p className="font-serif italic text-ink-700">
            No holdings yet. Run a rebuild once the universe has enough current classifications.
          </p>
        ) : (
          <table className="editorial-table [&>tbody>tr:last-child>td]:border-b-0">
            <thead>
              <tr>
                <th>Holding</th>
                <th>Ticker</th>
                <th>Group</th>
                <th>Sector</th>
                <th className="num">Share of Portfolio</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.id}>
                  <td className="font-serif">{a.name}</td>
                  <td className="font-mono text-xs">{a.ticker ?? '—'}</td>
                  <td className="font-sans text-sm">{sleeveLabel(a.sleeve)}</td>
                  <td className="font-sans text-sm text-ink-700">{sectorLabel(a.sector)}</td>
                  <td className="num">{formatPercent(a.weight)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
