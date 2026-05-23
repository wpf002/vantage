'use client';

import { useMemo, useState, useTransition } from 'react';
import type { RegimePreset } from '@/lib/regime-presets';
import { runRegimeAction } from './actions';

export type PortfolioOption = {
  id: string;
  name: string;
  kind: 'system' | 'personal' | 'published';
};

interface RegimeFormProps {
  portfolios: PortfolioOption[];
  presets: RegimePreset[];
}

const STEPS_DEFAULT = 60;
const PATHS_DEFAULT = 5000;

export function RegimeForm({ portfolios, presets }: RegimeFormProps) {
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? '');
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]!;

  // The matrix is editable as percentages (0–100). Stored as strings so users
  // can clear a cell mid-edit without it snapping back to 0, and so leading
  // zeros / partial input don't fight the controlled input. Re-seeded when
  // the user picks a different preset.
  const [matrixPct, setMatrixPct] = useState<string[][]>(() =>
    toPctMatrix(preset.transitionMatrix).map((row) => row.map(String)),
  );
  const [matrixPresetId, setMatrixPresetId] = useState(preset.id);
  if (matrixPresetId !== preset.id) {
    // Cheap reset on preset change without an effect — runs once on render
    // when the template changes; React batches the state update.
    setMatrixPct(toPctMatrix(preset.transitionMatrix).map((row) => row.map(String)));
    setMatrixPresetId(preset.id);
  }

  const [initialRegime, setInitialRegime] = useState(preset.initialRegime);
  const [initialPresetId, setInitialPresetId] = useState(preset.id);
  if (initialPresetId !== preset.id) {
    setInitialRegime(preset.initialRegime);
    setInitialPresetId(preset.id);
  }

  const [steps, setSteps] = useState(STEPS_DEFAULT);
  const [paths, setPaths] = useState(PATHS_DEFAULT);
  const [seed, setSeed] = useState('');

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rowSums = useMemo(
    () => matrixPct.map((row) => row.reduce((a, b) => a + cellNumber(b), 0)),
    [matrixPct],
  );
  const invalidRows = rowSums
    .map((s, i) => ({ name: preset.regimes[i] ?? `Row ${i + 1}`, sum: s }))
    .filter((r) => Math.abs(r.sum - 100) > 0.01);

  const canSubmit = portfolios.length > 0 && invalidRows.length === 0 && !pending;

  function setMatrixCell(row: number, col: number, val: string): void {
    setMatrixPct((m) =>
      m.map((r, ri) => (ri === row ? r.map((c, ci) => (ci === col ? val : c)) : r)),
    );
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    const seedNum = seed.trim() === '' ? undefined : Number(seed);
    const payload = {
      portfolioId,
      regimes: {
        regimes: preset.regimes,
        regimeReturns: preset.regimeReturns,
        transitionMatrix: matrixPct.map((row) => row.map((c) => cellNumber(c) / 100)),
        initialRegime,
      },
      steps,
      paths,
      ...(seedNum !== undefined && Number.isFinite(seedNum) ? { seed: seedNum } : {}),
    };
    startTransition(async () => {
      try {
        await runRegimeAction(payload);
      } catch (err) {
        if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) throw err;
        const msg = err instanceof Error ? err.message : 'unknown error';
        const match = msg.match(/"message":"([^"]+)"/);
        setError(match ? match[1] : msg);
      }
    });
  }

  if (portfolios.length === 0) {
    return (
      <p className="font-serif italic text-ink-700 max-w-measure">
        No portfolios available yet. Build one and come back.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-x-10 gap-y-12">
      {/* ── Portfolio ─────────────────────────────────────────────────── */}
      <section className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-4">Portfolio</p>
        <div className="divide-y divide-ink-100 border-y border-ink-100">
          {portfolios.map((p) => {
            const checked = p.id === portfolioId;
            return (
              <label key={p.id} className="block cursor-pointer">
                <input
                  type="radio"
                  name="portfolioId"
                  value={p.id}
                  checked={checked}
                  onChange={() => setPortfolioId(p.id)}
                  className="peer sr-only"
                />
                <div
                  className={`border-l-2 pl-6 py-4 transition-colors ${
                    checked ? 'border-editorial' : 'border-transparent hover:border-ink-300'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <p
                      className={`font-display text-xl tracking-tight ${
                        checked ? 'text-editorial' : 'text-ink-900'
                      }`}
                    >
                      {p.name}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-wider text-ink-500">
                      {p.kind === 'system' ? 'Default' : 'Personal'}
                    </p>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── Template ──────────────────────────────────────────────────── */}
      <section className="col-span-12 border-b border-ink-100 pb-10">
        <p className="eyebrow mb-4">Template</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {presets.map((p) => {
            const checked = p.id === presetId;
            return (
              <label key={p.id} className="block cursor-pointer">
                <input
                  type="radio"
                  name="presetId"
                  value={p.id}
                  checked={checked}
                  onChange={() => setPresetId(p.id)}
                  className="peer sr-only"
                />
                <div
                  className={`border p-6 h-full transition-colors ${
                    checked
                      ? 'border-editorial border-l-4'
                      : 'border-ink-100 hover:border-ink-300'
                  }`}
                >
                  <p
                    className={`font-display text-xl tracking-tight ${
                      checked ? 'text-editorial' : 'text-ink-900'
                    }`}
                  >
                    {p.name}
                  </p>
                  <p className="font-serif text-sm text-ink-700 mt-2 leading-relaxed">
                    {p.description}
                  </p>
                  <p className="font-mono text-xs text-ink-500 mt-3">{p.returnSummary}</p>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── Regime list + matrix + params ─────────────────────────────── */}
      <section className="col-span-12 lg:col-span-8 space-y-10">
        <div>
          <p className="eyebrow mb-3">Regimes</p>
          <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
            Monthly μ and σ per regime (read-only from template).
          </p>
          <table className="editorial-table max-w-xl">
            <thead>
              <tr>
                <th>Regime</th>
                <th className="num">μ (Monthly)</th>
                <th className="num">σ (Monthly)</th>
              </tr>
            </thead>
            <tbody>
              {preset.regimes.map((r) => {
                const params = preset.regimeReturns[r]!;
                return (
                  <tr key={r}>
                    <td className="font-serif">{r}</td>
                    <td className="num">{formatPct(params.mu)}</td>
                    <td className="num">{(params.sigma * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <p className="eyebrow mb-3">Transition Matrix</p>
          <p className="font-sans text-xs text-ink-700 mb-4 leading-snug max-w-measure">
            Per-step transition probabilities. Rows must sum to 100%.
          </p>
          <div className="overflow-x-auto">
            <table className="editorial-table text-sm">
              <thead>
                <tr>
                  <th>From / To</th>
                  {preset.regimes.map((r) => (
                    <th key={r} className="num">{r}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preset.regimes.map((rowName, ri) => (
                  <tr key={rowName}>
                    <td className="font-serif">{rowName}</td>
                    {preset.regimes.map((colName, ci) => (
                      <td key={colName} className="num">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={matrixPct[ri]?.[ci] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            // Allow empty (mid-edit) or any integer 0–100;
                            // reject everything else so leading zeros, decimals,
                            // letters, or out-of-range values can't be typed.
                            if (v === '') {
                              setMatrixCell(ri, ci, '');
                              return;
                            }
                            if (!/^(0|[1-9]\d{0,2})$/.test(v)) return;
                            const n = parseInt(v, 10);
                            if (n < 0 || n > 100) return;
                            setMatrixCell(ri, ci, v);
                          }}
                          onBlur={(e) => {
                            // Snap empty back to "0" so calculations behave.
                            if (e.target.value === '') setMatrixCell(ri, ci, '0');
                          }}
                          className="w-20 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-sm py-1 px-0 text-right"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="eyebrow mb-3">Initial Regime</p>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {preset.regimes.map((r) => {
              const checked = r === initialRegime;
              return (
                <label key={r} className="cursor-pointer">
                  <input
                    type="radio"
                    name="initialRegime"
                    value={r}
                    checked={checked}
                    onChange={() => setInitialRegime(r)}
                    className="peer sr-only"
                  />
                  <span
                    className={`font-serif text-base border-b-2 ${
                      checked
                        ? 'text-editorial border-editorial'
                        : 'text-ink-700 border-transparent hover:border-ink-300'
                    }`}
                  >
                    {r}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6 max-w-3xl">
          <div>
            <label htmlFor="steps" className="eyebrow block mb-2">Steps</label>
            <div className="flex items-baseline gap-2">
              <input
                id="steps"
                type="number"
                min={12}
                max={120}
                step={6}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className="w-20 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-lg py-2 px-0 text-right"
              />
              <span className="font-mono text-sm text-ink-500">mo</span>
            </div>
          </div>
          <div>
            <label htmlFor="paths" className="eyebrow block mb-2">Paths</label>
            <input
              id="paths"
              type="number"
              min={500}
              max={50_000}
              step={500}
              value={paths}
              onChange={(e) => setPaths(Number(e.target.value))}
              className="w-32 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-lg py-2 px-0 text-right"
            />
          </div>
          <div>
            <label htmlFor="seed" className="eyebrow block mb-2">Seed</label>
            <input
              id="seed"
              type="number"
              placeholder="random"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="w-32 bg-transparent border-0 border-b border-ink-300 focus:border-editorial focus:outline-none font-mono text-lg py-2 px-0 text-right placeholder:text-ink-300"
            />
            <p className="font-sans text-xs text-ink-700 mt-2">Blank = random.</p>
          </div>
          <hr className="md:col-span-3 mt-5" />
        </div>
      </section>

      <aside className="col-span-12 lg:col-span-4 lg:border-l lg:border-ink-100 lg:pl-10 space-y-8">
        <div>
          <p className="eyebrow mb-3">Row Check</p>
          <ul className="space-y-2">
            {rowSums.map((s, i) => {
              const name = preset.regimes[i] ?? `Row ${i + 1}`;
              const ok = Math.abs(s - 100) <= 0.01;
              return (
                <li key={name} className="font-serif text-sm">
                  {ok ? (
                    <span className="text-ink-700">
                      {name}: <span className="font-mono text-ink-900">{s.toFixed(0)}%</span>
                    </span>
                  ) : (
                    <span className="italic text-editorial">
                      Row {name}: sums to{' '}
                      <span className="font-mono">{s.toFixed(0)}%</span> — must equal 100%
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <hr className="mt-5" />
        </div>

        {error ? <p className="font-serif italic text-editorial text-sm">{error}</p> : null}

        <div>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`font-display text-2xl border-b-2 transition-colors ${
              canSubmit
                ? 'text-editorial border-editorial hover:text-editorial-dark hover:border-editorial-dark'
                : 'text-ink-300 border-ink-300 cursor-not-allowed'
            }`}
          >
            {pending ? 'Running…' : 'Run Scenario →'}
          </button>
        </div>
      </aside>
    </form>
  );
}

function toPctMatrix(m: number[][]): number[][] {
  return m.map((row) => row.map((c) => Math.round(c * 100)));
}

function cellNumber(s: string): number {
  if (s === '') return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function formatPct(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(2)}%`;
}
