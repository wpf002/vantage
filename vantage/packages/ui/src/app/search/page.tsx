import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { QUICK_PICKS, quickPickHref } from '@/lib/companies';
import { apiGet } from '@/lib/api';
import { ScoreTickerButton } from './ScoreTickerButton';

/**
 * Universal search — server-renders results from GET /v1/search. Handles four
 * result kinds: an exact ticker hit redirects straight through; name matches
 * render as an editorial list; an FMP-resolved unknown ticker offers a live
 * run; nothing falls back to the covered-companies list.
 */

interface SearchMatch {
  type: 'public' | 'private';
  id: string;
  ticker: string | null;
  name: string;
}

type SearchResponse =
  | { kind: 'exact'; match: SearchMatch }
  | { kind: 'name_matches'; matches: SearchMatch[] }
  | {
      kind: 'public_unknown';
      suggestion: { ticker: string; name: string; exchange: string | null };
    }
  | { kind: 'no_match' };

const matchHref = (m: SearchMatch): string =>
  m.type === 'public' ? `/public/${m.id}` : `/private/${m.id}`;

async function runSearch(query: string): Promise<SearchResponse> {
  if (!query) return { kind: 'no_match' };
  try {
    return await apiGet<SearchResponse>(`/v1/search?q=${encodeURIComponent(query)}`);
  } catch {
    // API unreachable — degrade to the covered-companies fallback.
    return { kind: 'no_match' };
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (raw ?? '').trim();
  const result = await runSearch(query);

  // ── exact — go straight to the company ────────────────────────────────
  if (result.kind === 'exact') {
    redirect(matchHref(result.match) as Route);
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
          <h1 className="font-display text-5xl tracking-editorial">
            What would you like to look up?
          </h1>
        )}
      </header>

      {/* ── name_matches — editorial list of seeded companies ──────────── */}
      {result.kind === 'name_matches' && (
        <>
          <p className="eyebrow mb-6">Matches</p>
          <ul className="space-y-5">
            {result.matches.map((m) => (
              <li key={`${m.type}-${m.id}`}>
                <Link href={matchHref(m) as Route} className="group block">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-lg text-ink-900 group-hover:underline decoration-editorial underline-offset-4">
                      {m.name}
                    </span>
                    <span className="font-mono text-xs text-ink-500 uppercase">
                      {m.ticker ?? m.id}
                    </span>
                  </div>
                  <span className="font-display text-sm text-ink-700 capitalize">
                    {m.type} company
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── public_unknown — offer a live run for a real, unseeded ticker ─ */}
      {result.kind === 'public_unknown' && (
        <div className="border-l-2 border-editorial pl-6 space-y-5">
          <p className="eyebrow">Not covered yet</p>
          <h2 className="font-display text-4xl tracking-editorial leading-tight">
            {result.suggestion.name}
          </h2>
          <p className="font-mono text-sm text-ink-500">
            {result.suggestion.ticker}
            {result.suggestion.exchange ? ` · ${result.suggestion.exchange}` : ''}
          </p>
          <p className="font-serif text-deck text-ink-800 leading-relaxed">
            We haven&apos;t scored {result.suggestion.ticker} yet, but it&apos;s a real
            US-listed company. A live run pulls every input fresh from FMP and computes its
            Public Score in about fifteen seconds.
          </p>
          <ScoreTickerButton ticker={result.suggestion.ticker} />
        </div>
      )}

      {/* ── no_match — covered-companies fallback ──────────────────────── */}
      {result.kind === 'no_match' && (
        <>
          {query && (
            <p className="font-serif text-deck text-ink-700 mb-10">
              Nothing matched &ldquo;{query}&rdquo;. Vantage currently covers the companies
              below — try one of those, or search a US ticker symbol directly.
            </p>
          )}
          <p className="eyebrow mb-6">Companies you can look up</p>
          <ul className="space-y-5">
            {QUICK_PICKS.map((p) => (
              <li key={`${p.kind}-${p.id}`}>
                <Link href={quickPickHref(p) as Route} className="group block">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-lg text-ink-900 group-hover:underline decoration-editorial underline-offset-4">
                      {p.name}
                    </span>
                    <span className="font-mono text-xs text-ink-500 uppercase">{p.id}</span>
                  </div>
                  <span
                    className={`font-display text-sm ${
                      p.direction === 'bullish' ? 'text-editorial' : 'text-ink-700'
                    }`}
                  >
                    {p.read}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
