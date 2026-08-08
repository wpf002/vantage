'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';

interface BacktestReport {
  decisionsAnalyzed: number;
  accuracyUnweighted: number;
  accuracyQualityWeighted: number;
  delta: number;
  coverageRate: number;
  totalReplayPairs: number;
  sourceBreakdown: Array<{
    sourceKey: string;
    sampleCount: number;
    hitRate: number;
    finalCredibility: number;
  }>;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pp = (n: number) => {
  const s = (n * 100).toFixed(2);
  return n >= 0 ? `+${s}pp` : `${s}pp`;
};

export function EvidenceBacktest() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState('running');
    setError(null);
    try {
      const r = await apiPost<BacktestReport>('/v1/meta/evidence/backtest', { limit: 10000 });
      setReport(r);
      setState('done');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-8 flex-wrap">
        <div className="max-w-measure">
          <p className="font-serif text-ink-800 leading-relaxed text-sm">
            Replays all graded decisions chronologically, advancing source credibility scores
            after each outcome. Compares overall accuracy with and without quality weighting.
            Read-only — does not modify live data.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={state === 'running'}
          className="font-sans text-xs uppercase tracking-wider border border-ink-300 px-4 py-2 text-ink-700 hover:border-ink-700 hover:text-ink-900 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {state === 'running' ? 'Running…' : 'Run Backtest'}
        </button>
      </div>

      {state === 'error' && (
        <p className="font-mono text-xs text-editorial">{error}</p>
      )}

      {state === 'done' && report && (
        <div className="space-y-8">
          {/* Summary stats */}
          <div className="flex flex-wrap gap-x-16 gap-y-5 border-t border-ink-100 pt-6">
            <Stat label="Decisions Analyzed" value={report.decisionsAnalyzed.toLocaleString()} />
            <Stat label="Unweighted Accuracy" value={pct(report.accuracyUnweighted)} />
            <Stat label="Quality-Weighted" value={pct(report.accuracyQualityWeighted)} />
            <Stat
              label="Delta"
              value={pp(report.delta)}
              accent={report.delta > 0 ? 'positive' : report.delta < 0 ? 'negative' : undefined}
            />
            <Stat label="Coverage" value={pct(report.coverageRate)} />
            <Stat label="Source-Outcome Pairs" value={report.totalReplayPairs.toLocaleString()} />
          </div>

          {report.coverageRate < 0.1 && (
            <p className="font-serif italic text-ink-500 text-sm max-w-measure leading-relaxed">
              Coverage is low — reasoning path rows are only written going forward from when
              Evidence Quality was wired in. As more decisions are scored, coverage will rise
              and the quality-weighted delta will become more meaningful.
            </p>
          )}

          {/* Per-source breakdown */}
          {report.sourceBreakdown.length > 0 && (
            <div>
              <p className="eyebrow mb-3">Source Breakdown</p>
              <div className="overflow-x-auto">
                <table className="editorial-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th className="num">Graded</th>
                      <th className="num">Hit Rate</th>
                      <th className="num">Final Credibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sourceBreakdown.map((s) => (
                      <tr key={s.sourceKey}>
                        <td className="font-mono text-xs text-ink-700">{s.sourceKey}</td>
                        <td className="num">{s.sampleCount}</td>
                        <td className="num">{pct(s.hitRate)}</td>
                        <td className="num">{pct(s.finalCredibility)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'positive' | 'negative';
}) {
  const valueClass = accent === 'negative' ? 'text-editorial' : 'text-ink-900';
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      <p className={`num text-2xl ${valueClass}`}>{value}</p>
    </div>
  );
}
