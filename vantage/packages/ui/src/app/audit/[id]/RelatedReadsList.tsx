'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { formatDate } from '@/lib/format';

export interface RelatedSignal {
  signalId: string;
  signalType: string;
  confidence: number;
  timestamp: string;
}

const PREVIEW_COUNT = 3;
const PAGE_SIZE = 10;

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  'public.score': 'Public Score',
  'private.blended_valuation': 'Private Valuation',
  'platform.classification': 'Classification',
  'platform.portfolio_construction': 'Portfolio Built',
  'platform.simulation_outcome': 'Simulation Run',
};

function humanizeSignalType(t: string): string {
  return SIGNAL_TYPE_LABELS[t] ?? t;
}

function shortTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = formatDate(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

export function RelatedReadsList({ signals }: { signals: RelatedSignal[] }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(signals.length / PAGE_SIZE)),
    [signals.length],
  );
  const safePage = Math.min(page, totalPages - 1);

  const visible = useMemo(() => {
    if (!expanded) return signals.slice(0, PREVIEW_COUNT);
    const start = safePage * PAGE_SIZE;
    return signals.slice(start, start + PAGE_SIZE);
  }, [expanded, safePage, signals]);

  const hiddenCount = Math.max(0, signals.length - PREVIEW_COUNT);
  const showPagination = expanded && signals.length > PAGE_SIZE;

  if (signals.length === 0) {
    return (
      <p className="font-serif italic text-sm text-ink-700">
        No other reads recorded for this entity.
      </p>
    );
  }

  return (
    <div>
      <ul className="space-y-0">
        {visible.map((r) => (
          <li key={r.signalId} className="border-b border-ink-100 py-3 first:pt-0">
            <Link href={`/audit/${r.signalId}` as Route} className="block group">
              <p className="font-sans text-eyebrow uppercase tracking-wider text-ink-900 group-hover:text-editorial">
                {humanizeSignalType(r.signalType)}
              </p>
              <p className="font-mono text-xs text-ink-500 mt-1">
                {shortTs(r.timestamp)} · {(r.confidence * 100).toFixed(0)}% confidence
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {hiddenCount > 0 ? (
        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setExpanded((e) => !e);
              setPage(0);
            }}
            className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark inline-flex items-center gap-2"
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                <Caret direction="up" />
                Collapse
              </>
            ) : (
              <>
                <Caret direction="down" />
                Show {hiddenCount} More
              </>
            )}
          </button>

          {showPagination ? (
            <div className="flex items-center justify-between gap-4 pt-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className={`font-sans text-eyebrow uppercase tracking-wider ${
                  safePage === 0
                    ? 'text-ink-300 cursor-not-allowed'
                    : 'text-editorial hover:text-editorial-dark'
                }`}
              >
                &larr; Prev
              </button>
              <span className="font-mono text-xs text-ink-700 whitespace-nowrap">
                {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className={`font-sans text-eyebrow uppercase tracking-wider ${
                  safePage >= totalPages - 1
                    ? 'text-ink-300 cursor-not-allowed'
                    : 'text-editorial hover:text-editorial-dark'
                }`}
              >
                Next &rarr;
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Caret({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden
      className={direction === 'up' ? 'rotate-180' : ''}
    >
      <path d="M1 3 L5 7 L9 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
