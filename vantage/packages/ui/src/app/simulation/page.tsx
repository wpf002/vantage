import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { auth } from '@/lib/auth';
import { apiServerGet, apiServerGetNullable, apiServerPost } from '@/lib/api-server';
import type { PortfolioDetail, PortfolioListItem } from '@/lib/portfolios';
import { formatPercent, sleeveLabel } from '@/lib/portfolios';

interface PageProps {
  searchParams: Promise<{ portfolio?: string; error?: string }>;
}

const SLEEVES: Array<'core' | 'growth' | 'defensive' | 'tactical'> = [
  'core',
  'growth',
  'defensive',
  'tactical',
];

export default async function SimulationPickerPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/simulation' as Route);
  }

  const { portfolio: prefilledPortfolio, error } = await searchParams;

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
        `/simulation?portfolio=${portfolioId}&error=${encodeURIComponent('Only Monte Carlo is available in this phase')}` as Route,
      );
    }
    const horizon = Math.max(1, Math.min(30, Number(formData.get('horizon') ?? 5)));
    const paths = Math.max(100, Math.min(100_000, Number(formData.get('paths') ?? 10_000)));
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
        <p className="font-serif text-deck text-ink-700 max-w-measure">
          Pick a portfolio. Pick a model. See how the next five years might play out.
        </p>
      </header>

      {error ? (
        <div className="col-span-12">
          <p className="font-serif italic text-editorial">{error}</p>
        </div>
      ) : null}

      {options.length === 0 ? (
        <section className="col-span-12">
          <p className="font-serif italic text-ink-700 max-w-measure">
            No portfolios available yet.{' '}
            <Link href={'/portfolios/new' as Route} className="text-editorial hover:underline">
              Build one
            </Link>{' '}
            and come back.
          </p>
        </section>
      ) : (
        <form action={runAction} className="col-span-12 space-y-12">
          {/* ── Pick a portfolio ─────────────────────────────────────── */}
          <section className="border-b border-ink-100 pb-10">
            <p className="eyebrow mb-4">Pick A Portfolio</p>
            <div className="space-y-4">
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
            <p className="eyebrow mb-4">Pick A Model</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <ModelCard
                value="monte_carlo"
                label="Monte Carlo"
                description="Ten thousand simulated paths."
                disabled={false}
                defaultChecked
              />
              <ModelCard
                value="scenario_tree"
                label="Scenario Tree"
                description="Discrete probability branching."
                disabled
              />
              <ModelCard
                value="regime_switching"
                label="Regime Switching"
                description="Markov-style transitions between market regimes."
                disabled
              />
            </div>
          </section>

          {/* ── Parameters ───────────────────────────────────────────── */}
          <section>
            <p className="eyebrow mb-4">Set Parameters</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6 max-w-3xl">
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
                    defaultValue={5}
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
                  defaultValue={10_000}
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
                  className="w-32 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-lg py-2 px-0 text-right placeholder:text-ink-300"
                />
                <p className="font-sans text-xs text-ink-700 mt-2">
                  Leave blank for random.
                </p>
              </div>
            </div>
          </section>

          <button
            type="submit"
            className="font-display text-2xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
          >
            Run It &rarr;
          </button>
        </form>
      )}
    </div>
  );
}

function ModelCard({
  value,
  label,
  description,
  disabled,
  defaultChecked,
}: {
  value: string;
  label: string;
  description: string;
  disabled?: boolean;
  defaultChecked?: boolean;
}) {
  if (disabled) {
    return (
      <div className="border border-ink-100 p-6 opacity-50 cursor-not-allowed">
        <p className="font-display text-xl tracking-tight">{label}</p>
        <p className="font-serif text-sm text-ink-700 mt-2">{description}</p>
        <p className="font-mono text-eyebrow uppercase tracking-wider text-ink-500 mt-4">
          Coming Soon
        </p>
      </div>
    );
  }
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
