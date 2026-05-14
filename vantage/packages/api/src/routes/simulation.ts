import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  runMonteCarlo,
  MonteCarloInputs,
  evaluateScenarioTree,
  runRegimeSwitching,
  RegimeConfig,
  monteCarloToSignal,
} from '@vantage/simulation';
import { harmonize } from '@vantage/harmonizer';
import { z } from 'zod';

const ScenarioNodeIn: any = z.object({
  name: z.string(),
  probability: z.number().min(0).max(1),
  impact: z.number(),
  children: z.array(z.lazy(() => ScenarioNodeIn)).optional(),
});

export const simulationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/monte-carlo', { schema: { body: MonteCarloInputs } }, async (req) => {
    const result = runMonteCarlo(req.body);
    const signal = harmonize(monteCarloToSignal(req.body.allocations[0]?.entity ?? 'portfolio', result));
    return { result, signal };
  });

  app.post(
    '/scenario',
    { schema: { body: z.object({ roots: z.array(ScenarioNodeIn) }) } },
    async (req) => evaluateScenarioTree(req.body.roots as any),
  );

  app.post('/regime', { schema: { body: RegimeConfig } }, async (req) =>
    runRegimeSwitching(req.body),
  );
};
