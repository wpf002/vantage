import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { QUICK_PICKS, quickPickHref, searchCompanies } from '@/lib/companies';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (raw ?? '').trim();
  const results = searchCompanies(query);

  // A single clear match — go straight to the company.
  if (results.length === 1) {
    redirect(quickPickHref(results[0]) as Route);
  }

  return (
    <div className="max-w-measure">
      <header className="border-b border-ink-100 pb-10 mb-10">
        <p className="eyebrow mb-3">Search</p>
        {query ? (
          <h1 className="font-display text-5xl tracking-editorial">
            Results for &ldquo;{query}&rdquo;
          </h1>
        ) : (
          <h1 className="font-display text-5xl tracking-editorial">What would you like to look up?</h1>
        )}
      </header>

      {query && results.length === 0 && (
        <p className="font-serif text-deck text-ink-700 mb-10">
          Nothing matched &ldquo;{query}&rdquo; yet. Vantage currently covers the companies below — try
          one of those.
        </p>
      )}

      <p className="eyebrow mb-6">{query && results.length > 0 ? 'Matches' : 'Companies you can look up'}</p>
      <ul className="space-y-5">
        {(query && results.length > 0 ? results : QUICK_PICKS).map((p) => (
          <li key={`${p.kind}-${p.id}`}>
            <Link href={quickPickHref(p) as Route} className="group block">
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
    </div>
  );
}
