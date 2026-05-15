'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';

/**
 * Triggers a fresh live Public Score run for a ticker, then refreshes the
 * server-rendered page so the real numbers replace this empty state.
 *
 * While the run is in flight it shows the editorial loading line — no
 * skeletons, just serif italic, per the page's typographic system.
 */
export function RunScoreButton({ ticker }: { ticker: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');

  if (state === 'running') {
    return (
      <p className="font-serif text-deck text-ink-700 italic max-w-measure leading-relaxed">
        Pulling fresh data — about 10 seconds.
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
            router.refresh();
          } catch {
            setState('error');
          }
        }}
        className="font-sans text-sm uppercase tracking-wider border border-ink-900 px-6 py-3 hover:bg-ink-900 hover:text-cream transition-colors"
      >
        Run live now
      </button>
      {state === 'error' && (
        <p className="font-sans text-xs text-editorial mt-3 leading-snug">
          Something went wrong pulling fresh data. Check that the API and its FMP key are
          configured, then try again.
        </p>
      )}
    </div>
  );
}
