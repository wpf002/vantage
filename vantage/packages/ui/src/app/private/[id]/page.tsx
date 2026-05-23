import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { SignalLabel } from '@/components/SignalLabel';
import { ValuationBand } from '@/components/ValuationBand';
import { AuditChain } from '@/components/AuditChain';
import { getPrivateCompany } from '@/lib/companies';
import type { AuditStep, Direction, MethodWeight } from '@/lib/companies';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { RunValuationButton } from './RunValuationButton';

/**
 * Private company page — reads the latest live valuation from the API.
 * When no valuation exists yet, renders an editorial empty state with a
 * button that triggers a fresh orchestrator run.
 */

interface ValuationMetadata {
  companyName?: string;
  lifeStage?: string;
  finalValuation?: { bear: number; base: number; bull: number };
  weights?: { dcf: number; comps: number; lbo: number };
  methodResults?: Array<{
    method: 'dcf' | 'comps' | 'lbo';
    enterpriseValue: number;
    confidence: number;
    rationale: string;
    warnings: string[];
  }>;
  revenueIntel?: {
    revenueLtmUsd: number | null;
    revenueConfidence: string;
    revenueAsOfMonth: string | null;
    revenueSource: string | null;
    growthCommentary: string | null;
  };
  confidence?: number;
}

interface LatestValuationResponse {
  signal: {
    id: string;
    entity: string;
    direction: Direction;
    confidence: number;
    rationale: string;
    timestamp: string;
    metadata: ValuationMetadata | null;
  };
  lineage: Array<{ step: number; op: string; weight: number | null; timestamp: string }>;
  metadata: ValuationMetadata | null;
}

const OP_LABELS: Record<string, string> = {
  'private.dcf': 'Discounted Cash Flow',
  'private.comps': 'Comparable Companies',
  'private.lbo': 'Buyout (LBO) Model',
  'private.ml_adjustment': 'Machine-Learning Adjustment',
  'private.blended_valuation': 'Blended Valuation',
};

const METHOD_LABELS: Record<'dcf' | 'comps' | 'lbo', string> = {
  dcf: 'Discounted Cash Flow',
  comps: 'Comparable Companies',
  lbo: 'Buyout (LBO) Model',
};

const fmtUsd = (n: number): string => {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString()}`;
};

async function fetchLatest(id: string): Promise<LatestValuationResponse | null> {
  try {
    return await apiGet<LatestValuationResponse>(`/v1/private/value-live/latest/${id}`);
  } catch {
    // 404 (no valuation yet) or API unreachable — both fall through to the
    // empty state, which lets the reader trigger a fresh run.
    return null;
  }
}

export default async function PrivateCompany({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fallback = getPrivateCompany(id);
  const data = await fetchLatest(id);

  // Reachable two ways: a static demo slug (e.g. /private/anthropic) or a
  // platform_companies UUID (e.g. from an audit linkback). With no static
  // fallback AND no API data, there's nothing to render — 404.
  if (!fallback && !data) notFound();

  // ── Empty state — no valuation persisted yet ──────────────────────────
  if (!data) {
    // `data` is null here; the !fallback case above already returned, so
    // fallback is guaranteed non-null at this point.
    const f = fallback!;
    return (
      <article className="grid grid-cols-12 gap-x-10 gap-y-10">
        <header className="col-span-12 border-b border-ink-100 pb-10">
          <p className="eyebrow mb-3">
            {f.lifeStage} · {f.sector} · Private company
          </p>
          <h1 className="font-display text-6xl tracking-editorial leading-tight mb-6">
            {f.name}
          </h1>
        </header>
        <section className="col-span-12 lg:col-span-8 space-y-6">
          <p className="eyebrow">No valuation yet</p>
          <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
            No valuation on file for {f.name}. A fresh run pulls current peer financials, macro
            rates, engineering velocity, patent and funding activity, and a revenue base from
            company research, then values the company three ways and blends them.
          </p>
          <RunValuationButton companyId={id} />
        </section>
      </article>
    );
  }

  // ── Success state — render the persisted live valuation ───────────────
  const meta = data.metadata ?? data.signal.metadata ?? {};
  const name = meta.companyName ?? fallback?.name ?? 'Private Company';
  const lifeStage = meta.lifeStage ?? fallback?.lifeStage ?? 'Private Company';
  const sector = fallback?.sector ?? 'Private';
  const confidence = meta.confidence ?? data.signal.confidence;
  const valuation = meta.finalValuation ?? { bear: 0, base: 0, bull: 0 };
  const weights = meta.weights ?? { dcf: 0, comps: 0, lbo: 0 };
  const revenueIntel = meta.revenueIntel;

  const resultByMethod = new Map((meta.methodResults ?? []).map((r) => [r.method, r]));
  const methods: MethodWeight[] = (['dcf', 'comps', 'lbo'] as const).map((m) => {
    const weight = weights[m] ?? 0;
    const result = resultByMethod.get(m);
    const why =
      weight === 0
        ? result
          ? 'Set aside — confidence below the floor for the blend.'
          : 'Not run — inputs unavailable for this method.'
        : (result?.rationale ?? 'Contributed to the blended valuation.');
    return { method: METHOD_LABELS[m], weight, why };
  });

  const lineage: AuditStep[] = data.lineage.map((step) => ({
    step: step.step,
    label: OP_LABELS[step.op] ?? step.op,
    op: step.op,
    weight: step.weight,
    ts: step.timestamp,
  }));

  const spread = valuation.bear > 0 ? valuation.bull / valuation.bear : 1;
  const read = spread > 3 ? 'Wide Range' : spread > 1.8 ? 'Moderate Range' : 'Tight Range';

  const readPlain =
    `Blended valuation ${fmtUsd(valuation.base)}. Bear ${fmtUsd(valuation.bear)}, ` +
    `bull ${fmtUsd(valuation.bull)}.`;

  const rationale =
    'Blends discounted cash flow, public comparables, and a leveraged-buyout case, weighted by life stage. ' +
    (revenueIntel?.revenueSource
      ? `Revenue base sourced from ${revenueIntel.revenueSource} (${revenueIntel.revenueConfidence} confidence).`
      : 'Revenue base drawn from live company research.');

  return (
    <article className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">
          {lifeStage} · {sector} · Private company
        </p>
        <h1 className="font-display text-6xl tracking-editorial leading-tight mb-6">{name}</h1>
        <p className="font-mono text-sm text-ink-500">As of {formatDate(data.signal.timestamp)}</p>
      </header>

      <section className="col-span-12 lg:col-span-8 space-y-12">
        <SignalLabel
          label={read}
          readPlain={readPlain}
          direction={data.signal.direction}
          confidence={confidence}
        />

        <ValuationBand bear={valuation.bear} base={valuation.base} bull={valuation.bull} />

        {revenueIntel && (
          <div>
            <p className="eyebrow mb-2">Revenue base</p>
            <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
              Private companies don&apos;t report publicly — this is the revenue figure the
              valuation is anchored to, pulled from live company research.
            </p>
            <div className="font-mono text-sm text-ink-900">
              <p>
                {revenueIntel.revenueLtmUsd === null
                  ? 'n/a'
                  : `${fmtUsd(revenueIntel.revenueLtmUsd)} LTM`}
              </p>
            </div>
            <hr className="mt-8 border-ink-100" />
          </div>
        )}

        <div>
          <p className="eyebrow mb-2">Valuation Methodology</p>
          <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
            Three methods, weighted by life stage and per-method confidence.
          </p>
          <table className="editorial-table">
            <thead>
              <tr>
                <th>Method</th>
                <th className="num">Weight</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.method}>
                  <td className="font-serif align-top">{m.method}</td>
                  <td className="num align-top">{(m.weight * 100).toFixed(0)}%</td>
                  <td
                    className={
                      m.weight === 0
                        ? 'font-serif text-ink-500 italic align-top'
                        : 'font-serif text-ink-700 align-top'
                    }
                  >
                    {m.why}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <p className="eyebrow mb-4">Analysis</p>
          <p className="font-serif text-base text-ink-800 max-w-measure leading-relaxed">
            {rationale}
          </p>
        </div>
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10 space-y-8 self-start lg:sticky lg:top-12">
        <AuditChain steps={lineage} />
        <hr className="border-ink-100" />
        <div>
          <Link
            href={`/audit/${data.signal.id}` as Route}
            className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Audit Chain &rarr;
          </Link>
          <p className="font-serif italic text-xs text-ink-500 mt-2">
            Every input and transform step behind this valuation.
          </p>
        </div>
      </aside>
    </article>
  );
}
