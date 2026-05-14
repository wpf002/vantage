import type { AuditStep } from '@/lib/companies';

interface AuditChainProps {
  steps: AuditStep[];
}

/**
 * "Where this comes from" — the sidebar lineage list. Each step leads with a
 * plain-English name, with the technical identifier kept underneath as the
 * receipts trail.
 */
export function AuditChain({ steps }: AuditChainProps) {
  return (
    <div>
      <p className="eyebrow mb-2">Where this comes from</p>
      <p className="font-sans text-xs text-ink-700 mb-4 leading-snug">
        Every read is built from these steps. Nothing here is a black box — this is the full trail.
      </p>
      <ol className="space-y-0 border-t border-ink-100">
        {steps.map((s) => (
          <li key={s.step} className="border-b border-ink-100 py-3 flex items-baseline gap-4">
            <span className="font-mono text-xs text-ink-500 w-6">{String(s.step + 1).padStart(2, '0')}</span>
            <div className="flex-1">
              <p className="font-serif text-sm text-ink-900">{s.label}</p>
            </div>
            {s.weight !== null && s.weight !== undefined && (
              <span className="font-mono text-xs text-editorial uppercase">
                {(s.weight * 100).toFixed(0)}% weight
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
