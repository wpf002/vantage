'use server';

import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { apiServerPost } from '@/lib/api-server';

export interface RunRegimeInput {
  portfolioId: string;
  regimes: {
    regimes: string[];
    regimeReturns: Record<string, { mu: number; sigma: number }>;
    transitionMatrix: number[][];
    initialRegime: string;
  };
  steps: number;
  paths: number;
  seed?: number;
}

export async function runRegimeAction(input: RunRegimeInput): Promise<void> {
  if (!input.portfolioId) {
    redirect('/simulation/regime-builder?error=Pick a portfolio first' as Route);
  }
  const result = await apiServerPost<{ simulationId: string }>('/v1/simulation/run', {
    portfolioId: input.portfolioId,
    kind: 'regime_switching',
    params: {
      steps: input.steps,
      paths: input.paths,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      regimes: input.regimes,
    },
  });
  redirect(`/simulation/${result.simulationId}` as Route);
}
