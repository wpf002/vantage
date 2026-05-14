const GROUPS = [
  { name: 'Core', target: 0.5, actual: 0.46, holdings: 8 },
  { name: 'Growth bets', target: 0.25, actual: 0.22, holdings: 5 },
  { name: 'Defensive', target: 0.15, actual: 0.15, holdings: 4 },
  { name: 'Tactical', target: 0.1, actual: 0.08, holdings: 3 },
];

const HOLDINGS = [
  { name: 'Costco Wholesale', ticker: 'COST', group: 'Core', sector: 'Consumer Staples', weight: 0.09 },
  { name: 'Berkshire Hathaway', ticker: 'BRK.B', group: 'Core', sector: 'Financials', weight: 0.08 },
  { name: 'Microsoft', ticker: 'MSFT', group: 'Core', sector: 'Technology', weight: 0.07 },
  { name: 'Stripe', ticker: '—', group: 'Growth bets', sector: 'Payments', weight: 0.06 },
  { name: 'Anthropic', ticker: '—', group: 'Growth bets', sector: 'Technology', weight: 0.05 },
  { name: 'US Treasury Bills (1–3 months)', ticker: 'BIL', group: 'Defensive', sector: 'Cash', weight: 0.1 },
];

export default function PortfolioPage() {
  const cash = 1 - GROUPS.reduce((acc, g) => acc + g.actual, 0);

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Portfolio</p>
        <h1 className="font-display text-5xl tracking-editorial">The portfolio</h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure mt-6">
          Every holding Vantage has a read on can roll up into one portfolio. Holdings are sorted
          into a few groups by their role, and the whole thing is held to a set of simple limits.
        </p>
      </header>

      <section className="col-span-12 lg:col-span-7">
        <p className="eyebrow mb-2">How the money is split</p>
        <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
          Each group plays a different role: Core for steady compounders, Growth bets for
          higher-risk, higher-upside names, Defensive for ballast, Tactical for shorter-term ideas.
        </p>
        <table className="editorial-table">
          <thead>
            <tr>
              <th>Group</th>
              <th className="num">Aimed for</th>
              <th className="num">Actually held</th>
              <th className="num">Holdings</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <tr key={g.name}>
                <td className="font-serif">{g.name}</td>
                <td className="num">{(g.target * 100).toFixed(0)}%</td>
                <td className="num text-editorial">{(g.actual * 100).toFixed(1)}%</td>
                <td className="num">{g.holdings}</td>
              </tr>
            ))}
            <tr>
              <td className="font-serif italic">Cash, not yet invested</td>
              <td className="num text-ink-500">—</td>
              <td className="num">{(cash * 100).toFixed(1)}%</td>
              <td className="num text-ink-500">—</td>
            </tr>
          </tbody>
        </table>
      </section>

      <aside className="col-span-12 lg:col-span-5 lg:border-l lg:border-ink-100 lg:pl-10">
        <p className="eyebrow mb-2">Limits we stuck to</p>
        <p className="font-sans text-xs text-ink-700 mb-4 leading-snug">
          Rules the portfolio was built within, so no single bet can sink it.
        </p>
        <ul className="font-serif text-sm space-y-3 text-ink-700">
          <li>No single holding above <span className="font-mono">10%</span> of the portfolio.</li>
          <li>No single sector above <span className="font-mono">25%</span> of the portfolio.</li>
          <li>Spread across at least <span className="font-mono">4</span> different sectors.</li>
        </ul>
      </aside>

      <section className="col-span-12">
        <p className="eyebrow mb-4">What's in it</p>
        <table className="editorial-table">
          <thead>
            <tr>
              <th>Holding</th>
              <th>Ticker</th>
              <th>Group</th>
              <th>Sector</th>
              <th className="num">Share of portfolio</th>
            </tr>
          </thead>
          <tbody>
            {HOLDINGS.map((h) => (
              <tr key={h.name}>
                <td className="font-serif">{h.name}</td>
                <td className="font-mono text-xs">{h.ticker}</td>
                <td className="font-sans text-sm">{h.group}</td>
                <td className="font-sans text-sm text-ink-700">{h.sector}</td>
                <td className="num">{(h.weight * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
