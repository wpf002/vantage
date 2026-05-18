/**
 * Regime-switching templates for the picker UI.
 *
 * These are illustrative templates derived from historical market behavior.
 * They're not forecasts. Phase 8 meta-learning may refine parameters from
 * realized outcomes.
 *
 * Each template is a complete RegimeConfig minus paths / steps / seed — the
 * user picks those on the form.
 *
 * μ and σ are MONTHLY (not annual) since the engine's step is one month.
 * Transition rows are stochastic (sum to 1).
 */

export interface RegimePreset {
  id: string;
  name: string;
  description: string;
  /** Short summary of expected return character — shown on the card. */
  returnSummary: string;
  regimes: string[];
  regimeReturns: Record<string, { mu: number; sigma: number }>;
  transitionMatrix: number[][];
  initialRegime: string;
}

export const REGIME_PRESETS: RegimePreset[] = [
  {
    id: 'gfc-2008',
    name: '2008 GFC Pattern',
    description:
      'Pre-crisis bull gives way to a severe drawdown, then a slow recovery. Crash regime is brief but devastating.',
    returnSummary: 'Bull +0.9% / Crash -3.0% / Recovery +1.0%',
    regimes: ['Pre-Crisis Bull', 'Crash', 'Recovery'],
    regimeReturns: {
      'Pre-Crisis Bull': { mu: 0.009, sigma: 0.035 },
      Crash: { mu: -0.03, sigma: 0.08 },
      Recovery: { mu: 0.01, sigma: 0.04 },
    },
    transitionMatrix: [
      // From Pre-Crisis Bull
      [0.94, 0.06, 0.0],
      // From Crash
      [0.0, 0.75, 0.25],
      // From Recovery
      [0.05, 0.05, 0.9],
    ],
    initialRegime: 'Pre-Crisis Bull',
  },
  {
    id: 'covid-2020',
    name: '2020 COVID Pattern',
    description:
      'Pre-pandemic calm, a sharp short drawdown driven by a real-world shock, then a liquidity-fueled rally.',
    returnSummary: 'Pre +0.8% / Drawdown -5.5% / Rally +2.5%',
    regimes: ['Pre-Pandemic', 'Drawdown', 'Liquidity Rally'],
    regimeReturns: {
      'Pre-Pandemic': { mu: 0.008, sigma: 0.03 },
      Drawdown: { mu: -0.055, sigma: 0.1 },
      'Liquidity Rally': { mu: 0.025, sigma: 0.05 },
    },
    transitionMatrix: [
      [0.97, 0.03, 0.0],
      [0.0, 0.5, 0.5],
      [0.05, 0.0, 0.95],
    ],
    initialRegime: 'Pre-Pandemic',
  },
  {
    id: 'long-bull',
    name: 'Long Bull (2009–2019)',
    description:
      'A decade of stable expansion with occasional brief corrections. Most paths stay in bull; corrections are short.',
    returnSummary: 'Bull +0.95% / Correction -1.8%',
    regimes: ['Stable Bull', 'Brief Correction'],
    regimeReturns: {
      'Stable Bull': { mu: 0.0095, sigma: 0.03 },
      'Brief Correction': { mu: -0.018, sigma: 0.05 },
    },
    transitionMatrix: [
      [0.96, 0.04],
      [0.5, 0.5],
    ],
    initialRegime: 'Stable Bull',
  },
  {
    id: 'stagflation-1970s',
    name: 'Stagflation (1970s)',
    description:
      'Low real returns and high volatility under persistent inflation. Stable periods are short-lived; stagflation reasserts.',
    returnSummary: 'Stable +0.6% / Stagflation +0.1%, σ high / Recovery +1.2%',
    regimes: ['Stable', 'Stagflation', 'Recovery'],
    regimeReturns: {
      Stable: { mu: 0.006, sigma: 0.035 },
      Stagflation: { mu: 0.001, sigma: 0.06 },
      Recovery: { mu: 0.012, sigma: 0.04 },
    },
    transitionMatrix: [
      [0.7, 0.25, 0.05],
      [0.1, 0.85, 0.05],
      [0.2, 0.1, 0.7],
    ],
    initialRegime: 'Stable',
  },
];

export function getRegimePreset(id: string): RegimePreset | undefined {
  return REGIME_PRESETS.find((p) => p.id === id);
}
