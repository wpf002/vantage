import Link from 'next/link';
import type { Route } from 'next';
import { SignalLabel } from '@/components/SignalLabel';
import { AuditChain } from '@/components/AuditChain';
import type { AuditStep, Direction } from '@/lib/companies';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { RunScoreButton } from './RunScoreButton';
import { FreshnessIndicator } from './FreshnessIndicator';

/**
 * Public company page — reads the latest live Public Score from the API.
 * When no score exists yet, renders an editorial empty state with a button
 * that triggers a fresh orchestrator run. Any real US-listed ticker works,
 * not just seeded ones.
 */

interface SegmentDatum {
  name: string;
  revenueSharePct: number;
  yoyGrowthPct: number;
  isNarrativeSegment: boolean;
}

interface Provenance {
  fetchedAt: string;
  earningsDate: string;
  epsSurprisePct: number;
  revenueSurprisePct: number;
  oneDayReturn: number;
  threeDayReturn: number;
  priceT0: number;
  priceT1: number;
  priceT3: number;
  segments: SegmentDatum[];
  narrativeSegmentHeuristic: string;
}

interface Components {
  egs: { score: number; direction: 'confirming' | 'disconfirming' | 'neutral' };
  nis: { score: number };
  nhs: { score: number };
}

interface PublicScoreMetadata {
  label?: string;
  labelDisplay?: string;
  labelDescription?: string;
  companyName?: string;
  sector?: string | null;
  industry?: string | null;
  score?: number;
  confidence?: number;
  components?: Components;
  provenance?: Provenance;
}

interface LatestPublicScoreResponse {
  signal: {
    id: string;
    entity: string;
    direction: Direction;
    confidence: number;
    rationale: string;
    timestamp: string;
    metadata: PublicScoreMetadata | null;
  };
  lineage: Array<{ step: number; op: string; weight: number | null; timestamp: string }>;
  label: string | null;
  score: number | null;
  components: Components | null;
}

const OP_LABELS: Record<string, string> = {
  'public.egs': 'Expectation Gap Analysis',
  'public.nis': 'Thesis Quality Check',
  'public.nhs': 'Speculative Premium Reading',
};

const FACTOR_MEANING = {
  egs: 'How far the latest results landed from what analysts expected — and whether the price agreed.',
  nis: 'Whether the growth story investors are paying for still holds up in the segment numbers.',
  nhs: 'How much speculative premium and momentum is priced in right now.',
} as const;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-04-29" → "April 29, 2026". */
function longDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

const pctAbs = (n: number): string => `${(Math.abs(n) * 100).toFixed(1)}%`;

function egsReading(score: number, direction: string): string {
  const moved =
    direction === 'confirming'
      ? 'the price moved with it'
      : direction === 'disconfirming'
        ? 'the price moved against it'
        : 'the price hardly reacted';
  if (score >= 66) return `Wide — results came in well off expectations, and ${moved}.`;
  if (score >= 33) return `Moderate — a real gap opened up between results and expectations; ${moved}.`;
  return `Tight — results landed close to expectations, and ${moved}.`;
}

function nisReading(score: number): string {
  if (score >= 66) return 'Intact — the segment carrying the story has both the size and the growth to back it.';
  if (score >= 33) return 'Mixed — the story is only partly borne out by the segment numbers.';
  return 'Thin — the segment behind the story is small or going sideways.';
}

function nhsReading(score: number): string {
  if (score >= 66) return 'Hot — analyst targets and the multiple are both stretched.';
  if (score >= 33) return 'Warm — some heat in targets and the multiple, but not extreme.';
  return 'Cool — little speculative premium in the price.';
}

/**
 * Deterministic analysis paragraph — branches on score thresholds and
 * numeric component readings. No LLM is involved; every sentence is a fixed
 * template selected by the engine outputs.
 */
function buildRead(
  _name: string,
  score: number,
  nis: Components['nis'],
  nhs: Components['nhs'],
  prov: Provenance | undefined,
): string {
  const headline =
    score <= 25
      ? 'Price and fundamentals are broadly aligned.'
      : score <= 45
        ? 'A modest gap separates price from fundamentals.'
        : score <= 65
          ? 'Price and fundamentals show a meaningful gap.'
          : 'Price runs well ahead of fundamentals.';

  let earnings = '';
  if (prov) {
    const epsDir = prov.epsSurprisePct >= 0 ? 'beat' : 'missed';
    const reaction =
      prov.oneDayReturn > 0.01
        ? `Shares added ${pctAbs(prov.oneDayReturn)} the following session.`
        : prov.oneDayReturn < -0.01
          ? `Shares fell ${pctAbs(prov.oneDayReturn)} the following session.`
          : 'Shares were broadly flat on the print.';
    earnings = ` Most recent quarter ${epsDir} consensus by ${pctAbs(prov.epsSurprisePct)}. ${reaction}`;
  }

  const narrative =
    nis.score >= 66
      ? 'Segment mix supports the growth narrative.'
      : nis.score >= 33
        ? 'Segment mix offers partial support for the growth narrative.'
        : 'Segment mix offers limited support for the growth narrative.';
  const heat =
    nhs.score >= 66
      ? 'Speculative premium is elevated; analyst targets and the multiple are stretched.'
      : nhs.score >= 33
        ? 'Speculative premium is present but contained.'
        : 'Speculative premium is muted.';

  return `${headline}${earnings} ${narrative} ${heat}`;
}

/** Source line for the data the run was built on. */
function provenanceFacts(name: string, prov: Provenance): Array<{ label: string; value: string }> {
  const epsDir = prov.epsSurprisePct >= 0 ? 'above' : 'below';
  const revDir = prov.revenueSurprisePct >= 0 ? 'above' : 'below';
  const move = (r: number): string => (r >= 0 ? `+${pctAbs(r)}` : `−${pctAbs(r)}`);
  return [
    { label: 'Source', value: `${name} earnings report` },
    { label: 'Reported', value: longDate(prov.earningsDate) },
    { label: 'EPS vs. Consensus', value: `${pctAbs(prov.epsSurprisePct)} ${epsDir}` },
    { label: 'Revenue vs. Consensus', value: `${pctAbs(prov.revenueSurprisePct)} ${revDir}` },
    { label: 'Price Reaction', value: `${move(prov.oneDayReturn)} (1d) · ${move(prov.threeDayReturn)} (3d)` },
  ];
}

async function fetchLatest(ticker: string): Promise<LatestPublicScoreResponse | null> {
  try {
    return await apiGet<LatestPublicScoreResponse>(`/v1/public/score-live/latest/${ticker}`);
  } catch {
    // 404 (no score yet) or API unreachable — both fall through to the empty
    // state, which lets the reader trigger a fresh run.
    return null;
  }
}

export default async function PublicTicker({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  const data = await fetchLatest(ticker);

  // ── Empty state — no score persisted yet ──────────────────────────────
  if (!data) {
    return (
      <article className="grid grid-cols-12 gap-x-10 gap-y-10">
        <header className="col-span-12 border-b border-ink-100 pb-10">
          <p className="eyebrow mb-3">{ticker} · Public company</p>
          <h1 className="font-display text-6xl tracking-editorial leading-tight mb-6">{ticker}</h1>
        </header>
        <section className="col-span-12 lg:col-span-8 space-y-6">
          <p className="eyebrow">No score yet</p>
          <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
            No score on file for {ticker}. A fresh run pulls the last eight quarters of earnings,
            the price reaction to each, the revenue mix by segment, analyst posture, and where
            the stock trades against its own history, then reads the gap between price and
            fundamentals. ~10 seconds.
          </p>
          <RunScoreButton ticker={ticker} />
        </section>
      </article>
    );
  }

  // ── Success state — render the persisted live score ───────────────────
  const meta = data.signal.metadata ?? {};
  const components = data.components ?? meta.components;
  const name = meta.companyName ?? ticker;
  const sector = meta.sector ?? null;
  const score = data.score ?? meta.score ?? 0;
  const confidence = data.signal.confidence ?? meta.confidence ?? 0;
  const labelDisplay = meta.labelDisplay ?? data.label ?? 'Public Score';
  const labelDescription = meta.labelDescription ?? '';
  const provenance = meta.provenance;

  const egs = components?.egs ?? { score: 0, direction: 'neutral' as const };
  const nis = components?.nis ?? { score: 0 };
  const nhs = components?.nhs ?? { score: 0 };

  const read = buildRead(name, score, nis, nhs, provenance);

  const factors = [
    {
      name: 'Expectation Gap',
      meaning: FACTOR_MEANING.egs,
      score: egs.score,
      reading: egsReading(egs.score, egs.direction),
    },
    {
      name: 'Thesis Quality',
      meaning: FACTOR_MEANING.nis,
      score: nis.score,
      reading: nisReading(nis.score),
    },
    {
      name: 'Speculative Premium',
      meaning: FACTOR_MEANING.nhs,
      score: nhs.score,
      reading: nhsReading(nhs.score),
    },
  ];

  const lineage: AuditStep[] = data.lineage.map((step) => ({
    step: step.step,
    label: OP_LABELS[step.op] ?? step.op,
    op: step.op,
    weight: step.weight,
    ts: step.timestamp,
  }));

  const segments = provenance?.segments ?? [];
  const narrativeSegment = segments.find((s) => s.isNarrativeSegment);

  return (
    <article className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">
          {ticker}
          {sector ? ` · ${sector}` : ''} · Public company
        </p>
        <h1 className="font-display text-6xl tracking-editorial leading-tight mb-6">{name}</h1>
        <p className="font-mono text-sm text-ink-500">As of {formatDate(data.signal.timestamp)}</p>
        <FreshnessIndicator ticker={ticker} asOf={data.signal.timestamp} />
      </header>

      <section className="col-span-12 lg:col-span-8 space-y-12 lg:border-r lg:border-ink-100 lg:pr-10">
        <SignalLabel
          label={labelDisplay}
          readPlain={labelDescription}
          score={score}
          direction={data.signal.direction}
          confidence={confidence}
        />

        <div>
          <p className="eyebrow mb-4">Analysis</p>
          <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">{read}</p>
        </div>

        <div>
          <p className="eyebrow mb-4">Score Drivers</p>
          <table className="editorial-table">
            <thead>
              <tr>
                <th>Factor</th>
                <th className="num">Score</th>
                <th>What it&apos;s telling us</th>
              </tr>
            </thead>
            <tbody>
              {factors.map((f) => (
                <tr key={f.name}>
                  <td>
                    <span className="font-serif text-ink-900">{f.name}</span>
                    <span className="block font-sans text-xs text-ink-700 mt-1 leading-snug max-w-[18rem]">
                      {f.meaning}
                    </span>
                  </td>
                  <td className="num align-top">{f.score.toFixed(0)}</td>
                  <td className="font-serif text-ink-700 align-top">{f.reading}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {provenance && (
          <div>
            <p className="eyebrow mb-4">Where This Comes From</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-4 mb-8 border-t border-ink-100 pt-5">
              {provenanceFacts(name, provenance).map((f) => (
                <div
                  key={f.label}
                  className={`flex items-baseline justify-between gap-4 border-b border-ink-100 pb-2 ${
                    f.label === 'Source' ? 'sm:col-span-2' : ''
                  }`}
                >
                  <dt className="font-sans text-xs uppercase tracking-wider text-ink-500">{f.label}</dt>
                  <dd className="font-serif text-ink-900 text-right whitespace-nowrap">{f.value}</dd>
                </div>
              ))}
            </dl>

            {segments.length > 0 && (
              <>
                <p className="eyebrow mb-3">Revenue Mix</p>
                <table className="editorial-table">
                  <thead>
                    <tr>
                      <th>Segment</th>
                      <th className="num">Share</th>
                      <th className="num">YoY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...segments]
                      .sort((a, b) => b.revenueSharePct - a.revenueSharePct)
                      .map((s) => (
                        <tr key={s.name}>
                          <td className="font-serif text-ink-900 align-top">
                            {s.name}
                            {s.isNarrativeSegment && (
                              <span className="block font-sans text-xs uppercase tracking-wider text-editorial mt-1">
                                Growth Driver
                              </span>
                            )}
                          </td>
                          <td className="num align-top">{s.revenueSharePct.toFixed(0)}%</td>
                          <td className="num align-top">
                            {s.yoyGrowthPct >= 0 ? '+' : ''}
                            {s.yoyGrowthPct.toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {narrativeSegment && (
                  <p className="font-sans text-xs text-ink-500 mt-3 leading-snug max-w-measure">
                    Thesis Quality is currently computed against {narrativeSegment.name}.
                    Segment selection is rule-based for now; a later release will hand it to a model.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <aside className="col-span-12 lg:col-span-4 space-y-8 lg:sticky lg:top-8 lg:self-start">
        <AuditChain steps={lineage} />
        <div>
          <Link
            href={`/audit/${data.signal.id}` as Route}
            className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Audit Chain &rarr;
          </Link>
          <p className="font-serif italic text-xs text-ink-500 mt-2">
            Every input and transform step behind this score.
          </p>
        </div>
        <hr className="border-ink-100" />
        <div>
          <Link
            href={`/public/${ticker}/history` as Route}
            className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            See Score History &rarr;
          </Link>
          <p className="font-serif italic text-xs text-ink-500 mt-2">
            The Public Score and its components over time, logged daily.
          </p>
        </div>
      </aside>
    </article>
  );
}
