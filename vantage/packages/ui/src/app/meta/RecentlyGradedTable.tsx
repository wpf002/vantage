'use client';

import { useState } from 'react';

/**
 * Phase 10 polish — Recently Graded table. Shows the first 5 graded outcomes
 * and reveals the rest behind a "Show all" toggle.
 */

export interface GradedRow {
  ticker: string;
  call: string;
  expected: string;
  returnPct: string;
  returnNegative: boolean;
  hit: boolean;
  graded: string;
}

const INITIAL = 5;

export function RecentlyGradedTable({ rows }: { rows: GradedRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, INITIAL);
  const hidden = rows.length - INITIAL;

  return (
    <div className="overflow-x-auto">
      <table className="editorial-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Call</th>
            <th>Expected</th>
            <th className="num">Return</th>
            <th>Result</th>
            <th>Graded</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr key={`${r.ticker}-${i}`}>
              <td className="font-mono text-xs text-ink-700">{r.ticker}</td>
              <td className="font-sans text-xs uppercase tracking-wider text-ink-700">{r.call}</td>
              <td className="font-sans text-xs uppercase tracking-wider text-ink-500">{r.expected}</td>
              <td className={`num ${r.returnNegative ? 'text-editorial' : 'text-ink-900'}`}>{r.returnPct}</td>
              <td
                className={`font-sans text-xs uppercase tracking-wider ${r.hit ? 'text-ink-900' : 'text-editorial'}`}
              >
                {r.hit ? 'Hit' : 'Miss'}
              </td>
              <td className="font-mono text-xs text-ink-500 whitespace-nowrap">{r.graded}</td>
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
