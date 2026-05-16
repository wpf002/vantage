import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { apiServerGetNullable } from '@/lib/api-server';
import { PercentileFanChart, type FanPoint } from '@/components/PercentileFanChart';
import { formatDate } from '@/lib/format';

interface MonteCarloOutputs {
  result: {
    expectedReturn: number;
    volatility: number;
    percentiles: { p05: number; p25: number; p50: number; p75: number; p95: number };
    probabilityOfLoss: number;
    pathsRun: number;
  };
  fan: FanPoint[];
}

interface AssumptionRow {
  entity: string;
  annualReturn: number;
  annualVol: number;
  source: 'historical' | 'peer_implied' | 'sector_default' | 'life_stage_default';
}

interface SimulationDetail {
  id: string;
  portfolioId: string | null;
  kind: 'monte_carlo' | 'scenario_tree' | 'regime_switching';
  inputs: {
    portfolioId?: string;
    horizonYears?: number;
    paths?: number;
    seed?: number;
    assumptions?: AssumptionRow[];
  };
  outputs: MonteCarloOutputs | unknown;
  seed: number | null;
  runAt: string;
  portfolio?: {
    id: string;
    name: string;
    kind: 'system' | 'personal' | 'published';
    slug: string | null;
    asOf: string;
  };
}

const KIND_LABELS: Record<string, string> = {
  monte_carlo: 'Monte Carlo',
  scenario_tree: 'Scenario Tree',
  regime_switching: 'Regime Switching',
};

const SOURCE_LABELS: Record<AssumptionRow['source'], string> = {
  historical: 'Historical',
  peer_implied: 'Peer Implied',
  sector_default: 'Sector Default',
  life_stage_default: 'Stage Default',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SimulationResultPage({ params }: PageProps) {
  const { id } = await params;
  const sim = await apiServerGetNullable<SimulationDetail>(`/v1/simulation/${id}`);
  if (!sim) notFound();
  if (sim.kind !== 'monte_carlo') {
    // Phase 6 only renders Monte Carlo. Scenario/regime show a stub note.
    return (
      <div className="grid grid-cols-12 gap-x-10 gap-y-10">
        <header className="col-span-12 border-b border-ink-100 pb-10">
          <p className="eyebrow mb-3">Result</p>
          <h1 className="font-display text-5xl tracking-editorial">
            {KIND_LABELS[sim.kind] ?? sim.kind}
          </h1>
        </header>
        <div className="col-span-12">
          <p className="font-serif italic text-ink-700 max-w-measure">
            Rendering for {KIND_LABELS[sim.kind] ?? sim.kind} is not yet wired into the UI.
          </p>
        </div>
      </div>
    );
  }

  const outputs = sim.outputs as MonteCarloOutputs;
  const r = outputs.result;
  const horizonYears = sim.inputs.horizonYears ?? outputs.fan.length - 1;
  const paths = sim.inputs.paths ?? r.pathsRun;
  const seedLabel = sim.seed !== null && sim.seed !== undefined ? String(sim.seed) : 'random';
  const portfolioName = sim.portfolio?.name ?? 'Unknown';
  const portfolioHref = sim.portfolio
    ? (sim.portfolio.kind === 'system'
        ? '/portfolios/system'
        : `/portfolios/${sim.portfolio.id}`)
    : null;
  const assumptions = sim.inputs.assumptions ?? [];

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Scenario Results</p>
        <h1 className="font-display text-5xl tracking-editorial">{portfolioName}</h1>
        <p className="font-mono text-eyebrow uppercase text-ink-900 tracking-wider mt-6">
          {KIND_LABELS[sim.kind]} · {horizonYears}-Year Horizon · Run On{' '}
          {formatDate(sim.runAt)} · {paths.toLocaleString()} Paths · Seed {seedLabel}
        </p>
      </header>

      {/* ── Chart ─────────────────────────────────────────────────────── */}
      <section className="col-span-12 lg:col-span-8">
        <p className="eyebrow mb-3">Range Of Outcomes</p>
        <p className="font-sans text-xs text-ink-700 mb-6 leading-snug max-w-measure">
          Bands cover the middle 90% of simulated paths. The red trace is the median —
          the typical case, not the average.
        </p>
        <PercentileFanChart fan={outputs.fan} />

        <div className="mt-10">
          <p className="eyebrow mb-3">What Might Happen</p>
          <table className="editorial-table max-w-2xl">
            <thead>
              <tr>
                <th>Outcome</th>
                <th className="num">Return</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-serif">Worst 5%</td>
                <td className="num">{formatPct(r.percentiles.p05)}</td>
              </tr>
              <tr>
                <td className="font-serif">Worst 25%</td>
                <td className="num">{formatPct(r.percentiles.p25)}</td>
              </tr>
              <tr>
                <td className="font-serif">Median</td>
                <td className="num text-editorial">{formatPct(r.percentiles.p50)}</td>
              </tr>
              <tr>
                <td className="font-serif">Best 25%</td>
                <td className="num">{formatPct(r.percentiles.p75)}</td>
              </tr>
              <tr>
                <td className="font-serif">Best 5%</td>
                <td className="num">{formatPct(r.percentiles.p95)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4 font-serif text-sm text-ink-700 max-w-measure leading-relaxed">
            Expected return{' '}
            <span className="font-mono text-editorial">{formatPct(r.expectedReturn)}</span>{' '}
            over {horizonYears} years. Loses money in about{' '}
            <span className="font-mono">{Math.round(r.probabilityOfLoss * 100)}</span> out of
            100 simulated futures.
          </p>
        </div>
      </section>

      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10 space-y-10">
        <div>
          <p className="eyebrow mb-3">Portfolio</p>
          {portfolioHref ? (
            <Link
              href={portfolioHref as Route}
              className="font-display text-xl tracking-tight text-editorial border-b border-editorial hover:text-editorial-dark hover:border-editorial-dark"
            >
              {portfolioName} &rarr;
            </Link>
          ) : (
            <p className="font-serif text-ink-700">{portfolioName}</p>
          )}
        </div>

        <div>
          <p className="eyebrow mb-3">Asset Assumptions</p>
          {assumptions.length === 0 ? (
            <p className="font-serif italic text-ink-700 text-sm">
              No per-asset assumptions recorded.
            </p>
          ) : (
            <table className="editorial-table text-sm">
              <thead>
                <tr>
                  <th>Holding</th>
                  <th className="num">μ</th>
                  <th className="num">σ</th>
                </tr>
              </thead>
              <tbody>
                {assumptions.map((a) => (
                  <tr key={a.entity}>
                    <td className="font-serif">
                      <span>{a.entity}</span>
                      <span className="block font-sans text-eyebrow uppercase tracking-wider text-ink-500 mt-1">
                        {SOURCE_LABELS[a.source]}
                      </span>
                    </td>
                    <td className="num">{(a.annualReturn * 100).toFixed(1)}%</td>
                    <td className="num">{(a.annualVol * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <Link
            href={
              (sim.portfolio
                ? `/simulation?portfolio=${sim.portfolio.id}`
                : '/simulation') as Route
            }
            className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Replay &rarr;
          </Link>
          {sim.seed !== null && sim.seed !== undefined ? (
            <p className="font-serif text-sm text-ink-700 mt-3">
              Seed:{' '}
              <span className="font-mono text-ink-900">{sim.seed}</span> — runs are
              deterministic.
            </p>
          ) : (
            <p className="font-serif text-sm text-ink-700 mt-3">
              Random — re-running will produce different results.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function formatPct(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(1)}%`;
}
