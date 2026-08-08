/**
 * SignalQualityPanel — shows evidence quality and reasoning path data for the
 * latest scored decisions for a ticker.
 *
 * Server component: fetches at render time. Returns null if no reasoning paths
 * exist yet (graceful — new feature, data accumulates going forward).
 */

import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface LayerSummary {
  layer: string;
  layerScore: number | null;
  compositeQuality: number | null;
  fired: boolean;
  maxSensitivitySignalId: string | null;
  maxSensitivityDelta: number | null;
}

interface DecisionReasoning {
  decisionId: string;
  decisionType: string;
  decidedAt: string;
  layers: LayerSummary[];
}

const LAYER_DISPLAY: Record<string, string> = {
  egs: 'Expectation Gap',
  nis: 'Fundamental Support',
  nhs: 'Sentiment Premium',
  composite: 'Composite',
  classification: 'Classification',
};

function qualityLabel(score: number): string {
  if (score >= 0.80) return 'High';
  if (score >= 0.60) return 'Medium';
  return 'Low';
}

function qualityColor(score: number): string {
  if (score >= 0.80) return 'text-ink-900';
  if (score >= 0.60) return 'text-ink-600';
  return 'text-editorial';
}

async function fetchReasoning(ticker: string): Promise<DecisionReasoning[]> {
  try {
    return await apiGet<DecisionReasoning[]>(`/v1/meta/evidence/entity/${ticker}/reasoning`);
  } catch {
    return [];
  }
}

export async function SignalQualityPanel({ ticker }: { ticker: string }) {
  const decisions = await fetchReasoning(ticker);
  if (decisions.length === 0) return null;

  const latest = decisions[0]!;
  const layers = latest.layers.filter((l) => l.compositeQuality !== null);
  if (layers.length === 0) return null;

  const overallQuality =
    layers.reduce((sum, l) => sum + (l.compositeQuality ?? 0), 0) / layers.length;

  // Most sensitive signal across all layers
  const mostSensitive = layers.reduce<LayerSummary | null>((best, l) => {
    if (l.maxSensitivityDelta === null) return best;
    if (!best || l.maxSensitivityDelta > (best.maxSensitivityDelta ?? 0)) return l;
    return best;
  }, null);

  return (
    <div className="space-y-4">
      <p className="eyebrow">Signal Quality</p>

      {/* Overall composite quality */}
      <div className="flex items-baseline gap-3">
        <span className={`num text-2xl ${qualityColor(overallQuality)}`}>
          {(overallQuality * 100).toFixed(0)}
        </span>
        <span className={`font-sans text-xs uppercase tracking-wider ${qualityColor(overallQuality)}`}>
          {qualityLabel(overallQuality)}
        </span>
      </div>

      <p className="font-serif italic text-xs text-ink-500 leading-snug">
        Composite evidence quality across {layers.length} scoring layer{layers.length !== 1 ? 's' : ''}.
        Based on source credibility, recency, independence, and methodological strength.
      </p>

      {/* Per-layer quality */}
      <table className="editorial-table">
        <thead>
          <tr>
            <th>Layer</th>
            <th className="num">Score</th>
            <th className="num">Quality</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((l) => (
            <tr key={l.layer}>
              <td className="font-sans text-xs uppercase tracking-wider text-ink-700">
                {LAYER_DISPLAY[l.layer] ?? l.layer}
              </td>
              <td className="num">
                {l.layerScore !== null ? l.layerScore.toFixed(1) : '—'}
              </td>
              <td className={`num ${qualityColor(l.compositeQuality ?? 0)}`}>
                {l.compositeQuality !== null
                  ? `${(l.compositeQuality * 100).toFixed(0)}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Most sensitive signal */}
      {mostSensitive?.maxSensitivitySignalId && (
        <p className="font-serif italic text-xs text-ink-500 leading-snug">
          Highest sensitivity in{' '}
          <span className="font-sans uppercase tracking-wider not-italic">
            {LAYER_DISPLAY[mostSensitive.layer] ?? mostSensitive.layer}
          </span>
          {mostSensitive.maxSensitivityDelta !== null && (
            <> — removing the dominant input would shift the layer score by{' '}
              {Math.abs(mostSensitive.maxSensitivityDelta).toFixed(2)} points</>
          )}.
        </p>
      )}

      <p className="font-mono text-xs text-ink-400">
        As of {formatDate(latest.decidedAt)}
      </p>
    </div>
  );
}
