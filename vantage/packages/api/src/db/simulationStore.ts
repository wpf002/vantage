import { desc, eq } from 'drizzle-orm';
import { ENGINE_VERSIONS, type Signal } from '@vantage/shared';
import type {
  MonteCarloResult,
  ScenarioResult,
  RegimeResult,
  FanPoint,
  AssumptionWithSource,
} from '@vantage/simulation';
import { schema, type DB } from './client.js';
import { persistSignal } from './signalStore.js';

/**
 * Persistence for Phase 6 simulation runs.
 *
 * Each run writes:
 *   1. A platform_simulations row (full inputs + outputs blob, optional seed)
 *   2. A platform.simulation_outcome Signal (so harmonize → classification fires)
 *   3. A platform_decisions row (decisionType='simulation') for Phase 8 meta-learning
 *
 * The Signal is the bridge into the existing pipeline — by emitting through
 * persistSignal we keep the harmonize/classify chain consistent with every
 * other engine output.
 */

export type SimulationKind = 'monte_carlo' | 'scenario_tree' | 'regime_switching';

export interface MonteCarloOutputsBlob {
  result: MonteCarloResult;
  fan: FanPoint[];
}

export interface PersistSimulationParams {
  portfolioId: string | null;
  kind: SimulationKind;
  inputs: unknown;
  outputs: unknown;
  seed?: number | null;
  ranByUserId?: string | null;
  /** Asset assumptions used for the run — persisted on the inputs blob. */
  assumptions?: AssumptionWithSource[];
  /** Free-form summary string for the decision log. */
  summary?: string;
}

export interface PersistSimulationResult {
  simulationId: string;
  signalId: string;
  decisionId: string;
}

export async function persistSimulation(
  db: DB,
  params: PersistSimulationParams,
): Promise<PersistSimulationResult> {
  const [simRow] = await db
    .insert(schema.platformSimulations)
    .values({
      portfolioId: params.portfolioId,
      kind: params.kind,
      inputs: params.inputs as object,
      outputs: params.outputs as object,
      seed: params.seed ?? null,
    })
    .returning({ id: schema.platformSimulations.id });
  const simulationId = simRow!.id;

  const signal = buildOutcomeSignal(params, simulationId);
  const signalId = await persistSignal(db, signal);

  const [decisionRow] = await db
    .insert(schema.platformDecisions)
    .values({
      entity: params.portfolioId ?? params.ranByUserId ?? 'system',
      decisionType: 'simulation',
      decisionPayload: {
        simulationId,
        portfolioId: params.portfolioId,
        kind: params.kind,
        inputs: params.inputs,
        summary: params.summary ?? null,
        ranByUserId: params.ranByUserId ?? null,
      },
      outcomePayload: null,
    })
    .returning({ id: schema.platformDecisions.id });
  const decisionId = decisionRow!.id;

  return { simulationId, signalId, decisionId };
}

function buildOutcomeSignal(
  params: PersistSimulationParams,
  simulationId: string,
): Signal {
  const entity = params.portfolioId ?? 'portfolio';
  const ts = new Date().toISOString();

  if (params.kind === 'monte_carlo') {
    const outputs = params.outputs as MonteCarloOutputsBlob;
    const r = outputs.result;
    return {
      entity,
      timestamp: ts,
      signalType: 'platform.simulation_outcome',
      direction: r.expectedReturn > 0 ? 'bullish' : 'bearish',
      magnitude: Math.min(1, Math.abs(r.expectedReturn)),
      confidence: 1 - r.probabilityOfLoss,
      sourceVersion: ENGINE_VERSIONS.SIMULATION,
      transformChain: [
        {
          op: 'platform.simulation.monte_carlo',
          inputs: { pathsRun: r.pathsRun, simulationId },
          output: {
            expectedReturn: r.expectedReturn,
            percentiles: r.percentiles,
            probabilityOfLoss: r.probabilityOfLoss,
          },
          ts,
        },
      ],
      rationale: `Monte Carlo: E[r]=${(r.expectedReturn * 100).toFixed(1)}%, P(loss)=${(r.probabilityOfLoss * 100).toFixed(1)}%, ${r.pathsRun} paths.`,
      metadata: { percentiles: r.percentiles, simulationId, kind: params.kind },
    };
  }

  if (params.kind === 'scenario_tree') {
    const outputs = params.outputs as ScenarioResult;
    return {
      entity,
      timestamp: ts,
      signalType: 'platform.simulation_outcome',
      direction: outputs.expectedImpact > 1 ? 'bullish' : 'bearish',
      magnitude: Math.min(1, Math.abs(outputs.expectedImpact - 1)),
      confidence: 0.5,
      sourceVersion: ENGINE_VERSIONS.SIMULATION,
      transformChain: [
        {
          op: 'platform.simulation.scenario_tree',
          inputs: { simulationId, leafCount: outputs.pathOutcomes.length },
          output: { expectedImpact: outputs.expectedImpact },
          ts,
        },
      ],
      rationale: `Scenario tree: E[impact]=${outputs.expectedImpact.toFixed(3)} across ${outputs.pathOutcomes.length} leaves.`,
      metadata: { simulationId, kind: params.kind },
    };
  }

  // regime_switching
  const outputs = params.outputs as RegimeResult;
  return {
    entity,
    timestamp: ts,
    signalType: 'platform.simulation_outcome',
    direction: outputs.expectedReturn > 0 ? 'bullish' : 'bearish',
    magnitude: Math.min(1, Math.abs(outputs.expectedReturn)),
    confidence: 0.5,
    sourceVersion: ENGINE_VERSIONS.SIMULATION,
    transformChain: [
      {
        op: 'platform.simulation.regime_switching',
        inputs: { simulationId, pathsRun: outputs.pathsRun },
        output: {
          expectedReturn: outputs.expectedReturn,
          regimeOccupancy: outputs.regimeOccupancy,
        },
        ts,
      },
    ],
    rationale: `Regime switching: E[r]=${(outputs.expectedReturn * 100).toFixed(1)}%, ${outputs.pathsRun} paths.`,
    metadata: { simulationId, kind: params.kind, regimeOccupancy: outputs.regimeOccupancy },
  };
}

export interface SimulationRow {
  id: string;
  portfolioId: string | null;
  kind: SimulationKind;
  inputs: unknown;
  outputs: unknown;
  seed: number | null;
  runAt: string;
}

export async function getSimulationById(
  db: DB,
  simulationId: string,
): Promise<SimulationRow | null> {
  const rows = await db
    .select()
    .from(schema.platformSimulations)
    .where(eq(schema.platformSimulations.id, simulationId))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: r.id,
    portfolioId: r.portfolioId,
    kind: r.kind as SimulationKind,
    inputs: r.inputs,
    outputs: r.outputs,
    seed: r.seed,
    runAt: r.runAt.toISOString(),
  };
}

export interface PortfolioSimulationListItem {
  id: string;
  kind: SimulationKind;
  seed: number | null;
  runAt: string;
  // Pulled from the outputs blob for the index view — null when the blob shape
  // doesn't match what we expect (forward-compat with future kinds).
  summary: {
    horizonYears: number | null;
    paths: number | null;
    median: number | null;
    probabilityOfLoss: number | null;
  };
}

export async function listPortfolioSimulations(
  db: DB,
  portfolioId: string,
  limit = 50,
): Promise<PortfolioSimulationListItem[]> {
  const rows = await db
    .select()
    .from(schema.platformSimulations)
    .where(eq(schema.platformSimulations.portfolioId, portfolioId))
    .orderBy(desc(schema.platformSimulations.runAt))
    .limit(limit);

  return rows.map((r) => {
    const summary = summarizeForList(r.kind as SimulationKind, r.inputs, r.outputs);
    return {
      id: r.id,
      kind: r.kind as SimulationKind,
      seed: r.seed,
      runAt: r.runAt.toISOString(),
      summary,
    };
  });
}

function summarizeForList(
  kind: SimulationKind,
  inputs: unknown,
  outputs: unknown,
): PortfolioSimulationListItem['summary'] {
  const empty = { horizonYears: null, paths: null, median: null, probabilityOfLoss: null };
  if (kind === 'monte_carlo') {
    const inp = inputs as { horizonYears?: number; paths?: number } | null;
    const out = outputs as MonteCarloOutputsBlob | null;
    return {
      horizonYears: inp?.horizonYears ?? null,
      paths: inp?.paths ?? out?.result.pathsRun ?? null,
      median: out?.result.percentiles?.p50 ?? null,
      probabilityOfLoss: out?.result.probabilityOfLoss ?? null,
    };
  }
  if (kind === 'regime_switching') {
    const inp = inputs as { steps?: number; paths?: number } | null;
    const out = outputs as RegimeResult | null;
    return {
      horizonYears: inp?.steps ? Math.round(inp.steps / 12) : null,
      paths: inp?.paths ?? out?.pathsRun ?? null,
      median: out?.expectedReturn ?? null,
      probabilityOfLoss: null,
    };
  }
  return empty;
}
