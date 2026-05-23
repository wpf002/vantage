import Link from 'next/link';
import type { Route } from 'next';
import { apiGet } from '@/lib/api';

/**
 * /board — the Daily Board. Yesterday's biggest score moves, fresh label
 * changes, and classification transitions, resolved post-close. Read-only by
 * design: the page load is the refresh.
 */

export const dynamic = 'force-dynamic';

interface Mover {
  ticker: string;
  name: string;
  sector: string | null;
  scoreDelta: number;
  currentScore: number;
  currentLabel: string;
  priorLabel: string;
}
interface LabelChange {
  ticker: string;
  name: string;
  sector: string | null;
  score: number;
  transitionedFromLabel: string;
}
interface ClassTransition {
  ticker: string;
  name: string;
  sector: string | null;
  fromClass: string;
  toClass: string;
  confidence: number;
}
interface BoardResponse {
  asOf: string;
  sections: {
    biggestMoversUp: Mover[];
    biggestMoversDown: Mover[];
    newNarrativeBreakdowns: LabelChange[];
    freshMarketUnderreactions: LabelChange[];
    classificationTransitions: ClassTransition[];
  };
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
const SECTOR_DISPLAY: Record<string, string> = {
  technology: 'Technology',
  healthcare: 'Healthcare',
  financials: 'Financials',
  communication_services: 'Communications',
  consumer_discretionary: 'Consumer Discretionary',
  consumer_staples: 'Consumer Staples',
  industrials: 'Industrials',
  energy: 'Energy',
  materials: 'Materials',
  utilities: 'Utilities',
  real_estate: 'Real Estate',
  other: 'Other',
};

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-03-14" → "MAR 14" (mono caps eyebrow date). */
function eyebrowDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${MON[Number(m[2]) - 1]} ${Number(m[3])}`;
}

const sectorOf = (s: string | null): string => (s ? SECTOR_DISPLAY[s] ?? s : '—');
const tickerLink = (t: string): Route => `/public/${t}` as Route;

async function fetchBoard(date?: string): Promise<BoardResponse | null> {
  try {
    return await apiGet<BoardResponse>(`/v1/board${date ? `?date=${date}` : ''}`);
  } catch {
    return null;
  }
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="font-serif italic text-ink-500">
        Nothing notable in this category today.
      </td>
    </tr>
  );
}

function CompanyCell({ ticker, name }: { ticker: string; name: string }) {
  return (
    <td className="font-serif text-ink-900 align-top">
      <Link href={tickerLink(ticker)} className="hover:underline decoration-editorial underline-offset-4">
        {name}
      </Link>
    </td>
  );
}

function MoversTable({ rows }: { rows: Mover[] }) {
  return (
    <table className="editorial-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Company</th>
          <th>Sector</th>
          <th className="num">Change</th>
          <th className="num">Score</th>
          <th>Label</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow cols={6} />
        ) : (
          rows.map((r) => {
            const big = Math.abs(r.scoreDelta) > 10;
            const sign = r.scoreDelta >= 0 ? '+' : '−';
            return (
              <tr key={r.ticker}>
                <td className="font-mono text-xs text-ink-700 align-top">{r.ticker}</td>
                <CompanyCell ticker={r.ticker} name={r.name} />
                <td className="font-sans text-xs uppercase tracking-wider text-ink-700 align-top">{sectorOf(r.sector)}</td>
                <td className={`num align-top ${big ? 'text-editorial' : ''}`}>{sign}{Math.abs(r.scoreDelta).toFixed(1)}</td>
                <td className="num align-top">{r.currentScore.toFixed(0)}</td>
                <td className="font-sans text-xs uppercase tracking-wider text-ink-700 align-top">{LABEL_DISPLAY[r.currentLabel] ?? r.currentLabel}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

function LabelTable({ rows }: { rows: LabelChange[] }) {
  return (
    <table className="editorial-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Company</th>
          <th>Sector</th>
          <th className="num">Score</th>
          <th>Previously</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow cols={5} />
        ) : (
          rows.map((r) => (
            <tr key={r.ticker}>
              <td className="font-mono text-xs text-ink-700 align-top">{r.ticker}</td>
              <CompanyCell ticker={r.ticker} name={r.name} />
              <td className="font-sans text-xs uppercase tracking-wider text-ink-700 align-top">{sectorOf(r.sector)}</td>
              <td className="num align-top text-editorial">{r.score.toFixed(0)}</td>
              <td className="font-sans text-xs uppercase tracking-wider text-ink-700 align-top">{LABEL_DISPLAY[r.transitionedFromLabel] ?? r.transitionedFromLabel}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function ClassTable({ rows }: { rows: ClassTransition[] }) {
  return (
    <table className="editorial-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Company</th>
          <th>Transition</th>
          <th className="num">Confidence</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow cols={4} />
        ) : (
          rows.map((r) => (
            <tr key={r.ticker}>
              <td className="font-mono text-xs text-ink-700 align-top">{r.ticker}</td>
              <CompanyCell ticker={r.ticker} name={r.name} />
              <td className="font-sans text-xs uppercase tracking-wider text-ink-700 align-top">
                {CLASS_DISPLAY[r.fromClass] ?? r.fromClass}
                <span className="font-mono text-editorial mx-1">→</span>
                {CLASS_DISPLAY[r.toClass] ?? r.toClass}
              </td>
              <td className="num align-top">{(r.confidence * 100).toFixed(0)}%</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <p className="eyebrow mb-5">{title}</p>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const data = await fetchBoard(date);
  const today = new Date().toISOString().slice(0, 10);

  if (!data) {
    return (
      <article className="grid grid-cols-12 gap-y-8">
        <header className="col-span-12 border-b border-ink-100 pb-8">
          <p className="eyebrow mb-3 font-mono">{eyebrowDate(date ?? today)}</p>
          <h1 className="font-display text-5xl xl:text-6xl tracking-editorial leading-tight mb-4">The Morning Read</h1>
        </header>
        <p className="col-span-12 font-serif italic text-ink-500 text-lg py-12">
          No board to show for this date. Scores accumulate as tickers are run — check back after the next close.
        </p>
      </article>
    );
  }

  const s = data.sections;

  return (
    <article className="grid grid-cols-12 gap-y-8">
      <header className="col-span-12 pb-8">
        <h1 className="font-display text-5xl xl:text-6xl tracking-editorial leading-tight mb-4">The Morning Read</h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
          Yesterday&apos;s biggest score moves, fresh label changes, and classification transitions. Updated after market close.
        </p>
      </header>

      <section className="col-span-12 space-y-10">
        <Section title="Biggest Score Moves: Up"><MoversTable rows={s.biggestMoversUp} /></Section>
        <Section title="Biggest Score Moves: Down"><MoversTable rows={s.biggestMoversDown} /></Section>
        <Section title="New Narrative Breakdowns"><LabelTable rows={s.newNarrativeBreakdowns} /></Section>
        <Section title="Fresh Market Underreactions"><LabelTable rows={s.freshMarketUnderreactions} /></Section>
        <Section title="Classification Transitions"><ClassTable rows={s.classificationTransitions} /></Section>
      </section>
    </article>
  );
}
