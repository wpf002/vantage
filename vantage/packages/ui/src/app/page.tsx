import Link from 'next/link';
import type { Route } from 'next';
import { QUICK_PICKS } from '@/lib/companies';

export default function Home() {
  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      {/* Editorial lead — broadsheet hero */}
      <section className="col-span-12 lg:col-span-8 pb-10">
        <h1 className="font-display text-3xl md:text-4xl xl:text-5xl leading-[1.05] tracking-editorial mb-6 text-balance">
          Know what any company is worth — and why.
        </h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure mb-8">
          Search any public or private company for a valuation range, a verdict,
          and the reasoning behind both. Every number traced to source.
        </p>
        <SearchBar />
      </section>

      {/* Quick picks rail */}
      <aside className="col-span-12 lg:col-span-4 border-b border-ink-100 pb-10 lg:border-b-0 lg:border-l lg:border-ink-100 lg:pl-10 lg:pb-0">
        <p className="eyebrow mb-6">Recent Reads</p>
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
        <p className="eyebrow pb-4 mb-8 border-b border-ink-100">How It Works</p>
        <div className="flex flex-col divide-y divide-ink-100">
          <ExplainerColumn
            eyebrow="Public Companies"
            headline="Is the price ahead of the business?"
            body="Measures how far the stock has run versus what the fundamentals support, whether the growth story still holds, and how much hype is in the price. One score, one verdict."
          />
          <ExplainerColumn
            eyebrow="Private Companies"
            headline="Three ways to value it, blended."
            body="With no stock price to lean on, a cash-flow model, comparable peers, and buyout math each produce a value. The methods are weighted by what fits: fast-growing companies lean on comparables, steady earners on cash flow."
          />
          <ExplainerColumn
            eyebrow="Beyond a Single Company"
            headline="From one company to a whole portfolio."
            body="Any verdict rolls up into a portfolio: sorted into buckets, held to position limits, and stress-tested across thousands of scenarios before acting on it."
          />
        </div>
        <p className="font-serif text-base text-ink-700 mt-8 max-w-measure leading-relaxed">
          Every score rolls up into one of four asset classes — Core, High Asymmetry,
          Tactical, or Avoid — listed under{' '}
          <Link
            href={'/classifications' as Route}
            className="text-editorial underline-offset-4 hover:underline"
          >
            Classifications
          </Link>.
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
        className="flex-1 min-w-0 bg-transparent font-serif text-xl placeholder:text-ink-300 focus:outline-none"
      />
      <button type="submit" className="font-sans text-sm uppercase tracking-wider text-ink-900 hover:text-editorial">
        Look It Up →
      </button>
    </form>
  );
}

function ExplainerColumn({ eyebrow, headline, body }: { eyebrow: string; headline: string; body: string }) {
  return (
    <div className="py-8 first:pt-0 last:pb-0">
      <p className="eyebrow mb-3">{eyebrow}</p>
      <h3 className="font-display text-2xl mb-3 tracking-tight">{headline}</h3>
      <p className="font-serif text-ink-800 leading-relaxed">{body}</p>
    </div>
  );
}
