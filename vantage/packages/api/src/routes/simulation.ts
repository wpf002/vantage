import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  runMonteCarlo,
  MonteCarloInputs,
  evaluateScenarioTree,
  runRegimeSwitching,
  RegimeConfig,
  monteCarloToSignal,
  deriveAssetAssumptions,
  computePercentileFan,
  type EntityRef,
  type AssumptionWithSource,
  type PriceHistoryFetcher,
} from '@vantage/simulation';
import { harmonize } from '@vantage/harmonizer';
import { FmpClient } from '@vantage/data-ingest/public';
import {
  UnauthorizedError,
  InsufficientDataError,
  NotFoundError,
  AuthorizationError,
} from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { getPortfolioById } from '../db/portfolioStore.js';
import {
  persistSimulation,
  getSimulationById,
  listPortfolioSimulations,
  type SimulationKind,
} from '../db/simulationStore.js';

async function findSignalIdForSimulation(simulationId: string): Promise<string | null> {
  const rows = await db
    .select({ id: schema.platformSignals.id })
    .from(schema.platformSignals)
    .where(
      and(
        eq(schema.platformSignals.signalType, 'platform.simulation_outcome'),
        sql`${schema.platformSignals.metadata}->>'simulationId' = ${simulationId}`,
      ),
    )
    .orderBy(desc(schema.platformSignals.timestamp))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Simulation routes.
 *
 *   Stateless engine routes (Phase 1, unchanged contract):
 *     POST /v1/simulation/monte-carlo
 *     POST /v1/simulation/scenario
 *     POST /v1/simulation/regime
 *
 *   Portfolio-aware (Phase 6, authenticated):
 *     POST /v1/simulation/run
 *     GET  /v1/simulation/:id
 *     GET  /v1/simulation/portfolio/:portfolioId
 *
 * The Phase-6 routes load the portfolio's allocations, derive per-asset
 * assumptions via the simulation package, run the requested engine, persist
 * the run, and return the simulationId so the UI can redirect to
 * /simulation/[id].
 */

const ScenarioNodeIn: z.ZodType<{
  name: string;
  probability: number;
  impact: number;
  children?: unknown[];
}> = z.object({
  name: z.string(),
  probability: z.number().min(0).max(1),
  impact: z.number(),
  children: z.array(z.lazy(() => ScenarioNodeIn)).optional(),
});

const RunParams = z.object({
  horizonYears: z.number().int().min(1).max(30).optional(),
  paths: z.number().int().min(100).max(100_000).optional(),
  seed: z.number().int().optional(),
  steps: z.number().int().min(1).max(120).optional(),
  regimes: RegimeConfig.partial().optional(),
  tree: z.array(ScenarioNodeIn).optional(),
});

const RunBody = z.object({
  portfolioId: z.string().uuid(),
  kind: z.enum(['monte_carlo', 'scenario_tree', 'regime_switching']),
  params: RunParams.optional(),
});

const IdParams = z.object({ id: z.string().uuid() });
const PortfolioIdParams = z.object({ portfolioId: z.string().uuid() });

function requireUser(req: { user: { id: string; email: string; name: string | null } | null }) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

function authorizePortfolio(
  portfolio: { kind: 'system' | 'personal' | 'published'; ownerUserId: string | null },
  userId: string,
): void {
  if (portfolio.kind === 'personal' && portfolio.ownerUserId !== userId) {
    throw new AuthorizationError('not allowed');
  }
}

function buildPriceHistoryFetcher(): PriceHistoryFetcher | undefined {
  const key = process.env.FMP_API_KEY;
  if (!key) return undefined;
  const fmp = new FmpClient({ apiKey: key });
  return async (ticker, days) => fmp.historicalPrices(ticker, days);
}

export const simulationRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Stateless engine endpoints (kept for direct engine testing) ────────
  app.post('/monte-carlo', { schema: { body: MonteCarloInputs } }, async (req) => {
    const result = runMonteCarlo(req.body);
    const signal = harmonize(
      monteCarloToSignal(req.body.allocations[0]?.entity ?? 'portfolio', result),
    );
    return { result, signal };
  });

  app.post(
    '/scenario',
    { schema: { body: z.object({ roots: z.array(ScenarioNodeIn) }) } },
    async (req) => evaluateScenarioTree(req.body.roots as Parameters<typeof evaluateScenarioTree>[0]),
  );

  app.post('/regime', { schema: { body: RegimeConfig } }, async (req) =>
    runRegimeSwitching(req.body),
  );

  // ── Portfolio-aware: run + persist ─────────────────────────────────────
  app.post('/run', { schema: { body: RunBody } }, async (req, reply) => {
    const user = requireUser(req);

    const portfolio = await getPortfolioById(db, req.body.portfolioId);
    if (!portfolio) throw new NotFoundError('portfolio', req.body.portfolioId);
    authorizePortfolio(portfolio, user.id);

    const kind: SimulationKind = req.body.kind;
    const params = req.body.params ?? {};

    if (portfolio.allocations.length === 0) {
      throw new InsufficientDataError('simulation', 'portfolio has no allocations');
    }

    // Derive per-asset μ/σ from the allocation roster. The simulation package
    // hits the DB only — the FMP price-history branch is an optional callback
    // wired here so the engine stays free of HTTP concerns.
    const entities: EntityRef[] = portfolio.allocations.map((a) => ({
      entity: a.entity,
      name: a.name,
      sector: a.sector,
      ticker: a.ticker,
      marketType: a.marketType,
    }));
    let assumptions: AssumptionWithSource[];
    try {
      assumptions = await deriveAssetAssumptions(db, entities, {
        priceHistory: buildPriceHistoryFetcher(),
      });
    } catch (err) {
      app.log.error({ err }, 'failed to derive asset assumptions');
      throw new InsufficientDataError(
        'simulation',
        'unable to derive per-asset assumptions for this portfolio',
      );
    }

    const allocations = portfolio.allocations.map((a) => ({
      entity: a.entity,
      weight: a.weight,
    }));

    if (kind === 'monte_carlo') {
      const horizonYears = params.horizonYears ?? 5;
      const paths = params.paths ?? 10_000;
      const seed = params.seed;
      const mcInputs = MonteCarloInputs.parse({
        allocations,
        assumptions,
        horizonYears,
        paths,
        seed,
      });
      const result = runMonteCarlo(mcInputs);
      const fan = computePercentileFan({ allocations, assumptions, horizonYears, paths, seed });

      const persisted = await persistSimulation(db, {
        portfolioId: portfolio.id,
        kind,
        inputs: {
          portfolioId: portfolio.id,
          horizonYears,
          paths,
          seed,
          assumptions,
        },
        outputs: { result, fan },
        seed: seed ?? null,
        ranByUserId: user.id,
        assumptions,
        summary: `MC ${paths}p / ${horizonYears}y, median ${(result.percentiles.p50 * 100).toFixed(1)}%`,
      });

      return reply.send({
        simulationId: persisted.simulationId,
        signalId: persisted.signalId,
        outputs: { result, fan },
      });
    }

    if (kind === 'scenario_tree') {
      if (!params.tree || params.tree.length === 0) {
        throw new InsufficientDataError('simulation', 'scenario tree requires a non-empty tree');
      }
      const result = evaluateScenarioTree(
        params.tree as Parameters<typeof evaluateScenarioTree>[0],
      );
      const persisted = await persistSimulation(db, {
        portfolioId: portfolio.id,
        kind,
        inputs: { portfolioId: portfolio.id, tree: params.tree, assumptions },
        outputs: result,
        ranByUserId: user.id,
        assumptions,
        summary: `Scenario tree, ${result.pathOutcomes.length} leaves`,
      });
      return reply.send({
        simulationId: persisted.simulationId,
        signalId: persisted.signalId,
        outputs: result,
      });
    }

    // regime_switching
    if (!params.regimes) {
      throw new InsufficientDataError(
        'simulation',
        'regime switching requires a regimes config',
      );
    }
    const cfg = RegimeConfig.parse({
      ...params.regimes,
      steps: params.steps ?? params.regimes.steps ?? 60,
      paths: params.paths ?? params.regimes.paths ?? 5_000,
      seed: params.seed ?? params.regimes.seed,
    });
    const result = runRegimeSwitching(cfg);
    const persisted = await persistSimulation(db, {
      portfolioId: portfolio.id,
      kind,
      inputs: { portfolioId: portfolio.id, regimes: cfg, assumptions },
      outputs: result,
      seed: cfg.seed ?? null,
      ranByUserId: user.id,
      assumptions,
      summary: `Regime switching, ${cfg.paths} paths`,
    });
    return reply.send({
      simulationId: persisted.simulationId,
      signalId: persisted.signalId,
      outputs: result,
    });
  });

  // ── Read one ───────────────────────────────────────────────────────────
  app.get('/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const sim = await getSimulationById(db, req.params.id);
    if (!sim) return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });

    const signalId = await findSignalIdForSimulation(sim.id);

    if (sim.portfolioId) {
      const portfolio = await getPortfolioById(db, sim.portfolioId);
      if (!portfolio) return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
      if (portfolio.kind === 'personal') {
        if (!req.user || req.user.id !== portfolio.ownerUserId) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
        }
      }
      return {
        ...sim,
        signalId,
        portfolio: {
          id: portfolio.id,
          name: portfolio.name,
          kind: portfolio.kind,
          slug: portfolio.slug,
          asOf: portfolio.asOf,
        },
      };
    }
    return { ...sim, signalId };
  });

  // ── List by portfolio ──────────────────────────────────────────────────
  app.get(
    '/portfolio/:portfolioId',
    { schema: { params: PortfolioIdParams } },
    async (req, reply) => {
      const portfolio = await getPortfolioById(db, req.params.portfolioId);
      if (!portfolio) return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
      if (portfolio.kind === 'personal') {
        if (!req.user || req.user.id !== portfolio.ownerUserId) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
        }
      }
      const rows = await listPortfolioSimulations(db, portfolio.id);
      return rows;
    },
  );
};
