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

interface ScenarioOutputs {
  expectedImpact: number;
  pathOutcomes: Array<{ path: string[]; probability: number; impact: number }>;
}

interface RegimeOutputs {
  expectedReturn: number;
  regimeOccupancy: Record<string, number>;
  pathsRun: number;
}

interface AssumptionRow {
  entity: string;
  annualReturn: number;
  annualVol: number;
  source: 'historical' | 'peer_implied' | 'sector_default' | 'life_stage_default';
}

interface RegimeInputs {
  regimes: string[];
  regimeReturns: Record<string, { mu: number; sigma: number }>;
  initialRegime: string;
  steps: number;
}

interface SimulationDetail {
  id: string;
  signalId: string | null;
  portfolioId: string | null;
  kind: 'monte_carlo' | 'scenario_tree' | 'regime_switching';
  inputs: {
    portfolioId?: string;
    horizonYears?: number;
    paths?: number;
    seed?: number;
    assumptions?: AssumptionRow[];
    regimes?: RegimeInputs;
  };
  outputs: MonteCarloOutputs | ScenarioOutputs | RegimeOutputs | unknown;
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

  const portfolioName = sim.portfolio?.name ?? 'Unknown';
  const portfolioHref = sim.portfolio
    ? sim.portfolio.kind === 'system'
      ? '/portfolios/system'
      : `/portfolios/${sim.portfolio.id}`
    : null;
  const assumptions = sim.inputs.assumptions ?? [];
  const auditHref = sim.signalId ? `/audit/${sim.signalId}` : null;

  if (sim.kind === 'monte_carlo') {
    return (
      <MonteCarloResult
        sim={sim}
        outputs={sim.outputs as MonteCarloOutputs}
        portfolioName={portfolioName}
        portfolioHref={portfolioHref}
        assumptions={assumptions}
        auditHref={auditHref}
      />
    );
  }

  if (sim.kind === 'scenario_tree') {
    return (
      <ScenarioTreeResult
        sim={sim}
        outputs={sim.outputs as ScenarioOutputs}
        portfolioName={portfolioName}
        portfolioHref={portfolioHref}
        assumptions={assumptions}
        auditHref={auditHref}
      />
    );
  }

  if (sim.kind === 'regime_switching') {
    return (
      <RegimeResult
        sim={sim}
        outputs={sim.outputs as RegimeOutputs}
        portfolioName={portfolioName}
        portfolioHref={portfolioHref}
        assumptions={assumptions}
        auditHref={auditHref}
      />
    );
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Result</p>
        <h1 className="font-display text-5xl tracking-editorial">{KIND_LABELS[sim.kind] ?? sim.kind}</h1>
      </header>
      <div className="col-span-12">
        <p className="font-serif italic text-ink-700 max-w-measure">
          Rendering for {KIND_LABELS[sim.kind] ?? sim.kind} is not yet wired into the UI.
        </p>
      </div>
    </div>
  );
}

// ─── Monte Carlo result ───────────────────────────────────────────────────

function MonteCarloResult({
  sim,
  outputs,
  portfolioName,
  portfolioHref,
  assumptions,
  auditHref,
}: {
  sim: SimulationDetail;
  outputs: MonteCarloOutputs;
  portfolioName: string;
  portfolioHref: string | null;
  assumptions: AssumptionRow[];
  auditHref: string | null;
}) {
  const r = outputs.result;
  const horizonYears = sim.inputs.horizonYears ?? outputs.fan.length - 1;
  const paths = sim.inputs.paths ?? r.pathsRun;
  const seedLabel =
    sim.seed !== null && sim.seed !== undefined ? String(sim.seed) : 'random';

  const replayHref = buildReplayHref(sim, { horizonYears, paths });

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

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10 space-y-10">
        <PortfolioBlock name={portfolioName} href={portfolioHref} />
        <AssumptionsBlock assumptions={assumptions} />
        <ReplayBlock sim={sim} replayHref={replayHref} />
        <AuditLinkback href={auditHref} />
      </aside>
    </div>
  );
}

// ─── Scenario tree result ─────────────────────────────────────────────────

function ScenarioTreeResult({
  sim,
  outputs,
  portfolioName,
  portfolioHref,
  assumptions,
  auditHref,
}: {
  sim: SimulationDetail;
  outputs: ScenarioOutputs;
  portfolioName: string;
  portfolioHref: string | null;
  assumptions: AssumptionRow[];
  auditHref: string | null;
}) {
  // Engine returns multiplicative impacts (1.0 == flat). UI shows %-change.
  const rows = [...outputs.pathOutcomes].sort((a, b) => b.probability - a.probability);
  const maxProb = rows.length > 0 ? rows[0]!.probability : 0;
  const expectedPct = outputs.expectedImpact - 1;

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Scenario Results</p>
        <h1 className="font-display text-5xl tracking-editorial">{portfolioName}</h1>
        <p className="font-mono text-eyebrow uppercase text-ink-900 tracking-wider mt-6">
          {KIND_LABELS[sim.kind]} · Run On {formatDate(sim.runAt)} · {rows.length} Leaf Paths
        </p>
      </header>

      <section className="col-span-12 lg:col-span-8">
        <p className="eyebrow mb-3">Paths</p>
        <p className="font-sans text-xs text-ink-700 mb-6 leading-snug max-w-measure">
          Every leaf of the tree, with its joint probability and the multiplicative impact
          on the portfolio if it plays out.
        </p>
        <table className="editorial-table">
          <thead>
            <tr>
              <th>Path</th>
              <th className="num">Probability</th>
              <th className="num">Impact</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const highlight = row.probability === maxProb;
              return (
                <tr key={i}>
                  <td className={highlight ? 'font-serif text-editorial' : 'font-serif'}>
                    {row.path.join(' → ')}
                  </td>
                  <td className={highlight ? 'num text-editorial' : 'num'}>
                    {(row.probability * 100).toFixed(1)}%
                  </td>
                  <td className={highlight ? 'num text-editorial' : 'num'}>
                    {formatPct(row.impact - 1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="mt-6 font-serif text-base text-ink-800 max-w-measure">
          Expected impact (probability-weighted):{' '}
          <span className="font-mono text-editorial">{formatPct(expectedPct)}</span>
        </p>
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10 space-y-10">
        <PortfolioBlock name={portfolioName} href={portfolioHref} />
        <AssumptionsBlock assumptions={assumptions} />
        <div>
          <Link
            href={'/simulation/scenario-builder' as Route}
            className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Build Another &rarr;
          </Link>
          <p className="font-serif italic text-sm text-ink-700 mt-3">
            Scenario trees are deterministic by structure — no seed needed.
          </p>
        </div>
        <AuditLinkback href={auditHref} />
      </aside>
    </div>
  );
}

// ─── Regime switching result ──────────────────────────────────────────────

function RegimeResult({
  sim,
  outputs,
  portfolioName,
  portfolioHref,
  assumptions,
  auditHref,
}: {
  sim: SimulationDetail;
  outputs: RegimeOutputs;
  portfolioName: string;
  portfolioHref: string | null;
  assumptions: AssumptionRow[];
  auditHref: string | null;
}) {
  const seedLabel =
    sim.seed !== null && sim.seed !== undefined ? String(sim.seed) : 'random';
  const regimes = sim.inputs.regimes;
  const steps = regimes?.steps ?? null;
  const occupancyRows = Object.entries(outputs.regimeOccupancy).sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">Scenario Results</p>
        <h1 className="font-display text-5xl tracking-editorial">{portfolioName}</h1>
        <p className="font-mono text-eyebrow uppercase text-ink-900 tracking-wider mt-6">
          {KIND_LABELS[sim.kind]}
          {steps !== null ? ` · ${steps} Monthly Steps` : ''} · Run On {formatDate(sim.runAt)} ·{' '}
          {outputs.pathsRun.toLocaleString()} Paths · Seed {seedLabel}
        </p>
      </header>

      <section className="col-span-12 lg:col-span-8 space-y-12">
        <div>
          <p className="eyebrow mb-3">Expected Return</p>
          <p className="font-serif text-sm text-ink-700 mb-4 max-w-measure leading-relaxed">
            Probability-weighted across every path the chain produced. Markov-style transitions
            mean each path stays in one regime until it switches, so the distribution depends on
            both regime parameters and the transition matrix.
          </p>
          <p className="font-display text-5xl text-editorial">{formatPct(outputs.expectedReturn)}</p>
        </div>

        <div>
          <p className="eyebrow mb-3">Regime Occupancy</p>
          <p className="font-sans text-xs text-ink-700 mb-6 leading-snug max-w-measure">
            Average share of months each path spent in each regime, plus the per-step
            parameters in force inside that regime.
          </p>
          <table className="editorial-table max-w-2xl">
            <thead>
              <tr>
                <th>Regime</th>
                <th className="num">Occupancy</th>
                <th className="num">μ</th>
                <th className="num">σ</th>
              </tr>
            </thead>
            <tbody>
              {occupancyRows.map(([name, occ]) => {
                const params = regimes?.regimeReturns?.[name];
                return (
                  <tr key={name}>
                    <td className="font-serif">{name}</td>
                    <td className="num">{(occ * 100).toFixed(0)}%</td>
                    <td className="num">{params ? formatMu(params.mu) : '—'}</td>
                    <td className="num">{params ? `${(params.sigma * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10 space-y-10">
        <PortfolioBlock name={portfolioName} href={portfolioHref} />
        <AssumptionsBlock assumptions={assumptions} />
        <div>
          <Link
            href={'/simulation/regime-builder' as Route}
            className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Run Another &rarr;
          </Link>
          {sim.seed !== null && sim.seed !== undefined ? (
            <p className="font-serif text-sm text-ink-700 mt-3">
              Seed: <span className="font-mono text-ink-900">{sim.seed}</span> — re-run with the
              same seed and template to reproduce.
            </p>
          ) : (
            <p className="font-serif italic text-sm text-ink-700 mt-3">
              Random — re-running will produce a different sample.
            </p>
          )}
        </div>
        <AuditLinkback href={auditHref} />
      </aside>
    </div>
  );
}

// ─── Shared sidebar blocks ────────────────────────────────────────────────

function PortfolioBlock({ name, href }: { name: string; href: string | null }) {
  return (
    <div>
      <p className="eyebrow mb-3">Portfolio</p>
      {href ? (
        <Link
          href={href as Route}
          className="font-display text-xl tracking-tight text-editorial border-b border-editorial hover:text-editorial-dark hover:border-editorial-dark"
        >
          {name} &rarr;
        </Link>
      ) : (
        <p className="font-serif text-ink-700">{name}</p>
      )}
    </div>
  );
}

function AssumptionsBlock({ assumptions }: { assumptions: AssumptionRow[] }) {
  return (
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
  );
}

function ReplayBlock({
  sim,
  replayHref,
}: {
  sim: SimulationDetail;
  replayHref: string | null;
}) {
  return (
    <div>
      <p className="eyebrow mb-3">Replay</p>
      {sim.seed !== null && sim.seed !== undefined && replayHref ? (
        <>
          <Link
            href={replayHref as Route}
            className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Replay This Run &rarr;
          </Link>
          <p className="font-serif text-sm text-ink-700 mt-3">
            Seed: <span className="font-mono text-ink-900">{sim.seed}</span>
          </p>
          <p className="font-serif italic text-xs text-ink-500 mt-2">
            Seeded runs are byte-for-byte reproducible.
          </p>
        </>
      ) : (
        <p className="font-serif italic text-sm text-ink-700">
          Random — re-running will produce different results.
        </p>
      )}
    </div>
  );
}

function AuditLinkback({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <div>
      <Link
        href={href as Route}
        className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
      >
        Audit &rarr;
      </Link>
      <p className="font-serif italic text-xs text-ink-500 mt-2">
        Every input and transform step behind this run.
      </p>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildReplayHref(
  sim: SimulationDetail,
  derived: { horizonYears: number; paths: number },
): string | null {
  if (sim.kind !== 'monte_carlo') return null;
  if (sim.seed === null || sim.seed === undefined) return null;
  if (!sim.portfolio) return null;
  const params = new URLSearchParams({
    portfolio: sim.portfolio.id,
    kind: sim.kind,
    horizon: String(derived.horizonYears),
    paths: String(derived.paths),
    seed: String(sim.seed),
    replay: '1',
  });
  return `/simulation?${params.toString()}`;
}

function formatPct(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function formatMu(mu: number): string {
  // Regime μ is a per-step rate; in the spec it's monthly. We render with a
  // sign so positive expansions and negative contractions read distinct.
  const sign = mu >= 0 ? '+' : '';
  return `${sign}${(mu * 100).toFixed(2)}%`;
}
