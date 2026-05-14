import { notFound } from 'next/navigation';
import { SignalLabel } from '@/components/SignalLabel';
import { ValuationBand } from '@/components/ValuationBand';
import { AuditChain } from '@/components/AuditChain';
import { getPrivateCompany } from '@/lib/companies';

export default async function PrivateCompany({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = getPrivateCompany(id);
  if (!company) notFound();

  return (
    <article className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">{company.lifeStage} · {company.sector} · Private company</p>
        <h1 className="font-display text-6xl tracking-editorial leading-tight mb-6">{company.name}</h1>
        <p className="font-mono text-sm text-ink-500">As of {company.asOf}</p>
      </header>

      <section className="col-span-12 lg:col-span-8 space-y-12">
        <SignalLabel
          label={company.read}
          readPlain={company.readPlain}
          direction={company.direction}
          confidence={company.confidence}
        />

        <ValuationBand
          bear={company.valuation.bear}
          base={company.valuation.base}
          bull={company.valuation.bull}
        />

        <div>
          <p className="eyebrow mb-2">How we valued it</p>
          <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
            Private companies have no stock price, so we value them three ways and weight whichever methods
            actually fit this business.
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
              {company.methods.map((m) => (
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
          <p className="eyebrow mb-4">Why we landed there</p>
          <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
            {company.rationale}
          </p>
        </div>
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10">
        <AuditChain steps={company.lineage} />
      </aside>
    </article>
  );
}
