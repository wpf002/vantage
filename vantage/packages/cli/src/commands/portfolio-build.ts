/**
 * `vantage portfolio-build` — build a portfolio off current classifications.
 *
 * Two modes:
 *   --kind system    : insert a new "The Default" row (kind='system'). Used
 *                      for first-time setup and on-demand rebuilds without
 *                      waiting for the cron worker.
 *   --kind personal  : build a portfolio owned by --owner <userId>. The
 *                      same engine, the same constraints — just attached to
 *                      a user.
 *
 * Direct DB access. Requires DATABASE_URL.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import {
  buildCandidatesFromClassifications,
  constructPortfolio,
} from '@vantage/portfolio';
import { PortfolioConstraints } from '@vantage/shared';
import { schema, persistPortfolio, rebuildSystemPortfolio } from '@vantage/api/lib';

export interface PortfolioBuildOpts {
  name?: string;
  kind: 'system' | 'personal';
  owner?: string;
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

export async function portfolioBuild(opts: PortfolioBuildOpts): Promise<void> {
  if (opts.kind === 'system') {
    const { db, close } = makeDb();
    try {
      const result = await rebuildSystemPortfolio(db);
      process.stderr.write(
        `\nBuilt system portfolio "${opts.name ?? 'The Default'}"\n` +
          `  portfolioId   : ${result.portfolioId}\n` +
          `  candidates    : ${result.candidateCount}\n` +
          `  allocations   : ${result.allocationCount}\n` +
          `  cash          : ${(result.cashWeight * 100).toFixed(1)}%\n` +
          `  warnings      : ${result.warnings.length === 0 ? 'none' : ''}\n`,
      );
      for (const w of result.warnings) process.stderr.write(`    · ${w}\n`);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } finally {
      await close();
    }
    return;
  }

  // personal
  if (!opts.owner) {
    process.stderr.write('--owner <userId> required for kind=personal\n');
    process.exit(1);
    return;
  }
  if (!opts.name) {
    process.stderr.write('--name <name> required for kind=personal\n');
    process.exit(1);
    return;
  }

  const { db, close } = makeDb();
  try {
    // Verify the user exists so we fail fast with a friendly message rather
    // than blowing up inside the foreign-key constraint.
    const users = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, opts.owner))
      .limit(1);
    if (users.length === 0) {
      process.stderr.write(`user not found: ${opts.owner}\n`);
      process.exit(1);
      return;
    }

    const candidates = await buildCandidatesFromClassifications(db);
    const constraints = PortfolioConstraints.parse({
      maxAssetWeight: 0.1,
      maxSectorWeight: 0.25,
      minCrossSectorCount: 4,
      sleeveTargets: { core: 0.5, growth: 0.25, defensive: 0.15, tactical: 0.1 },
    });
    const result = constructPortfolio(candidates, constraints);
    const { portfolioId } = await persistPortfolio(db, {
      ownerUserId: opts.owner,
      kind: 'personal',
      name: opts.name,
      constraints,
      result,
      candidatesUsed: candidates,
    });

    process.stderr.write(
      `\nBuilt personal portfolio "${opts.name}"\n` +
        `  portfolioId   : ${portfolioId}\n` +
        `  owner         : ${opts.owner}\n` +
        `  candidates    : ${candidates.length}\n` +
        `  allocations   : ${result.allocations.length}\n` +
        `  cash          : ${(result.cashWeight * 100).toFixed(1)}%\n` +
        `  warnings      : ${result.warnings.length === 0 ? 'none' : ''}\n`,
    );
    for (const w of result.warnings) process.stderr.write(`    · ${w}\n`);
    process.stdout.write(JSON.stringify({ portfolioId, result }, null, 2) + '\n');
  } finally {
    await close();
  }
}
