import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { auth } from '@/lib/auth';
import { apiServerPost } from '@/lib/api-server';

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function NewPortfolioPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/portfolios/new' as Route);
  }
  const { error } = await searchParams;

  async function buildAction(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (!name) redirect('/portfolios/new?error=Name is required' as Route);

    const core = Number(formData.get('core') ?? 50) / 100;
    const growth = Number(formData.get('growth') ?? 25) / 100;
    const defensive = Number(formData.get('defensive') ?? 15) / 100;
    const tactical = Number(formData.get('tactical') ?? 10) / 100;
    const sum = core + growth + defensive + tactical;
    if (sum > 1.001) {
      redirect(`/portfolios/new?error=${encodeURIComponent('Sleeve targets must sum to 100% or less')}` as Route);
    }

    const maxAssetWeight = Number(formData.get('maxAssetWeight') ?? 10) / 100;
    const maxSectorWeight = Number(formData.get('maxSectorWeight') ?? 25) / 100;

    try {
      const result = await apiServerPost<{ portfolioId: string }>('/v1/portfolios', {
        name,
        constraints: {
          maxAssetWeight,
          maxSectorWeight,
          sleeveTargets: { core, growth, defensive, tactical },
        },
      });
      redirect(`/portfolios/${result.portfolioId}` as Route);
    } catch (err) {
      // next/navigation's redirect throws internally to bail the render —
      // re-throw it untouched, otherwise we'd swallow the navigation.
      if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err;
      const msg = err instanceof Error ? err.message : 'unknown error';
      redirect(`/portfolios/new?error=${encodeURIComponent(msg)}` as Route);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">New Portfolio</p>
        <h1 className="font-display text-5xl tracking-editorial">Build a Portfolio</h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure mt-6">
          The engine picks holdings from current classifications, sized to your constraints. No
          manual overrides — just dial the targets and let it build.
        </p>
      </header>

      {error ? (
        <div className="col-span-12">
          <p className="font-serif italic text-editorial">{error}</p>
        </div>
      ) : null}

      <form action={buildAction} className="col-span-12 space-y-12">
        <div className="max-w-2xl">
          <label htmlFor="name" className="eyebrow block mb-3">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoFocus
            className="block w-full bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-serif text-2xl py-3 px-0"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-y-12">
          <div className="lg:pr-16">
            <p className="eyebrow mb-3">Sleeve Targets</p>
            <p className="font-sans text-xs text-ink-700 mb-4 leading-snug">
              What share of the book each sleeve aims for. Anything left over after they sum is
              held as cash.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <SleeveInput name="core" label="Core" defaultValue={50} />
              <SleeveInput name="growth" label="Growth" defaultValue={25} />
              <SleeveInput name="defensive" label="Defensive" defaultValue={15} />
              <SleeveInput name="tactical" label="Tactical" defaultValue={10} />
            </div>
          </div>

          <div className="lg:border-l lg:border-ink-100 lg:pl-16">
            <p className="eyebrow mb-3">Risk Caps</p>
            <p className="font-sans text-xs text-ink-700 mb-4 leading-snug">
              Hard limits the engine never breaches — the most any single position or sector can
              take.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <SleeveInput name="maxAssetWeight" label="Max Position" defaultValue={10} />
              <SleeveInput name="maxSectorWeight" label="Max Sector" defaultValue={25} />
            </div>
          </div>
        </div>

        <hr className="border-ink-100" />

        <button
          type="submit"
          className="font-display text-2xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
        >
          Build It &rarr;
        </button>
      </form>
    </div>
  );
}

function SleeveInput({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: number;
}) {
  return (
    <div>
      <label htmlFor={name} className="eyebrow block mb-2">
        {label}
      </label>
      <div className="flex items-baseline gap-2">
        <input
          id={name}
          name={name}
          type="number"
          min={0}
          max={100}
          step={1}
          defaultValue={defaultValue}
          className="w-20 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-lg py-2 px-0 text-right"
        />
        <span className="font-mono text-sm text-ink-500">%</span>
      </div>
    </div>
  );
}
