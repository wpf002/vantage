import Link from 'next/link';
import type { Route } from 'next';
import { auth } from '@/lib/auth';
import { apiServerGet, apiServerGetNullable } from '@/lib/api-server';
import type { PortfolioDetail, PortfolioListItem } from '@/lib/portfolios';
import { formatPercent, sleeveLabel } from '@/lib/portfolios';
import { formatDate } from '@/lib/format';

const SLEEVES: Array<'core' | 'growth' | 'defensive' | 'tactical'> = [
  'core',
  'growth',
  'defensive',
  'tactical',
];

export default async function PortfoliosIndex() {
  const session = await auth();
  const signedIn = !!session?.user?.id;

  const system = await apiServerGetNullable<PortfolioDetail>('/v1/portfolios/system');
  const mine = signedIn ? await apiServerGet<PortfolioListItem[]>('/v1/portfolios/mine') : [];

  return (
    <div className="grid grid-cols-12 gap-x-10 gap-y-12">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="font-serif text-deck text-ink-700 max-w-measure">
          Default — rebuilt nightly from current classifications. Your own — sized to your
          constraints.
        </p>
      </header>

      <section className="col-span-12">
        <div className="flex items-baseline justify-between mb-4">
          <p className="eyebrow">Default</p>
          <Link
            href={'/portfolios/system' as Route}
            className="font-sans text-sm text-editorial hover:underline"
          >
            Open &rarr;
          </Link>
        </div>
        {system ? (
          <table className="editorial-table max-w-2xl">
            <thead>
              <tr>
                <th>Group</th>
                <th className="num">Aimed For</th>
                <th className="num">Held</th>
              </tr>
            </thead>
            <tbody>
              {SLEEVES.map((s) => (
                <tr key={s}>
                  <td className="font-serif">{sleeveLabel(s)}</td>
                  <td className="num">
                    {formatPercent(system.constraints.sleeveTargets[s], 0)}
                  </td>
                  <td className="num text-editorial">
                    {formatPercent(system.sleeveWeights[s] ?? 0)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="font-serif italic">Cash, Not Yet Invested</td>
                <td className="num text-ink-500">—</td>
                <td className="num">{formatPercent(system.cashWeight)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="font-serif italic text-ink-700">
            Not built yet. The nightly worker rebuilds it from current classifications.
          </p>
        )}
      </section>

      <section className="col-span-12">
        <div className="flex items-baseline justify-between mb-4">
          <p className="eyebrow">Your Portfolio</p>
          {signedIn ? (
            <Link
              href={'/portfolios/new' as Route}
              className="font-display text-base text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
            >
              Build a New Portfolio &rarr;
            </Link>
          ) : null}
        </div>

        {!signedIn ? (
          <p className="font-serif italic text-ink-700 max-w-measure">
            <Link href={'/signin?callbackUrl=/portfolios' as Route} className="text-editorial hover:underline">
              Sign In
            </Link>{' '}
            to build your own — same engine, your constraints.
          </p>
        ) : mine.length === 0 ? (
          <p className="font-serif italic text-ink-700 max-w-measure">
            You haven&apos;t built one yet.{' '}
            <Link href={'/portfolios/new' as Route} className="text-editorial hover:underline">
              Start a Portfolio
            </Link>{' '}
            and the engine will size it against your constraints.
          </p>
        ) : (
          <table className="editorial-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">As Of</th>
                <th className="num">Cash</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mine.map((p) => (
                <tr key={p.id}>
                  <td className="font-serif">{p.name}</td>
                  <td className="num">{formatDate(p.asOf)}</td>
                  <td className="num">{formatPercent(p.cashWeight)}</td>
                  <td>
                    <Link
                      href={`/portfolios/${p.id}` as Route}
                      className="font-sans text-sm text-editorial hover:underline"
                    >
                      Open &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
