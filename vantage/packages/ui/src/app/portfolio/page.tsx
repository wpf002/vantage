const SLEEVES = [
  { name: 'Core', target: 0.5, used: 0.46, holdings: 8 },
  { name: 'Growth / Asymmetry', target: 0.25, used: 0.22, holdings: 5 },
  { name: 'Defensive', target: 0.15, used: 0.15, holdings: 4 },
  { name: 'Tactical', target: 0.1, used: 0.08, holdings: 3 },
];

const ALLOCATIONS = [
  { name: 'Costco Wholesale', ticker: 'COST', sleeve: 'Core', sector: 'Consumer Staples', weight: 0.09 },
  { name: 'Berkshire Hathaway', ticker: 'BRK.B', sleeve: 'Core', sector: 'Financials', weight: 0.08 },
  { name: 'Microsoft', ticker: 'MSFT', sleeve: 'Core', sector: 'Technology', weight: 0.07 },
  { name: 'Stripe', ticker: '—', sleeve: 'Growth / Asymmetry', sector: 'Financials', weight: 0.06 },
  { name: 'Anthropic', ticker: '—', sleeve: 'Growth / Asymmetry', sector: 'Technology', weight: 0.05 },
  { name: 'Treasury Bills 1-3M', ticker: 'BIL', sleeve: 'Defensive', sector: 'Cash', weight: 0.1 },
];

export default function PortfolioPage() {
  const cash = 1 - SLEEVES.reduce((acc, s) => acc + s.used, 0);

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Portfolio · Constructed under hard constraints</p>
        <h1 className="font-display text-5xl tracking-editorial">Current book</h1>
      </header>

      <section className="col-span-12 lg:col-span-7">
        <p className="eyebrow mb-4">Sleeve breakdown</p>
        <table className="editorial-table">
          <thead>
            <tr>
              <th>Sleeve</th>
              <th className="num">Target</th>
              <th className="num">Used</th>
              <th className="num">Holdings</th>
            </tr>
          </thead>
          <tbody>
            {SLEEVES.map((s) => (
              <tr key={s.name}>
                <td className="font-serif">{s.name}</td>
                <td className="num">{(s.target * 100).toFixed(0)}%</td>
                <td className="num text-editorial">{(s.used * 100).toFixed(1)}%</td>
                <td className="num">{s.holdings}</td>
              </tr>
            ))}
            <tr>
              <td className="font-serif italic">Cash residual</td>
              <td className="num text-ink-500">—</td>
              <td className="num">{(cash * 100).toFixed(1)}%</td>
              <td className="num text-ink-500">—</td>
            </tr>
          </tbody>
        </table>
      </section>

      <aside className="col-span-12 lg:col-span-5 lg:border-l lg:border-ink-100 lg:pl-10">
        <p className="eyebrow mb-4">Constraints applied</p>
        <ul className="font-serif text-sm space-y-2 text-ink-700">
          <li>Max asset weight: <span className="font-mono">10%</span></li>
          <li>Max sector weight: <span className="font-mono">25%</span></li>
          <li>Minimum cross-sector count: <span className="font-mono">4</span></li>
        </ul>
      </aside>

      <section className="col-span-12">
        <p className="eyebrow mb-4">Allocations</p>
        <table className="editorial-table">
          <thead>
            <tr>
              <th>Holding</th>
              <th>Ticker</th>
              <th>Sleeve</th>
              <th>Sector</th>
              <th className="num">Weight</th>
            </tr>
          </thead>
          <tbody>
            {ALLOCATIONS.map((a) => (
              <tr key={a.name}>
                <td className="font-serif">{a.name}</td>
                <td className="font-mono text-xs">{a.ticker}</td>
                <td className="font-sans text-sm">{a.sleeve}</td>
                <td className="font-sans text-sm text-ink-700">{a.sector}</td>
                <td className="num">{(a.weight * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
