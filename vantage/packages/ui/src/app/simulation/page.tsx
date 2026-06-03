import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { auth } from '@/lib/auth';
import { apiServerGet, apiServerGetNullable, apiServerPost } from '@/lib/api-server';
import type { PortfolioDetail, PortfolioListItem } from '@/lib/portfolios';
import { formatPercent, sleeveLabel } from '@/lib/portfolios';

interface PageProps {
  searchParams: Promise<{
    portfolio?: string;
    error?: string;
    kind?: string;
    horizon?: string;
    paths?: string;
    seed?: string;
    replay?: string;
  }>;
}

const SLEEVES: Array<'core' | 'growth' | 'defensive' | 'tactical'> = [
  'core',
  'growth',
  'defensive',
  'tactical',
];

const HORIZON_DEFAULT = 5;
const PATHS_DEFAULT = 10_000;

export default async function SimulationPickerPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/simulation' as Route);
  }

  const sp = await searchParams;
  const prefilledPortfolio = sp.portfolio;
  const error = sp.error;
  const replay = sp.replay === '1';
  const prefillKind = sp.kind === 'monte_carlo' ? 'monte_carlo' : 'monte_carlo';
  const prefillHorizon = clampInt(sp.horizon, 1, 30, HORIZON_DEFAULT);
  const prefillPaths = clampInt(sp.paths, 100, 100_000, PATHS_DEFAULT);
  const prefillSeed = sp.seed && sp.seed.trim() !== '' ? sp.seed : '';

  const [systemPortfolio, mine] = await Promise.all([
    apiServerGetNullable<PortfolioDetail>('/v1/portfolios/system'),
    apiServerGet<PortfolioListItem[]>('/v1/portfolios/mine'),
  ]);

  type PortfolioOption = {
    id: string;
    name: string;
    kind: 'system' | 'personal' | 'published';
    sleeveWeights: Record<string, number>;
    cashWeight: number;
  };

  const options: PortfolioOption[] = [];
  if (systemPortfolio) {
    options.push({
      id: systemPortfolio.id,
      name: systemPortfolio.name,
      kind: 'system',
      sleeveWeights: systemPortfolio.sleeveWeights,
      cashWeight: systemPortfolio.cashWeight,
    });
  }
  for (const p of mine) {
    options.push({
      id: p.id,
      name: p.name,
      kind: p.kind,
      sleeveWeights: p.sleeveWeights,
      cashWeight: p.cashWeight,
    });
  }

  const selectedId =
    prefilledPortfolio && options.some((o) => o.id === prefilledPortfolio)
      ? prefilledPortfolio
      : options[0]?.id ?? '';

  async function runAction(formData: FormData) {
    'use server';
    const portfolioId = String(formData.get('portfolioId') ?? '').trim();
    if (!portfolioId) {
      redirect('/simulation?error=Pick a portfolio first' as Route);
    }
    const kind = String(formData.get('kind') ?? 'monte_carlo').trim();
    if (kind !== 'monte_carlo') {
      redirect(
        `/simulation?portfolio=${portfolioId}&error=${encodeURIComponent('Only Monte Carlo runs through this picker')}` as Route,
      );
    }
    const horizon = clampInt(formData.get('horizon'), 1, 30, HORIZON_DEFAULT);
    const paths = clampInt(formData.get('paths'), 100, 100_000, PATHS_DEFAULT);
    const seedRaw = String(formData.get('seed') ?? '').trim();
    const seed = seedRaw === '' ? undefined : Number(seedRaw);

    try {
      const result = await apiServerPost<{ simulationId: string }>('/v1/simulation/run', {
        portfolioId,
        kind: 'monte_carlo',
        params: {
          horizonYears: horizon,
          paths,
          ...(seed !== undefined && Number.isFinite(seed) ? { seed } : {}),
        },
      });
      redirect(`/simulation/${result.simulationId}` as Route);
    } catch (err) {
      if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err;
      const msg = err instanceof Error ? err.message : 'unknown error';
      const match = msg.match(/"message":"([^"]+)"/);
      const reason = match ? match[1] : msg;
      redirect(
        `/simulation?portfolio=${portfolioId}&error=${encodeURIComponent(reason)}` as Route,
      );
    }
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <h1 className="font-display text-5xl xl:text-6xl tracking-editorial leading-tight mb-4">
          Thousands of Futures
        </h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
          Stress-test portfolio performance across market scenarios.
        </p>
      </header>

      {replay ? (
        <div className="col-span-12">
          <div className="bg-cream-200 border-l-2 border-editorial pl-6 py-5 max-w-3xl">
            <p className="eyebrow mb-2">Replay</p>
            <p className="font-serif text-base text-ink-800 leading-relaxed">
              Pre-filled from a previous run. Identical seed and inputs produce identical output.
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="col-span-12">
          <p className="font-serif italic text-editorial">{error}</p>
        </div>
      ) : null}

      {options.length === 0 ? (
        <section className="col-span-12">
          <p className="font-serif italic text-ink-700 max-w-measure">
            No portfolios yet —{' '}
            <Link href={'/portfolios/new' as Route} className="text-editorial hover:underline">
              build one
            </Link>{' '}
            first.
          </p>
        </section>
      ) : (
        <form action={runAction} className="col-span-12 space-y-12">
          {/* ── Pick a portfolio ─────────────────────────────────────── */}
          <section>
            <p className="eyebrow mb-4">Portfolio</p>
            <div className="divide-y divide-ink-100">
              {options.map((opt) => (
                <label
                  key={opt.id}
                  className="block cursor-pointer group"
                  htmlFor={`portfolio-${opt.id}`}
                >
                  <input
                    id={`portfolio-${opt.id}`}
                    type="radio"
                    name="portfolioId"
                    value={opt.id}
                    defaultChecked={opt.id === selectedId}
                    className="peer sr-only"
                  />
                  <div className="border-l-2 border-transparent peer-checked:border-editorial pl-6 py-3 transition-colors">
                    <div className="flex items-baseline justify-between gap-6">
                      <p className="font-display text-2xl tracking-tight text-ink-900 group-hover:text-editorial peer-checked:[&]:text-editorial">
                        {opt.name}
                      </p>
                      <p className="font-mono text-xs uppercase tracking-wider text-ink-500">
                        {opt.kind === 'system' ? 'Default' : 'Personal'}
                      </p>
                    </div>
                    <p className="font-mono text-xs text-ink-700 mt-2">
                      {SLEEVES.map((s) =>
                        `${sleeveLabel(s)} ${formatPercent(opt.sleeveWeights[s] ?? 0, 0)}`,
                      ).join('  ·  ')}
                      {'  ·  Cash '}
                      {formatPercent(opt.cashWeight, 0)}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* ── Pick a model ─────────────────────────────────────────── */}
          <section className="border-b border-ink-100 pb-10">
            <p className="eyebrow mb-4">Model</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <ModelCardRadio
                value="monte_carlo"
                label="Monte Carlo"
                description="10,000 stochastic paths."
                defaultChecked={prefillKind === 'monte_carlo'}
              />
              <ModelCardLink
                href="/simulation/scenario-builder"
                label="Scenario Tree"
                description="Discrete scenario branching."
                cta="Open Builder"
              />
              <ModelCardLink
                href="/simulation/regime-builder"
                label="Regime Switching"
                description="Markov transitions across market regimes."
                cta="Open Builder"
              />
            </div>
          </section>

          {/* ── Parameters ───────────────────────────────────────────── */}
          <section>
            <p className="eyebrow mb-6 text-center">Set Parameters</p>
            <div className="flex flex-col items-center sm:flex-row sm:items-start sm:justify-center gap-x-20 gap-y-6">
              <div>
                <label htmlFor="horizon" className="eyebrow block mb-2">
                  Horizon
                </label>
                <div className="flex items-baseline gap-2">
                  <input
                    id="horizon"
                    name="horizon"
                    type="number"
                    min={1}
                    max={30}
                    step={1}
                    defaultValue={prefillHorizon}
                    className="w-20 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-lg py-2 px-0 text-right"
                  />
                  <span className="font-mono text-sm text-ink-500">yrs</span>
                </div>
              </div>
              <div>
                <label htmlFor="paths" className="eyebrow block mb-2">
                  Paths
                </label>
                <input
                  id="paths"
                  name="paths"
                  type="number"
                  min={100}
                  max={100_000}
                  step={100}
                  defaultValue={prefillPaths}
                  className="w-32 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-lg py-2 px-0 text-right"
                />
              </div>
              <div>
                <label htmlFor="seed" className="eyebrow block mb-2">
                  Seed
                </label>
                <input
                  id="seed"
                  name="seed"
                  type="number"
                  placeholder="random"
                  defaultValue={prefillSeed}
                  className="w-32 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-lg py-2 px-0 text-right placeholder:text-ink-300"
                />
                <p className="font-sans text-xs text-ink-700 mt-2">Blank = random.</p>
              </div>
            </div>
          </section>

          <hr className="border-ink-100" />

          <button
            type="submit"
            className="-mt-6 font-display text-lg text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Run It &rarr;
          </button>
        </form>
      )}
    </div>
  );
}

function ModelCardRadio({
  value,
  label,
  description,
  defaultChecked,
}: {
  value: string;
  label: string;
  description: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="block cursor-pointer group" htmlFor={`kind-${value}`}>
      <input
        id={`kind-${value}`}
        type="radio"
        name="kind"
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <div className="border border-ink-100 peer-checked:border-editorial peer-checked:border-l-4 p-6 transition-colors h-full">
        <p className="font-display text-xl tracking-tight group-hover:text-editorial peer-checked:[&]:text-editorial">
          {label}
        </p>
        <p className="font-serif text-sm text-ink-700 mt-2">{description}</p>
      </div>
    </label>
  );
}

function ModelCardLink({
  href,
  label,
  description,
  cta,
}: {
  href: string;
  label: string;
  description: string;
  cta: string;
}) {
  return (
    <Link
      href={href as Route}
      className="block border border-ink-100 p-6 h-full hover:border-editorial transition-colors group"
    >
      <p className="font-display text-xl tracking-tight text-ink-900 group-hover:text-editorial">
        {label}
      </p>
      <p className="font-serif text-sm text-ink-700 mt-2">{description}</p>
      <p className="font-sans text-eyebrow uppercase tracking-wider text-editorial mt-4">
        {cta} &rarr;
      </p>
    </Link>
  );
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
