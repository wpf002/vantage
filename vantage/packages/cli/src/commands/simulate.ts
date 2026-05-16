/**
 * `vantage simulate` — run a Monte Carlo simulation against a portfolio.
 *
 * Direct DB access (requires DATABASE_URL). Scenario tree and regime
 * switching kinds are deferred to the HTTP API for now — the engines exist,
 * but their builder UIs ship in a later phase, and the CLI's purpose is the
 * fast iteration loop on the Monte Carlo path.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import {
  runMonteCarlo,
  MonteCarloInputs,
  computePercentileFan,
  deriveAssetAssumptions,
  type EntityRef,
  type PriceHistoryFetcher,
} from '@vantage/simulation';
import { FmpClient } from '@vantage/data-ingest/public';
import { schema, persistSimulation } from '@vantage/api/lib';

export interface SimulateOpts {
  portfolio: string;
  kind: 'monte_carlo' | 'scenario_tree' | 'regime_switching';
  horizon: number;
  paths: number;
  seed?: number;
}

function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL not set\n');
    process.exit(1);
  }
  const client = postgres(url, { max: 5 });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

function buildPriceHistoryFetcher(): PriceHistoryFetcher | undefined {
  const key = process.env.FMP_API_KEY;
  if (!key) return undefined;
  const fmp = new FmpClient({ apiKey: key });
  return async (ticker, days) => fmp.historicalPrices(ticker, days);
}

export async function simulate(opts: SimulateOpts): Promise<void> {
  if (opts.kind !== 'monte_carlo') {
    process.stderr.write(
      'Only --kind monte_carlo is supported in the CLI for Phase 6. Use the API directly for scenario_tree / regime_switching.\n',
    );
    process.exit(1);
    return;
  }

  const { db, close } = makeDb();
  try {
    // Load portfolio + allocations directly, mirroring portfolioStore.getPortfolioById
    // but without the joined-owner chrome (we don't need email/name here).
    const portfolios = await db
      .select()
      .from(schema.platformPortfolios)
      .where(eq(schema.platformPortfolios.id, opts.portfolio))
      .limit(1);
    if (portfolios.length === 0) {
      process.stderr.write(`portfolio not found: ${opts.portfolio}\n`);
      process.exit(1);
      return;
    }
    const portfolio = portfolios[0]!;

    const allocRows = await db
      .select()
      .from(schema.platformAllocations)
      .where(eq(schema.platformAllocations.portfolioId, opts.portfolio));
    if (allocRows.length === 0) {
      process.stderr.write('portfolio has no allocations\n');
      process.exit(1);
      return;
    }

    // Resolve company chrome (ticker + marketType) by joining to platform_companies
    // both by UUID (private) and ticker (public).
    const companyRows = await db.select().from(schema.platformCompanies);
    const byId = new Map(companyRows.map((c) => [c.id, c]));
    const byTicker = new Map(
      companyRows.filter((c) => c.ticker).map((c) => [c.ticker as string, c]),
    );

    const entities: EntityRef[] = allocRows.map((a) => {
      const company = byId.get(a.entity) ?? byTicker.get(a.entity);
      return {
        entity: a.entity,
        name: a.name,
        sector: a.sector,
        ticker: company?.ticker ?? null,
        marketType: company?.marketType ?? null,
        lifeStage: company?.lifeStage ?? null,
      };
    });

    const assumptions = await deriveAssetAssumptions(db, entities, {
      priceHistory: buildPriceHistoryFetcher(),
    });

    const allocations = allocRows.map((a) => ({ entity: a.entity, weight: a.weight }));
    const mcInputs = MonteCarloInputs.parse({
      allocations,
      assumptions,
      horizonYears: opts.horizon,
      paths: opts.paths,
      seed: opts.seed,
    });
    const result = runMonteCarlo(mcInputs);
    const fan = computePercentileFan({
      allocations,
      assumptions,
      horizonYears: opts.horizon,
      paths: opts.paths,
      seed: opts.seed,
    });

    const persisted = await persistSimulation(db, {
      portfolioId: portfolio.id,
      kind: 'monte_carlo',
      inputs: {
        portfolioId: portfolio.id,
        horizonYears: opts.horizon,
        paths: opts.paths,
        seed: opts.seed ?? null,
        assumptions,
      },
      outputs: { result, fan },
      seed: opts.seed ?? null,
      assumptions,
      summary: `CLI: MC ${opts.paths}p / ${opts.horizon}y, median ${(result.percentiles.p50 * 100).toFixed(1)}%`,
    });

    const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

    process.stderr.write(
      `\nMonte Carlo: ${portfolio.name}\n` +
        `  simulationId  : ${persisted.simulationId}\n` +
        `  signalId      : ${persisted.signalId}\n` +
        `  horizon       : ${opts.horizon}y\n` +
        `  paths         : ${opts.paths.toLocaleString()}\n` +
        `  seed          : ${opts.seed ?? 'random'}\n` +
        `  E[r]          : ${pct(result.expectedReturn)}\n` +
        `  P(loss)       : ${(result.probabilityOfLoss * 100).toFixed(1)}%\n` +
        `  Worst 5%      : ${pct(result.percentiles.p05)}\n` +
        `  Worst 25%     : ${pct(result.percentiles.p25)}\n` +
        `  Median        : ${pct(result.percentiles.p50)}\n` +
        `  Best 25%      : ${pct(result.percentiles.p75)}\n` +
        `  Best 5%       : ${pct(result.percentiles.p95)}\n`,
    );

    process.stdout.write(
      JSON.stringify(
        {
          simulationId: persisted.simulationId,
          signalId: persisted.signalId,
          portfolio: { id: portfolio.id, name: portfolio.name },
          inputs: {
            horizonYears: opts.horizon,
            paths: opts.paths,
            seed: opts.seed ?? null,
            assumptions,
          },
          outputs: { result, fan },
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await close();
  }
}
