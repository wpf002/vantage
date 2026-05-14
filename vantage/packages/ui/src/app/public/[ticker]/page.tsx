import { notFound } from 'next/navigation';
import { SignalLabel } from '@/components/SignalLabel';
import { AuditChain } from '@/components/AuditChain';
import { getPublicCompany } from '@/lib/companies';

export default async function PublicTicker({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const company = getPublicCompany(ticker);
  if (!company) notFound();

  return (
    <article className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">{company.ticker} · {company.sector} · Public company</p>
        <h1 className="font-display text-6xl tracking-editorial leading-tight mb-6">{company.name}</h1>
        <p className="font-mono text-sm text-ink-500">As of {company.asOf}</p>
      </header>

      <section className="col-span-12 lg:col-span-8 space-y-12">
        <SignalLabel
          label={company.read}
          readPlain={company.readPlain}
          score={company.score}
          direction={company.direction}
          confidence={company.confidence}
        />

        <div>
          <p className="eyebrow mb-4">Why we landed there</p>
          <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
            {company.rationale}
          </p>
        </div>

        <div>
          <p className="eyebrow mb-2">What's moving the score</p>
          <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
            Three things go into the score. Here's what each one measures and where this company stands today.
          </p>
          <table className="editorial-table">
            <thead>
              <tr>
                <th>Factor</th>
                <th className="num">Score</th>
                <th>What it's telling us</th>
              </tr>
            </thead>
            <tbody>
              {company.factors.map((f) => (
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
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10">
        <AuditChain steps={company.lineage} />
      </aside>
    </article>
  );
}
