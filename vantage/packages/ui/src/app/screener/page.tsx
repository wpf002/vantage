import Link from 'next/link';
import type { Route } from 'next';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';

/**
 * /screener — browse every scored public ticker. Filter, sort, and page
 * through the universe. All state lives in the URL: the filter rail is a
 * native GET form, sort headers are links, and pagination walks a base64
 * cursor stack carried in `pc`. No client React state.
 */

export const dynamic = 'force-dynamic';

// ── Taxonomy (snake_case values match the DB; display forms are local) ────
// The eight Public Score labels — each is the verdict on the gap between a
// stock's price and its fundamentals. The `desc` surfaces as a hover tooltip
// so the names aren't opaque jargon.
const LABELS: Array<{ value: string; display: string; desc: string }> = [
  { value: 'aligned_strength', display: 'Aligned Strength', desc: 'Beat, the price confirmed it, and the narrative holds. Price and fundamentals agree, bullishly.' },
  { value: 'expected_weakness', display: 'Expected Weakness', desc: 'Missed, and the price already reflected it. Price and fundamentals agree, bearishly.' },
  { value: 'validated_story', display: 'Validated Story', desc: 'Recent results back the growth narrative. A modest, supported premium.' },
  { value: 'temporary_relief', display: 'Temporary Relief', desc: 'Price is holding up despite weak data. Support looks fragile.' },
  { value: 'cracks_forming', display: 'Cracks Forming', desc: 'The gap between price and fundamentals is widening. Directional risk building.' },
  { value: 'story_on_thin_ice', display: 'Story on Thin Ice', desc: 'Heat is elevated and the narrative is thin. Stretched on weak footing.' },
  { value: 'market_underreaction', display: 'Market Underreaction', desc: 'A real beat the price has not responded to yet. Possible upside.' },
  { value: 'narrative_breakdown', display: 'Narrative Breakdown', desc: 'Price runs well ahead of what the numbers justify. Richly valued on a failing story.' },
];

const SECTORS: Array<{ value: string; display: string }> = [
  { value: 'technology', display: 'Technology' },
  { value: 'healthcare', display: 'Healthcare' },
  { value: 'financials', display: 'Financials' },
  { value: 'communication_services', display: 'Communications' },
  { value: 'consumer_discretionary', display: 'Consumer Discretionary' },
  { value: 'consumer_staples', display: 'Consumer Staples' },
  { value: 'industrials', display: 'Industrials' },
  { value: 'energy', display: 'Energy' },
  { value: 'materials', display: 'Materials' },
  { value: 'utilities', display: 'Utilities' },
  { value: 'real_estate', display: 'Real Estate' },
  { value: 'other', display: 'Other' },
];

const CLASSES: Array<{ value: string; display: string }> = [
  { value: 'CORE', display: 'Core' },
  { value: 'HIGH_ASYMMETRY', display: 'High Asymmetry' },
  { value: 'TACTICAL', display: 'Tactical' },
  { value: 'AVOID', display: 'Avoid' },
];

const LABEL_DISPLAY = Object.fromEntries(LABELS.map((l) => [l.value, l.display]));
const SECTOR_DISPLAY = Object.fromEntries(SECTORS.map((s) => [s.value, s.display]));
const CLASS_DISPLAY = Object.fromEntries(CLASSES.map((c) => [c.value, c.display]));

const SORT_COLUMNS: Array<{ key: string; label: string; field: string }> = [
  { key: 'ticker', label: 'Ticker', field: 'name' }, // ticker has no own sort; piggyback name
  { key: 'name', label: 'Company', field: 'name' },
  { key: 'sector', label: 'Sector', field: 'sector' },
  { key: 'score', label: 'Score', field: 'score' },
  { key: 'confidence', label: 'Confidence', field: 'confidence' },
  { key: 'recency', label: 'Last Scored', field: 'recency' },
];

const LIMIT = 50;

interface ScreenerResult {
  ticker: string;
  name: string;
  sector: string;
  marketCap: number | null;
  score: number;
  label: string;
  direction: string;
  confidence: number;
  assetClass: string | null;
  classConfidence: number | null;
  lastScoredAt: string;
}
interface ScreenerResponse {
  results: ScreenerResult[];
  nextCursor: string | null;
  totalEstimate: number;
}

type SP = Record<string, string | string[] | undefined>;

const arr = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

function fmtMarketCap(usd: number | null): string {
  if (usd == null) return '—';
  return `$${(usd / 1e9).toFixed(usd >= 1e11 ? 0 : 1)}B`;
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  return formatDate(iso);
}

/** base64url JSON helpers for the Previous/Next cursor stack (`pc`). */
function decodeStack(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
function encodeStack(stack: string[]): string {
  return Buffer.from(JSON.stringify(stack), 'utf-8').toString('base64url');
}

/** Build a /screener href preserving every filter + sort param in `sp`,
 *  overriding pagination params (cursor + pc) explicitly. */
function buildHref(sp: SP, overrides: Record<string, string | string[] | null>): Route {
  const p = new URLSearchParams();
  const keep = [
    'label',
    'sector',
    'class',
    'scoreMin',
    'scoreMax',
    'confidenceMin',
    'marketCapMinB',
    'marketCapMaxB',
    'sortBy',
    'sortDir',
  ];
  for (const k of keep) for (const v of arr(sp[k])) p.append(k, v);
  for (const [k, v] of Object.entries(overrides)) {
    p.delete(k);
    if (v === null) continue;
    for (const item of Array.isArray(v) ? v : [v]) p.append(k, item);
  }
  const qs = p.toString();
  return (qs ? `/screener?${qs}` : '/screener') as Route;
}

async function fetchScreener(sp: SP): Promise<ScreenerResponse | null> {
  const p = new URLSearchParams();
  for (const v of arr(sp.label)) p.append('label', v);
  for (const v of arr(sp.sector)) p.append('sector', v);
  for (const v of arr(sp.class)) p.append('class', v);
  for (const k of ['scoreMin', 'scoreMax', 'confidenceMin']) {
    const v = one(sp[k]);
    if (v) p.set(k, v);
  }
  // UI market-cap inputs are in $B; the API expects millions.
  const minB = one(sp.marketCapMinB);
  const maxB = one(sp.marketCapMaxB);
  if (minB) p.set('marketCapMin', String(Number(minB) * 1000));
  if (maxB) p.set('marketCapMax', String(Number(maxB) * 1000));
  const sortBy = one(sp.sortBy);
  const sortDir = one(sp.sortDir);
  if (sortBy) p.set('sortBy', sortBy);
  if (sortDir) p.set('sortDir', sortDir);
  p.set('limit', String(LIMIT));
  const cursor = one(sp.cursor);
  if (cursor) p.set('cursor', cursor);
  try {
    return await apiGet<ScreenerResponse>(`/v1/screener?${p.toString()}`);
  } catch {
    return null;
  }
}

function FilterRail({ sp }: { sp: SP }) {
  const selSectors = new Set(arr(sp.sector));
  const selClasses = new Set(arr(sp.class));
  // Sort params ride along as hidden inputs so filtering preserves the sort.
  const sortBy = one(sp.sortBy);
  const sortDir = one(sp.sortDir);

  return (
    <form action="/screener" method="get" className="space-y-7 pl-2">
      {sortBy && <input type="hidden" name="sortBy" value={sortBy} />}
      {sortDir && <input type="hidden" name="sortDir" value={sortDir} />}

      <div>
        <p className="eyebrow mb-3">Score Band</p>
        <div className="flex gap-3">
          <label className="flex-1">
            <span className="block font-sans text-xs text-ink-500 mb-1">Min</span>
            <input type="number" name="scoreMin" min={0} max={100} defaultValue={one(sp.scoreMin) ?? ''} placeholder="0" className="num w-full bg-cream-50 border border-ink-100 px-2 py-1 text-sm" />
          </label>
          <label className="flex-1">
            <span className="block font-sans text-xs text-ink-500 mb-1">Max</span>
            <input type="number" name="scoreMax" min={0} max={100} defaultValue={one(sp.scoreMax) ?? ''} placeholder="100" className="num w-full bg-cream-50 border border-ink-100 px-2 py-1 text-sm" />
          </label>
        </div>
      </div>

      <div>
        <p className="eyebrow mb-3">Sector</p>
        <div className="space-y-1.5">
          {SECTORS.map((s) => (
            <label key={s.value} className="flex items-center gap-2 font-serif text-sm text-ink-800">
              <input type="checkbox" name="sector" value={s.value} defaultChecked={selSectors.has(s.value)} className="accent-editorial" />
              {s.display}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="eyebrow mb-3">Asset Class</p>
        <div className="space-y-1.5">
          {CLASSES.map((c) => (
            <label key={c.value} className="flex items-center gap-2 font-serif text-sm text-ink-800">
              <input type="checkbox" name="class" value={c.value} defaultChecked={selClasses.has(c.value)} className="accent-editorial" />
              {c.display}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="eyebrow mb-3">Confidence</p>
        <label>
          <span className="block font-sans text-xs text-ink-500 mb-1">Min (0–1)</span>
          <input type="number" name="confidenceMin" min={0} max={1} step={0.05} defaultValue={one(sp.confidenceMin) ?? ''} placeholder="0.0" className="num w-24 bg-cream-50 border border-ink-100 px-2 py-1 text-sm" />
        </label>
      </div>

      <div>
        <p className="eyebrow mb-3">Market Cap ($B)</p>
        <div className="flex gap-3">
          <label className="flex-1">
            <span className="block font-sans text-xs text-ink-500 mb-1">Min</span>
            <input type="number" name="marketCapMinB" min={0} step="any" defaultValue={one(sp.marketCapMinB) ?? ''} placeholder="0" className="num w-full bg-cream-50 border border-ink-100 px-2 py-1 text-sm" />
          </label>
          <label className="flex-1">
            <span className="block font-sans text-xs text-ink-500 mb-1">Max</span>
            <input type="number" name="marketCapMaxB" min={0} step="any" defaultValue={one(sp.marketCapMaxB) ?? ''} placeholder="∞" className="num w-full bg-cream-50 border border-ink-100 px-2 py-1 text-sm" />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-ink-100">
        <button type="submit" className="font-sans text-xs uppercase tracking-wider text-editorial hover:text-editorial-dark whitespace-nowrap">
          Apply Filters →
        </button>
        <span className="h-4 w-px bg-ink-300" aria-hidden />
        <Link href={'/screener' as Route} className="font-sans text-xs uppercase tracking-wider text-editorial hover:text-editorial-dark whitespace-nowrap">
          Clear All →
        </Link>
      </div>
    </form>
  );
}

export default async function ScreenerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const data = await fetchScreener(sp);
  const results = data?.results ?? [];
  const total = data?.totalEstimate ?? 0;

  const activeField = one(sp.sortBy) ?? 'score';
  const activeDir = one(sp.sortDir) ?? (activeField === 'name' || activeField === 'sector' ? 'asc' : 'desc');

  // Pagination stack — `pc` carries the cursors of pages already visited.
  const stack = decodeStack(one(sp.pc));
  const pageIndex = stack.length;
  const start = results.length === 0 ? 0 : pageIndex * LIMIT + 1;
  const end = pageIndex * LIMIT + results.length;

  const currentCursor = one(sp.cursor) ?? '';
  const prevHref = buildHref(sp, {
    cursor: stack.length > 0 ? stack[stack.length - 1]! || null : null,
    pc: stack.length > 0 ? encodeStack(stack.slice(0, -1)) : null,
  });
  const nextHref = data?.nextCursor
    ? buildHref(sp, { cursor: data.nextCursor, pc: encodeStack([...stack, currentCursor]) })
    : null;

  return (
    <article className="flex flex-col h-full">
      <header className="border-b border-ink-100 pb-8 mb-8">
        <h1 className="font-display text-5xl xl:text-6xl tracking-editorial leading-tight mb-4">
          Browse Every Read
        </h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
          Every public ticker Vantage has scored. Filter and sort to find what you&apos;re looking for.
        </p>
      </header>

      {/* Mobile filter toggle */}
      <div className="lg:hidden mb-8">
        <details className="border border-ink-100 bg-cream-50 px-4 py-3">
          <summary className="eyebrow cursor-pointer">Filters</summary>
          <div className="mt-5">
            <FilterRail sp={sp} />
          </div>
        </details>
      </div>

      <div className="grid grid-cols-12 gap-x-10 flex-1 min-h-0">
        {/* Desktop filter rail */}
        <aside className="hidden lg:block lg:col-span-3 lg:border-r lg:border-ink-100 lg:pr-8 self-start">
          <FilterRail sp={sp} />
        </aside>

        <section className="col-span-12 lg:col-span-9 min-w-0 flex flex-col min-h-0">
        {results.length === 0 ? (
          <p className="font-serif italic text-ink-500 text-lg py-12">
            No tickers match these filters. Loosen them up.
          </p>
        ) : (
          <>
            <div className="overflow-auto flex-1 min-h-0">
              <table className="editorial-table h-full [&_td]:align-middle">
                <thead>
                  <tr>
                    {SORT_COLUMNS.map((col) => {
                      const isActive = activeField === col.field && (col.key === 'name' ? activeField === 'name' : true);
                      // Toggle direction when re-clicking the active field.
                      const nextDir = activeField === col.field && activeDir === 'desc' ? 'asc' : activeField === col.field && activeDir === 'asc' ? 'desc' : col.field === 'name' || col.field === 'sector' ? 'asc' : 'desc';
                      const href = buildHref(sp, { sortBy: col.field, sortDir: nextDir, cursor: null, pc: null });
                      const marker = activeField === col.field ? (activeDir === 'desc' ? ' ↓' : ' ↑') : '';
                      const numCol = col.key === 'score' || col.key === 'confidence';
                      return (
                        <th key={col.key} className={`whitespace-nowrap${numCol ? ' num' : ''}`}>
                          <Link href={href} className={`whitespace-nowrap ${isActive && activeField === col.field ? 'text-editorial' : 'hover:text-editorial'}`}>
                            {col.label}
                            <span className="font-mono">{marker}</span>
                          </Link>
                        </th>
                      );
                    })}
                    <th className="num">Market Cap</th>
                    <th>Label</th>
                    <th>Class</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const isBreakdown = r.label === 'narrative_breakdown';
                    return (
                      <tr key={r.ticker}>
                        <td className="font-mono text-xs text-ink-700 align-top whitespace-nowrap sticky left-0 bg-cream">
                          {r.ticker}
                        </td>
                        <td className="font-serif text-ink-900 align-top">
                          <Link href={`/public/${r.ticker}` as Route} className="hover:underline decoration-editorial underline-offset-4">
                            {r.name}
                          </Link>
                        </td>
                        <td className="font-sans text-xs uppercase tracking-wider text-ink-700 align-top whitespace-nowrap">
                          {SECTOR_DISPLAY[r.sector] ?? r.sector}
                        </td>
                        <td className={`num align-top ${isBreakdown ? 'text-editorial' : ''}`}>{r.score.toFixed(0)}</td>
                        <td className="num align-top">{(r.confidence * 100).toFixed(0)}%</td>
                        <td className="font-mono text-xs text-ink-500 align-top whitespace-nowrap">{relativeAge(r.lastScoredAt)}</td>
                        <td className="num align-top">{fmtMarketCap(r.marketCap)}</td>
                        <td className="font-sans text-xs uppercase tracking-wider text-ink-700 align-top whitespace-nowrap">
                          {LABEL_DISPLAY[r.label] ?? r.label}
                        </td>
                        <td className="font-sans text-xs uppercase tracking-wider text-ink-700 align-top whitespace-nowrap">
                          {r.assetClass ? CLASS_DISPLAY[r.assetClass] ?? r.assetClass : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-4 mt-6 pt-4">
              {stack.length > 0 ? (
                <Link href={prevHref} className="font-sans text-xs uppercase tracking-wider text-editorial hover:text-editorial-dark">
                  ← Previous
                </Link>
              ) : (
                <span className="font-sans text-xs uppercase tracking-wider text-ink-300">← Previous</span>
              )}
              <span className="font-mono text-xs text-ink-500">
                Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
                {total >= 5000 ? '+' : ''}
              </span>
              {nextHref ? (
                <Link href={nextHref} className="font-sans text-xs uppercase tracking-wider text-editorial hover:text-editorial-dark">
                  Next →
                </Link>
              ) : (
                <span className="font-sans text-xs uppercase tracking-wider text-ink-300">Next →</span>
              )}
            </div>
          </>
        )}
        </section>
      </div>
    </article>
  );
}
