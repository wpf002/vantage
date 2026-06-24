'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';

/**
 * Triggers a fresh live valuation run for a private company, then refreshes
 * the server-rendered page so the real numbers replace this empty state.
 *
 * While the run is in flight it shows the editorial loading line — no
 * skeletons, just serif italic, per the page's typographic system.
 */
export function RunValuationButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');

  if (state === 'running') {
    return (
      <p className="font-serif text-deck text-ink-700 italic max-w-measure leading-relaxed">
        Loading — this takes about 15 seconds.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          setState('running');
          try {
            await apiPost('/v1/private/value-live', { companyId });
            router.refresh();
          } catch {
            setState('error');
          }
        }}
        className="font-sans text-sm uppercase tracking-wider border border-ink-900 px-6 py-3 hover:bg-ink-900 hover:text-cream transition-colors"
      >
        Run a fresh valuation
      </button>
      {state === 'error' && (
        <p className="font-sans text-xs text-editorial mt-3 leading-snug">
          Unable to load data. Please try again.
        </p>
      )}
    </div>
  );
}
