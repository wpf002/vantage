import Link from 'next/link';
import type { Route } from 'next';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';

/**
 * /meta — the meta-learning report card (Phase 8). Reads the graded decision
 * log and shows how Vantage's own calls held up against realized prices:
 * hit-rates per label and class, average forward returns, and the
 * score→return correlation. Pure read; outcomes are written by the daily
 * outcome-capture job.
 */

export const dynamic = 'force-dynamic';

interface Summary {
  key: string;
  count: number;
  hitRate: number;
  avgReturn: number;
}
interface RecentRow {
  entity: string;
  decisionType: string;
  outcomeAt: string;
  kind: string;
  horizonDays: number;
  forwardReturn: number;
  expected: string;
  correct: boolean;
  label?: string;
  score?: number;
  assetClass?: string;
}
interface MetaResponse {
  horizonDays: number;
  totals: { graded: number; pending: number; overallHitRate: number };
  scoreReturnCorrelation: number | null;
  byLabel: Summary[];
  byClass: Summary[];
  recent: RecentRow[];
}

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
const CLASS_DISPLAY: Record<string, string> = {
  CORE: 'Core',
  HIGH_ASYMMETRY: 'High Asymmetry',
  TACTICAL: 'Tactical',
  AVOID: 'Avoid',
};

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const signedPct = (n: number) => `${n >= 0 ? '+' : '−'}${(Math.abs(n) * 100).toFixed(1)}%`;

async function fetchMeta(): Promise<MetaResponse | null> {
  try {
    return await apiGet<MetaResponse>('/v1/meta');
  } catch {
    return null;
  }
}

function SummaryTable({ rows, head, display }: { rows: Summary[]; head: string; display: Record<string, string> }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <table className="editorial-table">
        <thead>
          <tr>
            <th>{head}</th>
            <th className="num">Graded</th>
            <th className="num">Hit Rate</th>
            <th className="num">Avg Return</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="font-sans text-xs uppercase tracking-wider text-ink-700">{display[r.key] ?? r.key}</td>
              <td className="num">{r.count}</td>
              <td className="num">{pct(r.hitRate)}</td>
              <td className={`num ${r.avgReturn >= 0 ? 'text-ink-900' : 'text-editorial'}`}>{signedPct(r.avgReturn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MetaPage() {
  const data = await fetchMeta();

  return (
    <article className="grid grid-cols-12 gap-x-10 gap-y-8">
      <header className="col-span-12 border-b border-ink-100 pb-8">
        <h1 className="font-display text-5xl xl:text-6xl tracking-editorial leading-tight mb-4">
          How the Calls Held Up
        </h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
          Every score and classification is graded against the realized price move over a{' '}
          {data?.horizonDays ?? 30}-day window. This is the report card on Vantage&apos;s own predictions.
        </p>
      </header>

      {!data || data.totals.graded === 0 ? (
        <section className="col-span-12">
          <p className="font-serif italic text-ink-500 text-lg py-8 max-w-measure leading-relaxed">
            No graded outcomes yet
            {data ? ` — ${data.totals.pending} decision${data.totals.pending === 1 ? '' : 's'} still maturing` : ''}.
            Outcomes are written once a decision is older than the {data?.horizonDays ?? 30}-day horizon, then
            calibration fills in here.
          </p>
        </section>
      ) : (
        <section className="col-span-12 space-y-12">
          {/* Totals */}
          <div className="flex flex-wrap gap-x-16 gap-y-6">
            <Stat label="Graded" value={String(data.totals.graded)} />
            <Stat label="Pending" value={String(data.totals.pending)} />
            <Stat label="Overall Hit Rate" value={pct(data.totals.overallHitRate)} />
            <Stat
              label="Score Return"
              value={data.scoreReturnCorrelation === null ? '—' : data.scoreReturnCorrelation.toFixed(2)}
            />
          </div>

          <SummaryTable rows={data.byLabel} head="Label" display={LABEL_DISPLAY} />
          <SummaryTable rows={data.byClass} head="Class" display={CLASS_DISPLAY} />

          {/* Recent graded */}
          <div>
            <p className="eyebrow mb-4">Recently Graded</p>
            <div className="overflow-x-auto">
              <table className="editorial-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Call</th>
                    <th>Expected</th>
                    <th className="num">Return</th>
                    <th>Result</th>
                    <th>Graded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={`${r.entity}-${i}`}>
                      <td className="font-mono text-xs text-ink-700">{r.entity}</td>
                      <td className="font-sans text-xs uppercase tracking-wider text-ink-700">
                        {r.label ? LABEL_DISPLAY[r.label] ?? r.label : r.assetClass ? CLASS_DISPLAY[r.assetClass] ?? r.assetClass : r.decisionType}
                      </td>
                      <td className="font-sans text-xs uppercase tracking-wider text-ink-500">{r.expected}</td>
                      <td className={`num ${r.forwardReturn >= 0 ? 'text-ink-900' : 'text-editorial'}`}>{signedPct(r.forwardReturn)}</td>
                      <td className={`font-sans text-xs uppercase tracking-wider ${r.correct ? 'text-ink-900' : 'text-editorial'}`}>
                        {r.correct ? 'Hit' : 'Miss'}
                      </td>
                      <td className="font-mono text-xs text-ink-500 whitespace-nowrap">{formatDate(r.outcomeAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <footer className="col-span-12 pt-4">
        <Link href={'/classifications' as Route} className="font-sans text-xs uppercase tracking-wider text-ink-500 hover:text-editorial">
          ← Classifications
        </Link>
      </footer>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      <p className="num text-3xl text-ink-900">{value}</p>
    </div>
  );
}
