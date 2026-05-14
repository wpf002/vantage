import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { AuditChain } from '@/components/AuditChain';
import { getAuditRecord } from '@/lib/audit';

export default async function AuditRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getAuditRecord(id);
  if (!record) notFound();

  return (
    <article className="grid grid-cols-12 gap-x-10 gap-y-10">
      <header className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-3">
          <Link href="/audit" className="hover:text-editorial">Sources</Link> · {record.what}
        </p>
        <h1 className="font-display text-5xl tracking-editorial leading-tight mb-6">
          {record.entity}
        </h1>
        <p className="font-serif text-deck text-ink-800 max-w-measure leading-relaxed">
          {record.summary}
        </p>
      </header>

      <section className="col-span-12 lg:col-span-8 space-y-10">
        <div className="flex flex-wrap gap-x-12 gap-y-4">
          <div>
            <p className="eyebrow mb-1">Confidence</p>
            <p className="font-mono text-2xl text-ink-900">{(record.confidence * 100).toFixed(0)}%</p>
            <p className="font-sans text-xs text-ink-700 mt-1 max-w-[16rem] leading-snug">
              How much weight to put on this read, given how clean and consistent the inputs were.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-1">Date</p>
            <p className="font-mono text-2xl text-ink-900">{record.date}</p>
            <p className="font-sans text-xs text-ink-700 mt-1 max-w-[16rem] leading-snug">
              When this read was produced. Inputs change over time, so the date is part of the record.
            </p>
          </div>
        </div>

        {record.entityHref && (
          <Link
            href={record.entityHref as Route}
            className="inline-block font-sans text-sm text-editorial hover:underline"
          >
            See the full page for {record.entity} →
          </Link>
        )}
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10">
        <AuditChain steps={record.steps} />
      </aside>
    </article>
  );
}
