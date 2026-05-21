import Link from 'next/link';
import type { Route } from 'next';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ScoreHistoryChart, type HistoryPoint } from './ScoreHistoryChart';

/**
 * /public/[ticker]/history — the Public Score and its three components over a
 * trailing window. Pure read against accumulated public_scores. Each chart
 * point links through to the underlying audit chain.
 */

export const dynamic = 'force-dynamic';

const RANGES: Array<{ key: string; label: string; days: number }> = [
  { key: '3M', label: '3M', days: 90 },
  { key: '6M', label: '6M', days: 180 },
  { key: '1Y', label: '1Y', days: 365 },
  { key: '2Y', label: '2Y', days: 730 },
  { key: '5Y', label: '5Y', days: 1825 },
];

const LABEL_DISPLAY: Record<string, string> = {
  aligned_strength: 'Aligned Strength',
  expected_weakness: 'Expected Weakness',
  validated_story: 'Validated Story',
  temporary_relief: 'Temporary Relief',
  cracks_forming: 'Cracks Forming',
  story_on_thin_ice: 'Story on Thin Ice',
  market_underreaction: 'Market Underreaction',
  narrative_breakdown: 'Narrative Breakdown',
};

interface HistoryResponse {
  ticker: string;
  name: string;
  series: HistoryPoint[];
}

async function fetchHistory(ticker: string, days: number): Promise<HistoryResponse | null> {
  try {
    return await apiGet<HistoryResponse>(`/v1/public/score-live/history/${ticker}?days=${days}`);
  } catch {
    return null;
  }
}

interface Transition {
  asOf: string;
  from: string;
  to: string;
  signalId: string | null;
}

/** Walk the series, emitting a row each time the label changes. */
function labelTransitions(series: HistoryPoint[]): Transition[] {
  const out: Transition[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!;
    const cur = series[i]!;
    if (cur.label !== prev.label) {
      out.push({ asOf: cur.asOf, from: prev.label, to: cur.label, signalId: cur.signalId });
    }
  }
  return out.reverse(); // most recent first
}

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  const { range: rawRange } = await searchParams;
  const range = RANGES.find((r) => r.key === rawRange) ?? RANGES.find((r) => r.key === '2Y')!;

  const data = await fetchHistory(ticker, range.days);
  const name = data?.name ?? ticker;
  const series = data?.series ?? [];
  const transitions = labelTransitions(series);

  const rangeHref = (key: string): Route => `/public/${ticker}/history?range=${key}` as Route;

  return (
    <article className="grid grid-cols-12 gap-x-10 gap-y-8">
      <header className="col-span-12 border-b border-ink-100 pb-8">
        <p className="eyebrow mb-3 font-mono">{ticker}</p>
        <h1 className="font-display text-4xl xl:text-5xl tracking-editorial leading-tight mb-4">
          {name} — Score History
        </h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
          Public Score and its three components over the trailing 24 months. Click any point to see the underlying audit chain.
        </p>
      </header>

      {series.length === 0 ? (
        <section className="col-span-12">
          <p className="font-serif italic text-ink-500 text-lg py-12">
            No score history yet for {name}. The first read is on the{' '}
            <Link href={`/public/${ticker}` as Route} className="text-editorial underline-offset-4 hover:underline">
              tear sheet
            </Link>
            .
          </p>
        </section>
      ) : (
        <section className="col-span-12 space-y-10">
          {/* Range selector */}
          <div className="flex gap-6">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={rangeHref(r.key)}
                className={
                  'font-sans text-xs uppercase tracking-wider ' +
                  (r.key === range.key
                    ? 'text-editorial border-b-2 border-editorial pb-1 -mb-[2px]'
                    : 'text-ink-700 hover:text-editorial')
                }
              >
                {r.label}
              </Link>
            ))}
          </div>

          <ScoreHistoryChart data={series} />

          {/* Label transitions over the visible range */}
          <div>
            <p className="eyebrow mb-4">Label Transitions</p>
            {transitions.length === 0 ? (
              <p className="font-serif italic text-ink-500">No label changes over this range.</p>
            ) : (
              <table className="editorial-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Transition</th>
                  </tr>
                </thead>
                <tbody>
                  {transitions.map((t) => {
                    const cell = (
                      <span className="font-sans text-xs uppercase tracking-wider text-ink-700">
                        {LABEL_DISPLAY[t.from] ?? t.from}
                        <span className="font-mono text-editorial mx-1">→</span>
                        {LABEL_DISPLAY[t.to] ?? t.to}
                      </span>
                    );
                    return (
                      <tr key={`${t.asOf}-${t.to}`}>
                        <td className="font-mono text-xs text-ink-500 align-top whitespace-nowrap">
                          {formatDate(t.asOf)}
                        </td>
                        <td className="align-top">
                          {t.signalId ? (
                            <Link href={`/audit/${t.signalId}` as Route} className="hover:underline decoration-editorial underline-offset-4">
                              {cell}
                            </Link>
                          ) : (
                            cell
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="pt-4 border-t border-ink-100">
            <Link
              href={`/public/${ticker}` as Route}
              className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
            >
              Back to {name} →
            </Link>
          </div>
        </section>
      )}
    </article>
  );
}
