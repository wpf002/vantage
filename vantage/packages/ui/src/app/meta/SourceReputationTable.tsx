'use client';

import { useState } from 'react';

export interface SourceRow {
  sourceKey: string;
  displayName: string;
  credibilityScore: number;
  sampleCount: number;
  hitRate: number | null;
}

const INITIAL = 8;

function credBar(score: number) {
  const pct = Math.round(score * 100);
  const color = score >= 0.75 ? '#1a1a1a' : score >= 0.55 ? '#555' : '#c0392b';
  return (
    <span className="inline-flex items-center gap-2">
      <span
        style={{ width: 48, height: 3, background: '#e5e5e5', display: 'inline-block', verticalAlign: 'middle', borderRadius: 2 }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 2,
          }}
        />
      </span>
      <span className="num text-xs">{pct}</span>
    </span>
  );
}

export function SourceReputationTable({ rows }: { rows: SourceRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...rows].sort((a, b) => b.credibilityScore - a.credibilityScore);
  const visible = expanded ? sorted : sorted.slice(0, INITIAL);
  const hidden = sorted.length - INITIAL;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="editorial-table">
          <thead>
            <tr>
              <th>Source</th>
              <th className="num">Credibility</th>
              <th className="num">Graded</th>
              <th className="num">Hit Rate</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.sourceKey}>
                <td>
                  <span className="font-serif text-ink-900">{r.displayName}</span>
                  <span className="block font-mono text-xs text-ink-500 mt-0.5">{r.sourceKey}</span>
                </td>
                <td className="num align-top">{credBar(r.credibilityScore)}</td>
                <td className="num align-top">{r.sampleCount}</td>
                <td className="num align-top">
                  {r.hitRate !== null ? `${(r.hitRate * 100).toFixed(0)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
        >
          {expanded ? '▴ Show less' : `▾ Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}
