import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundError, ValidationError } from '@vantage/shared';
import type { LifeStage } from '@vantage/shared';
import type { LivePrivateValuationConfig } from '@vantage/core-private/orchestrator';

/**
 * Shared config for the live private-valuation orchestrator.
 *
 * Both the POST /v1/private/value-live route and the Phase 8 outcome-backfill
 * worker need to assemble a LivePrivateValuationConfig for a known company.
 * This is the single source of truth for the per-company identifiers and the
 * peer-set lookup so the two paths can never drift.
 *
 * The human-intelligence layer (which companies we cover, their handles, and
 * their peer baskets) lives here and in infra/seeds/peer-sets-private.json.
 */

export interface CompanyIdentifiers {
  companyId: string;
  companyName: string; // must match infra/seeds/companies.json
  domain: string;
  githubOrg: string;
  usptoAssignee: string;
  lifeStage: LifeStage;
}

export const COMPANY_IDENTIFIERS: Record<string, CompanyIdentifiers> = {
  anthropic: {
    companyId: 'anthropic',
    companyName: 'Anthropic, PBC',
    domain: 'anthropic.com',
    githubOrg: 'anthropics',
    usptoAssignee: 'Anthropic, PBC',
    lifeStage: 'series_c_plus',
  },
  stripe: {
    companyId: 'stripe',
    companyName: 'Stripe, Inc.',
    domain: 'stripe.com',
    githubOrg: 'stripe',
    usptoAssignee: 'Stripe, Inc.',
    lifeStage: 'pre_ipo',
  },
  databricks: {
    companyId: 'databricks',
    companyName: 'Databricks, Inc.',
    domain: 'databricks.com',
    githubOrg: 'databricks',
    usptoAssignee: 'Databricks, Inc.',
    lifeStage: 'pre_ipo',
  },
};

export interface PrivatePeerSet {
  companyName: string;
  peerTickers: string[];
  illiquidityDiscount: number;
  notes: string;
}

// Load the peer sets once at module init, then serve from memory.
export const PEER_SETS: PrivatePeerSet[] = (() => {
  try {
    const path = join(process.cwd(), '../../infra/seeds/peer-sets-private.json');
    return JSON.parse(readFileSync(path, 'utf-8')) as PrivatePeerSet[];
  } catch {
    return [];
  }
})();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ValidationError(`server misconfigured: ${name} is not set`);
  return value;
}

export function getCompanyIdentifiers(companyId: string): CompanyIdentifiers | null {
  return COMPANY_IDENTIFIERS[companyId.toLowerCase()] ?? null;
}

/**
 * Build the full live-valuation config for a covered company. Throws
 * NotFoundError if the company or its peer set is unknown, and ValidationError
 * if a required upstream API key is unset. Callers that must not crash on a
 * misconfig (the worker) should catch and degrade.
 */
export function buildPrivateValuationConfig(companyId: string): {
  ident: CompanyIdentifiers;
  config: LivePrivateValuationConfig;
} {
  const ident = getCompanyIdentifiers(companyId);
  if (!ident) throw new NotFoundError('company identifiers', companyId);

  const peerSet = PEER_SETS.find((p) => p.companyName === ident.companyName);
  if (!peerSet) throw new NotFoundError('peer set', ident.companyName);

  const config: LivePrivateValuationConfig = {
    companyId: ident.companyId,
    companyName: ident.companyName,
    domain: ident.domain,
    githubOrg: ident.githubOrg,
    usptoAssignee: ident.usptoAssignee,
    lifeStage: ident.lifeStage,
    peerTickers: peerSet.peerTickers,
    illiquidityDiscount: peerSet.illiquidityDiscount,
    fmpApiKey: requireEnv('FMP_API_KEY'),
    fredApiKey: requireEnv('FRED_API_KEY'),
    secUserAgent: requireEnv('SEC_USER_AGENT'),
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
    ...(process.env.GITHUB_TOKEN ? { githubToken: process.env.GITHUB_TOKEN } : {}),
    ...(process.env.ML_SERVICE_URL ? { mlServiceUrl: process.env.ML_SERVICE_URL } : {}),
    ...(process.env.ML_SERVICE_API_KEY ? { mlApiKey: process.env.ML_SERVICE_API_KEY } : {}),
  };
  return { ident, config };
}
