'use server';

import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { apiServerPost } from '@/lib/api-server';

interface ScenarioNodePayload {
  name: string;
  probability: number;
  impact: number;
  children?: ScenarioNodePayload[];
}

export interface RunScenarioInput {
  portfolioId: string;
  tree: ScenarioNodePayload[];
}

/**
 * Server action — proxies to the authenticated /v1/simulation/run endpoint
 * with session cookies forwarded, then redirects to the result page.
 */
export async function runScenarioAction(input: RunScenarioInput): Promise<void> {
  if (!input.portfolioId) {
    redirect(
      '/simulation/scenario-builder?error=Pick a portfolio first' as Route,
    );
  }
  if (!Array.isArray(input.tree) || input.tree.length === 0) {
    redirect(
      '/simulation/scenario-builder?error=Add at least one outcome' as Route,
    );
  }

  const result = await apiServerPost<{ simulationId: string }>(
    '/v1/simulation/run',
    {
      portfolioId: input.portfolioId,
      kind: 'scenario_tree',
      params: { tree: input.tree },
    },
  );
  redirect(`/simulation/${result.simulationId}` as Route);
}
