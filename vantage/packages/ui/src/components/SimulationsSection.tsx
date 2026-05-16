import Link from 'next/link';
import type { Route } from 'next';
import { apiServerGet } from '@/lib/api-server';
import { formatDate } from '@/lib/format';

interface SimulationListItem {
  id: string;
  kind: 'monte_carlo' | 'scenario_tree' | 'regime_switching';
  seed: number | null;
  runAt: string;
  summary: {
    horizonYears: number | null;
    paths: number | null;
    median: number | null;
    probabilityOfLoss: number | null;
  };
}

const KIND_LABELS: Record<string, string> = {
  monte_carlo: 'Monte Carlo',
  scenario_tree: 'Scenario Tree',
  regime_switching: 'Regime Switching',
};

function formatPct(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(1)}%`;
}

export async function SimulationsSection({ portfolioId }: { portfolioId: string }) {
  let rows: SimulationListItem[] = [];
  try {
    rows = await apiServerGet<SimulationListItem[]>(
      `/v1/simulation/portfolio/${portfolioId}`,
    );
  } catch {
    // The list endpoint is best-effort here — if it fails the section just
    // shows the empty state. The portfolio page should still render.
    rows = [];
  }

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Simulations</p>
        <Link
          href={`/simulation?portfolio=${portfolioId}` as Route}
          className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:underline"
        >
          Run A Simulation &rarr;
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="font-serif italic text-ink-700">No simulations yet.</p>
      ) : (
        <table className="editorial-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Model</th>
              <th className="num">Horizon</th>
              <th className="num">Median Return</th>
              <th className="num">Probability Of Loss</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="num">{formatDate(r.runAt)}</td>
                <td className="font-serif">{KIND_LABELS[r.kind] ?? r.kind}</td>
                <td className="num">
                  {r.summary.horizonYears ? `${r.summary.horizonYears}y` : '—'}
                </td>
                <td className="num text-editorial">{formatPct(r.summary.median)}</td>
                <td className="num">
                  {r.summary.probabilityOfLoss !== null
                    ? `${Math.round(r.summary.probabilityOfLoss * 100)}%`
                    : '—'}
                </td>
                <td>
                  <Link
                    href={`/simulation/${r.id}` as Route}
                    className="font-sans text-sm text-editorial hover:underline"
                  >
                    Open &rarr;
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
