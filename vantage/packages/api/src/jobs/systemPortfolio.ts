import pino from 'pino';
import {
  buildCandidatesFromClassifications,
  constructPortfolio,
} from '@vantage/portfolio';
import { PortfolioConstraints } from '@vantage/shared';
import type { DB } from '../db/client.js';
import { persistPortfolio } from '../db/portfolioStore.js';

/**
 * Rebuilds the system-curated standing portfolio ("The Default") from current
 * classifications.
 *
 * Append-only by design — every run inserts a new platform_portfolios row
 * with kind='system'. The GET /v1/portfolios/system endpoint returns the
 * most recent kind='system' row, so the latest wins automatically and
 * historical versions are retained for the decision log.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.system-portfolio' });

const SYSTEM_PORTFOLIO_NAME = 'Default';

export interface RebuildSystemPortfolioResult {
  portfolioId: string;
  candidateCount: number;
  allocationCount: number;
  cashWeight: number;
  warnings: string[];
}

export async function rebuildSystemPortfolio(db: DB): Promise<RebuildSystemPortfolioResult> {
  const candidates = await buildCandidatesFromClassifications(db);
  const constraints = PortfolioConstraints.parse({
    maxAssetWeight: 0.1,
    maxSectorWeight: 0.25,
    minCrossSectorCount: 4,
    sleeveTargets: { core: 0.5, growth: 0.25, defensive: 0.15, tactical: 0.1 },
  });
  const result = constructPortfolio(candidates, constraints);

  const { portfolioId } = await persistPortfolio(db, {
    ownerUserId: null,
    kind: 'system',
    name: SYSTEM_PORTFOLIO_NAME,
    constraints,
    result,
    candidatesUsed: candidates,
  });

  log.info(
    {
      portfolioId,
      candidates: candidates.length,
      allocations: result.allocations.length,
      cashWeight: result.cashWeight,
      warnings: result.warnings,
    },
    'system portfolio: rebuilt',
  );

  return {
    portfolioId,
    candidateCount: candidates.length,
    allocationCount: result.allocations.length,
    cashWeight: result.cashWeight,
    warnings: result.warnings,
  };
}
