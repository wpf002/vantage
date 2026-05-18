import Link from 'next/link';
import type { Route } from 'next';
import { apiServerGet } from '@/lib/api-server';
import { AuditList, type AuditSignal } from './AuditList';

interface PageProps {
  searchParams: Promise<{ signalType?: string }>;
}

const FILTERS: Array<{ label: string; signalType: string | null }> = [
  { label: 'All', signalType: null },
  { label: 'Public Scores', signalType: 'public.score' },
  { label: 'Private Valuations', signalType: 'private.blended_valuation' },
  { label: 'Classifications', signalType: 'platform.classification' },
  { label: 'Portfolio Decisions', signalType: 'platform.portfolio_construction' },
  { label: 'Simulations', signalType: 'platform.simulation_outcome' },
];

export default async function AuditIndexPage({ searchParams }: PageProps) {
  const { signalType } = await searchParams;
  const qs = new URLSearchParams();
  // Pull a wider batch so the in-screen pagination has something to page through
  // without needing a server round-trip per page.
  qs.set('limit', '200');
  if (signalType) qs.set('signalType', signalType);

  let signals: AuditSignal[] = [];
  let fetchError: string | null = null;
  try {
    signals = await apiServerGet<AuditSignal[]>(`/v1/audit?${qs.toString()}`);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'unknown error';
  }

  const activeFilter = signalType ?? null;

  return (
    <div>
      <header className="border-b border-ink-100 pb-10 mb-8">
        <h1 className="font-display text-5xl tracking-editorial mb-6">Audit Trail</h1>
        <p className="font-serif text-deck text-ink-700 max-w-measure leading-snug">
          Complete lineage for every score, valuation, classification, and decision.
        </p>
      </header>

      <nav className="mb-8 border-b border-ink-100 pb-4 overflow-x-auto">
        <div className="flex flex-nowrap items-center gap-x-8 whitespace-nowrap">
          {FILTERS.map((f) => {
            const active = (f.signalType ?? null) === activeFilter;
            const href = f.signalType
              ? `/audit?signalType=${encodeURIComponent(f.signalType)}`
              : '/audit';
            return (
              <Link
                key={f.label}
                href={href as Route}
                className={`font-sans text-eyebrow uppercase tracking-wider transition-colors flex-shrink-0 ${
                  active
                    ? 'text-editorial border-b-2 border-editorial pb-1'
                    : 'text-ink-700 hover:text-editorial'
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {fetchError ? (
        <p className="font-serif italic text-editorial">
          Unable to load audit signals. {fetchError}
        </p>
      ) : (
        <AuditList signals={signals} />
      )}
    </div>
  );
}
