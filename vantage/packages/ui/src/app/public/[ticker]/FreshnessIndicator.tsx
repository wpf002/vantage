'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';

/**
 * Mono-style timestamp + opt-in refresh link. Renders next to the headline as
 * "Last scored: 4 hours ago" — and once the score crosses the staleness floor,
 * adds an editorial-red "refresh" link that re-runs the orchestrator. No
 * auto-refresh: the reader decides when fresh data is worth a wait.
 */

const HOUR_MS = 60 * 60 * 1000;
const STALE_HOURS = 24;

function relativeAge(asOf: string): { hours: number; label: string } {
  const ts = new Date(asOf).getTime();
  const ageMs = Math.max(0, Date.now() - ts);
  const hours = Math.floor(ageMs / HOUR_MS);
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(ageMs / 60_000));
    return { hours, label: `${minutes} minute${minutes === 1 ? '' : 's'} ago` };
  }
  if (hours < 24) return { hours, label: `${hours} hour${hours === 1 ? '' : 's'} ago` };
  const days = Math.floor(hours / 24);
  return { hours, label: `${days} day${days === 1 ? '' : 's'} ago` };
}

export function FreshnessIndicator({ ticker, asOf }: { ticker: string; asOf: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  const { hours, label } = relativeAge(asOf);
  const isStale = hours >= STALE_HOURS;

  if (state === 'running') {
    return (
      <p className="font-mono text-xs text-ink-500 mt-2">
        Pulling fresh data — about 10 seconds.
      </p>
    );
  }

  return (
    <p className="font-mono text-xs text-ink-500 mt-2">
      <span className="uppercase tracking-wider">Last scored:</span> {label}
      {isStale && (
        <>
          {' — '}
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
            className="text-editorial hover:underline underline-offset-2"
          >
            refresh
          </button>
        </>
      )}
      {state === 'error' && (
        <span className="block text-editorial mt-1">
          Refresh failed — check API + FMP key and try again.
        </span>
      )}
    </p>
  );
}
