export default function SimulationPage() {
  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Scenarios</p>
        <h1 className="font-display text-5xl tracking-editorial">
          How could this portfolio play out?
        </h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure mt-6">
          We run the portfolio through thousands of possible futures and show the range of
          outcomes — the bad cases, the typical case, and the good cases — so you can see the
          risk before you act, not after.
        </p>
      </header>

      <section className="col-span-12 lg:col-span-8 space-y-12">
        <div>
          <p className="eyebrow mb-2">Where the portfolio could land in five years</p>
          <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
            We ran 10,000 simulated futures. Sorted from worst to best, here is the total return at
            five points along that range.
          </p>
          <table className="editorial-table">
            <thead>
              <tr>
                <th>Outcome</th>
                <th className="num">Total return over five years</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="font-serif">Worst cases (bottom 5%)</td><td className="num">-22.4%</td></tr>
              <tr><td className="font-serif">On the low side</td><td className="num">12.8%</td></tr>
              <tr><td className="font-serif">Most likely (middle)</td><td className="num text-editorial">38.2%</td></tr>
              <tr><td className="font-serif">On the high side</td><td className="num">68.4%</td></tr>
              <tr><td className="font-serif">Best cases (top 5%)</td><td className="num">142.7%</td></tr>
            </tbody>
          </table>
          <p className="mt-4 font-serif text-sm text-ink-700 max-w-measure leading-relaxed">
            On average the portfolio returns{' '}
            <span className="font-mono text-editorial">41.6%</span> over five years, and it loses
            money in about <span className="font-mono">8</span> futures out of 100. The gap between
            the worst and best cases is wide — this portfolio leans toward growth, not steadiness.
          </p>
        </div>
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10 space-y-8">
        <div>
          <p className="eyebrow mb-3">Other ways to test it</p>
          <ul className="space-y-2 font-serif">
            <li><a href="#" className="text-ink-900 hover:text-editorial">Branching Scenarios →</a></li>
            <li><a href="#" className="text-ink-900 hover:text-editorial">Good Times vs. Bad Times →</a></li>
          </ul>
        </div>
        <div>
          <p className="eyebrow mb-3">Repeatable</p>
          <p className="font-serif text-sm text-ink-700 leading-relaxed">
            Every run is reproducible — the same inputs always give the same result, so any
            outcome here can be checked later.
          </p>
        </div>
      </aside>
    </div>
  );
}
