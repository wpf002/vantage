import Link from 'next/link';
import type { Route } from 'next';
import { QUICK_PICKS } from '@/lib/companies';

export default function Home() {
  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      {/* Editorial lead — broadsheet hero */}
      <section className="col-span-12 lg:col-span-8 border-b border-ink-100 pb-10">
        <h1 className="font-display text-6xl leading-[1.05] tracking-editorial mb-6">
          Know what any company is<br />
          worth — and why.
        </h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure mb-8">
          Search any public or private company. Vantage returns a valuation range,
          a clear verdict, and the reasoning behind both — with every number traced
          back to where it came from.
        </p>
        <SearchBar />
      </section>

      {/* Quick picks rail */}
      <aside className="col-span-12 lg:col-span-4 border-b border-ink-100 pb-10 lg:border-b-0 lg:border-l lg:border-ink-100 lg:pl-10 lg:pb-0">
        <p className="eyebrow mb-6">Recent reads</p>
        <ul className="space-y-5">
          {QUICK_PICKS.map((p) => (
            <li key={`${p.kind}-${p.id}`}>
              <Link
                href={p.kind === 'public' ? `/public/${p.id}` : `/private/${p.id}`}
                className="group block"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-serif text-lg text-ink-900 group-hover:underline decoration-editorial underline-offset-4">
                    {p.name}
                  </span>
                  <span className="font-mono text-xs text-ink-500 uppercase">{p.id}</span>
                </div>
                <span
                  className={`font-display text-sm ${p.direction === 'bullish' ? 'text-editorial' : 'text-ink-700'}`}
                >
                  {p.read}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      {/* Below-fold: how it works */}
      <section className="col-span-12 pt-4">
        <p className="eyebrow pb-4 mb-8 border-b border-ink-100">How it works</p>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-ink-100">
          <ExplainerColumn
            eyebrow="Public companies"
            headline="Is the price ahead of the business?"
            body="For listed companies, we measure how far the stock has run versus what the fundamentals support, whether the growth story still holds, and how much hype is in the price. That rolls up into one score and a plain verdict."
          />
          <ExplainerColumn
            eyebrow="Private companies"
            headline="Three ways to value it, blended."
            body="With no stock price to lean on, we run a cash-flow model, compare against similar companies, and check the buyout math — then weight whichever methods actually fit. An early, fast-growing company leans on comparables; a steady earner leans on cash flow."
          />
          <ExplainerColumn
            eyebrow="Beyond a single company"
            headline="From one company to a whole portfolio."
            body="Any verdict can roll up into a portfolio — sorted into buckets, held to position limits, and stress-tested against thousands of scenarios before you act on it."
          />
        </div>
        <p className="font-serif text-base text-ink-700 mt-8 max-w-measure leading-relaxed">
          Every score rolls up into an asset class — Core, High Asymmetry, Tactical, or Avoid —
          listed on the{' '}
          <Link
            href={'/classifications' as Route}
            className="text-editorial underline-offset-4 hover:underline"
          >
            Classifications page
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function SearchBar() {
  return (
    <form action="/search" className="flex border-b-2 border-ink-900 pb-2">
      <input
        type="text"
        name="q"
        placeholder="Search a ticker or company name…"
        className="flex-1 bg-transparent font-serif text-xl placeholder:text-ink-300 focus:outline-none"
      />
      <button type="submit" className="font-sans text-sm uppercase tracking-wider text-ink-700 hover:text-editorial">
        Look it up →
      </button>
    </form>
  );
}

function ExplainerColumn({ eyebrow, headline, body }: { eyebrow: string; headline: string; body: string }) {
  return (
    <div className="py-8 first:pt-0 last:pb-0 md:py-0 md:px-8 md:first:pl-0 md:last:pr-0">
      <p className="eyebrow mb-3">{eyebrow}</p>
      <h3 className="font-display text-2xl mb-3 tracking-tight">{headline}</h3>
      <p className="font-serif text-ink-800 leading-relaxed">{body}</p>
    </div>
  );
}
