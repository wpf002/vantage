'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';

export interface AuditSignal {
  signalId: string;
  entity: string;
  companyName: string | null;
  signalType: string;
  direction: 'bullish' | 'neutral' | 'bearish';
  magnitude: number;
  confidence: number;
  sourceVersion: string;
  rationale: string;
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

function displayEntity(entity: string): string {
  if (entity === entity.toUpperCase() && entity.length <= 5) return entity;
  return entity
    .split(/[-_]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function entityHref(entity: string, signalType: string): string {
  const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidShape.test(entity)) return `/public/${entity}`;
  if (signalType === 'platform.simulation_outcome' || signalType === 'platform.portfolio_construction') {
    return `/portfolios/${entity}`;
  }
  return `/private/${entity}`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const delta = Math.max(0, now - then);
  const m = Math.floor(delta / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

export function AuditList({ signals }: { signals: AuditSignal[] }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0); // zero-indexed

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(signals.length / PAGE_SIZE)),
    [signals.length],
  );

  // Clamp the page if the underlying list shrinks (defensive).
  const safePage = Math.min(page, totalPages - 1);

  const visible = useMemo(() => {
    if (!expanded) return signals.slice(0, PREVIEW_COUNT);
    const start = safePage * PAGE_SIZE;
    return signals.slice(start, start + PAGE_SIZE);
  }, [expanded, safePage, signals]);

  const hiddenCount = signals.length - PREVIEW_COUNT;
  const showPagination = expanded && signals.length > PAGE_SIZE;

  if (signals.length === 0) {
    return <p className="font-serif italic text-ink-700">No reads yet in this category.</p>;
  }

  return (
    <div>
      <table className="editorial-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Entity</th>
            <th>What</th>
            <th className="num">Confidence</th>
            <th>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => (
            <tr key={s.signalId}>
              <td className="font-mono text-xs text-ink-500 whitespace-nowrap">
                {relativeTime(s.timestamp)}
              </td>
              <td>
                <Link
                  href={entityHref(s.entity, s.signalType) as Route}
                  className="font-serif text-ink-900 hover:text-editorial border-b border-transparent hover:border-editorial"
                >
                  {s.companyName ?? displayEntity(s.entity)}
                </Link>
              </td>
              <td>
                <span className="font-sans text-eyebrow uppercase tracking-wider text-ink-900">
                  {humanizeSignalType(s.signalType)}
                </span>
              </td>
              <td className="num">{(s.confidence * 100).toFixed(0)}%</td>
              <td className="num">
                <Link
                  href={`/audit/${s.signalId}` as Route}
                  className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark whitespace-nowrap"
                >
                  View Chain &rarr;
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Expand / collapse + pagination ──────────────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          {hiddenCount > 0 ? (
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
                  Show {Math.min(hiddenCount, signals.length - PREVIEW_COUNT)} More
                </>
              )}
            </button>
          ) : null}
        </div>

        {showPagination ? (
          <div className="flex items-center gap-6">
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
              Page {safePage + 1} of {totalPages}
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
