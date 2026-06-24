'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';

/**
 * "Score this ticker now" — runs a fresh live Public Score for an
 * FMP-resolved but not-yet-seeded ticker, then redirects to its tear sheet.
 *
 * While the run is in flight it shows the editorial loading line — serif
 * italic, no skeletons.
 */
export function ScoreTickerButton({ ticker }: { ticker: string }) {
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
            await apiPost('/v1/public/score-live', { ticker });
            router.push(`/public/${ticker}`);
          } catch {
            setState('error');
          }
        }}
        className="font-sans text-sm uppercase tracking-wider border border-ink-900 px-6 py-3 hover:bg-ink-900 hover:text-cream transition-colors"
      >
        Score this ticker now
      </button>
      {state === 'error' && (
        <p className="font-sans text-xs text-editorial mt-3 leading-snug">
          Unable to load data. Please try again.
        </p>
      )}
    </div>
  );
}
