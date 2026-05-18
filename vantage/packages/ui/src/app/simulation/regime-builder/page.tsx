import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { auth } from '@/lib/auth';
import { apiServerGet, apiServerGetNullable } from '@/lib/api-server';
import type { PortfolioDetail, PortfolioListItem } from '@/lib/portfolios';
import { REGIME_PRESETS } from '@/lib/regime-presets';
import { RegimeForm, type PortfolioOption } from './RegimeForm';

export default async function RegimeBuilderPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/simulation/regime-builder' as Route);
  }

  const [systemPortfolio, mine] = await Promise.all([
    apiServerGetNullable<PortfolioDetail>('/v1/portfolios/system'),
    apiServerGet<PortfolioListItem[]>('/v1/portfolios/mine'),
  ]);

  const options: PortfolioOption[] = [];
  if (systemPortfolio) {
    options.push({ id: systemPortfolio.id, name: systemPortfolio.name, kind: 'system' });
  }
  for (const p of mine) {
    options.push({ id: p.id, name: p.name, kind: p.kind });
  }

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <h1 className="font-display text-5xl tracking-editorial mb-6">
          Regime Switching
        </h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure leading-snug">
          Markov transitions across historical market environments. Pick a template, tune the
          parameters.
        </p>
      </header>

      <div className="col-span-12">
        <RegimeForm portfolios={options} presets={REGIME_PRESETS} />
      </div>
    </div>
  );
}
