'use client';

import { useState, useTransition } from 'react';
import { triggerBackfill } from './actions';

/**
 * "Backfill outcomes now" trigger. Enqueues the job and reports the queued
 * id — the work itself runs async in the API worker, so this confirms the
 * hand-off rather than waiting for completion.
 */
export function BackfillButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMsg(null);
            try {
              const { jobId } = await triggerBackfill();
              setMsg(jobId ? `Queued (job ${jobId}). Outcomes resolve in the background.` : 'Queued.');
            } catch {
              setMsg('Could not enqueue the backfill.');
            }
          })
        }
        className={`font-sans text-eyebrow uppercase tracking-wider ${
          pending ? 'text-ink-300 cursor-not-allowed' : 'text-editorial hover:text-editorial-dark'
        }`}
      >
        {pending ? 'Enqueuing…' : 'Backfill Outcomes Now →'}
      </button>
      {msg ? <span className="font-serif italic text-sm text-ink-700">{msg}</span> : null}
    </div>
  );
}
