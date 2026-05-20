#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { computePublicScore } from '@vantage/core-public';
import { runDcf, runComps, runLbo, blendValuations } from '@vantage/core-private';
import { FmpClient } from '@vantage/data-ingest/public';
import type { LifeStage } from '@vantage/shared';
import { valuePrivateLive } from './commands/value-private-live.js';
import { scorePublicLive } from './commands/score-public-live.js';
import { classifyStatus } from './commands/classify-status.js';
import { portfolioBuild } from './commands/portfolio-build.js';
import { simulate } from './commands/simulate.js';
import { metaBackfill } from './commands/meta-backfill.js';

const program = new Command();
program.name('vantage').description('Vantage admin & batch CLI').version('0.6.0');

// ── score-public --------------------------------------------------------
program
  .command('score-public')
  .description('Compute a Public Score from a JSON inputs file')
  .requiredOption('-f, --file <path>', 'inputs JSON file')
  .action(async (opts) => {
    const raw = await readFile(opts.file, 'utf-8');
    const inputs = JSON.parse(raw);
    const result = computePublicScore(inputs);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  });

// ── value-private -------------------------------------------------------
program
  .command('value-private')
  .description('Compute a blended private valuation from a JSON inputs file')
  .requiredOption('-f, --file <path>', 'inputs JSON file')
  .action(async (opts) => {
    const raw = await readFile(opts.file, 'utf-8');
    const inputs = JSON.parse(raw);
    const methodResults = [];
    if (inputs.dcf) methodResults.push(runDcf(inputs.dcf));
    if (inputs.comps) methodResults.push(runComps(inputs.comps));
    if (inputs.lbo) methodResults.push(runLbo(inputs.lbo));
    const blended = blendValuations(
      inputs.companyId,
      inputs.lifeStage as LifeStage,
      methodResults,
    );
    process.stdout.write(JSON.stringify(blended, null, 2) + '\n');
  });

// ── fetch-fmp -----------------------------------------------------------
program
  .command('fetch-fmp')
  .description('Fetch FMP data for a ticker (profile + earnings + price-target)')
  .requiredOption('-t, --ticker <symbol>', 'ticker symbol')
  .action(async (opts) => {
    const key = process.env.FMP_API_KEY;
    if (!key) {
      process.stderr.write('FMP_API_KEY not set\n');
      process.exit(1);
    }
    const fmp = new FmpClient({ apiKey: key });
    const [profile, earnings, target] = await Promise.all([
      fmp.profile(opts.ticker),
      fmp.earnings(opts.ticker),
      fmp.priceTarget(opts.ticker),
    ]);
    process.stdout.write(JSON.stringify({ profile, earnings, target }, null, 2) + '\n');
  });

// ── value-private-live --------------------------------------------------
program
  .command('value-private-live')
  .description('Run the live private-valuation orchestrator for a seeded company')
  .requiredOption('--company <name>', 'company name (matches infra/seeds/companies.json)')
  .option('--seeds <dir>', 'seeds directory', './infra/seeds')
  .action(async (opts) => {
    await valuePrivateLive({ company: opts.company, seeds: opts.seeds });
  });

// ── score-public-live ---------------------------------------------------
program
  .command('score-public-live')
  .description('Run the live public-scoring orchestrator for any US-listed ticker')
  .requiredOption('-t, --ticker <symbol>', 'ticker symbol')
  .action(async (opts) => {
    await scorePublicLive({ ticker: opts.ticker });
  });

// ── classify-status -----------------------------------------------------
program
  .command('classify-status')
  .description('Read the current classification for an entity (state inspection)')
  .requiredOption('--entity <id-or-ticker>', 'company UUID or ticker')
  .option('-u, --url <url>', 'API base URL', process.env.API_URL ?? 'http://localhost:4000')
  .action(async (opts) => {
    await classifyStatus({ entity: opts.entity, url: opts.url });
  });

// ── portfolio-build -----------------------------------------------------
program
  .command('portfolio-build')
  .description('Build a portfolio from current classifications (system or personal)')
  .option('--name <name>', 'portfolio name (required for kind=personal)')
  .option('--kind <kind>', 'system | personal', 'system')
  .option('--owner <userId>', 'owner user id (required for kind=personal)')
  .action(async (opts) => {
    const kind = opts.kind === 'personal' ? 'personal' : 'system';
    await portfolioBuild({ name: opts.name, kind, owner: opts.owner });
  });

// ── simulate ------------------------------------------------------------
program
  .command('simulate')
  .description('Run a Monte Carlo simulation against a portfolio (direct DB)')
  .requiredOption('--portfolio <portfolioId>', 'portfolio UUID')
  .option('--kind <kind>', 'monte_carlo | scenario_tree | regime_switching', 'monte_carlo')
  .option('--horizon <years>', 'horizon in years', '5')
  .option('--paths <count>', 'simulated paths', '10000')
  .option('--seed <number>', 'seed for deterministic runs')
  .action(async (opts) => {
    const kind = (opts.kind ?? 'monte_carlo') as
      | 'monte_carlo'
      | 'scenario_tree'
      | 'regime_switching';
    await simulate({
      portfolio: opts.portfolio,
      kind,
      horizon: Number(opts.horizon ?? 5),
      paths: Number(opts.paths ?? 10000),
      seed: opts.seed === undefined ? undefined : Number(opts.seed),
    });
  });

// ── meta-backfill -------------------------------------------------------
program
  .command('meta-backfill')
  .description('Run the Phase 8 outcome backfill now (enqueues + waits for the API worker)')
  .action(async () => {
    await metaBackfill();
  });

// ── health --------------------------------------------------------------
program
  .command('health')
  .description('Ping the API gateway')
  .option('-u, --url <url>', 'API base URL', process.env.API_URL ?? 'http://localhost:4000')
  .action(async (opts) => {
    try {
      const resp = await fetch(`${opts.url}/health`);
      const json = await resp.json();
      process.stdout.write(JSON.stringify(json, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(`unreachable: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program.parseAsync();
