import Link from 'next/link';
import type { Route } from 'next';
import { listAuditRecords } from '@/lib/audit';
import { formatDate } from '@/lib/format';

export default function SourcesPage() {
  const records = listAuditRecords();

  return (
    <div>
      <header className="border-b border-ink-100 pb-10 mb-8">
        <p className="eyebrow mb-3">Sources</p>
        <h1 className="font-display text-5xl tracking-editorial">
          Every read traces back to its inputs.
        </h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure mt-6">
          This is the record of every read Vantage has produced. Open any one to see the exact
          steps behind it — which methods ran, what each one was weighted, and what went in.
        </p>
      </header>

      <table className="editorial-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>What was produced</th>
            <th className="num">Confidence</th>
            <th>Date</th>
            <th><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td className="font-serif">{r.entity}</td>
              <td className="font-sans text-sm text-ink-700">{r.what}</td>
              <td className="num">{(r.confidence * 100).toFixed(0)}%</td>
              <td className="font-mono text-xs text-ink-500">{formatDate(r.date)}</td>
              <td className="num">
                <Link
                  href={`/audit/${r.id}` as Route}
                  className="font-sans text-sm text-editorial hover:underline whitespace-nowrap"
                >
                  See the Steps →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
