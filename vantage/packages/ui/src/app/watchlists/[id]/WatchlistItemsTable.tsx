'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { labelDisplay, relativeAge, type WatchlistItem } from '@/lib/watchlists';

/**
 * Phase 10 — watchlist items table. Shows the first 10 rows and reveals the
 * rest behind a "Show all" toggle so long system lists (S&P 500 Highlights,
 * AI Frontier) stay scannable.
 */

const INITIAL = 10;

export function WatchlistItemsTable({
  items,
  isOwner,
  removeAction,
}: {
  items: WatchlistItem[];
  isOwner: boolean;
  removeAction?: (entity: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const visible = expanded ? items : items.slice(0, INITIAL);
  const hidden = items.length - INITIAL;

  return (
    <div className="overflow-x-auto">
      <table className="editorial-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Company</th>
            <th>Sector</th>
            <th>Class</th>
            <th className="num">Score</th>
            <th>Label</th>
            <th className="num">Conf.</th>
            <th className="num">Added</th>
            {isOwner ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {visible.map((it) => (
            <tr key={it.entity}>
              <td className="font-mono text-xs text-ink-700 whitespace-nowrap">{it.ticker ?? it.entity}</td>
              <td className="font-serif text-ink-900">
                <Link
                  href={`/public/${it.ticker ?? it.entity}` as Route}
                  className="hover:underline decoration-editorial"
                >
                  {it.name ?? it.entity}
                </Link>
              </td>
              <td className="eyebrow normal-case text-ink-700">{it.sector ?? '—'}</td>
              <td className="eyebrow normal-case text-ink-700">{it.assetClass ?? '—'}</td>
              <td className={`num ${it.label === 'narrative_breakdown' ? 'text-editorial' : ''}`}>
                {it.score === null ? '—' : it.score.toFixed(0)}
              </td>
              <td className="eyebrow normal-case text-ink-700">{labelDisplay(it.label)}</td>
              <td className="num text-ink-500">
                {it.scoreConfidence === null ? '—' : `${(it.scoreConfidence * 100).toFixed(0)}%`}
              </td>
              <td className="num text-ink-500">{relativeAge(it.addedAt)}</td>
              {isOwner ? (
                <td>
                  {removeAction ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => startTransition(() => void removeAction(it.entity))}
                      className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark disabled:text-ink-300"
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
        >
          {expanded ? '▴ Show less' : `▾ Show ${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}
