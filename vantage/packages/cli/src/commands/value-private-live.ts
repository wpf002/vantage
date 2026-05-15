import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runLivePrivateValuation } from '@vantage/core-private/orchestrator';
import type { LivePrivateValuationConfig } from '@vantage/core-private/orchestrator';
import type { LifeStage } from '@vantage/shared';

/**
 * `vantage value-private-live` — run the live private-valuation orchestrator
 * for a seeded company. Human-readable summary to stderr, full JSON to stdout.
 */

interface CompanyIdentifiers {
  companyId: string;
  companyName: string;
  domain: string;
  githubOrg: string;
  usptoAssignee: string;
  lifeStage: LifeStage;
}

// Mirrors COMPANY_IDENTIFIERS in packages/api/src/routes/private.ts.
const COMPANY_IDENTIFIERS: Record<string, CompanyIdentifiers> = {
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

interface PrivatePeerSet {
  companyName: string;
  peerTickers: string[];
  illiquidityDiscount: number;
  notes: string;
}

const REQUIRED_ENV = ['FMP_API_KEY', 'FRED_API_KEY', 'ANTHROPIC_API_KEY', 'SEC_USER_AGENT'] as const;

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

export async function valuePrivateLive(opts: { company: string; seeds: string }): Promise<void> {
  // Validate env up front so we fail clearly before any network calls.
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    process.stderr.write(`Missing required env vars: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  const ident = Object.values(COMPANY_IDENTIFIERS).find(
    (c) => c.companyName.toLowerCase() === opts.company.toLowerCase(),
  );
  if (!ident) {
    const known = Object.values(COMPANY_IDENTIFIERS)
      .map((c) => `"${c.companyName}"`)
      .join(', ');
    process.stderr.write(`Unknown company "${opts.company}". Known: ${known}\n`);
    process.exit(1);
    return;
  }

  const peerSetsPath = join(opts.seeds, 'peer-sets-private.json');
  let peerSets: PrivatePeerSet[];
  try {
    peerSets = JSON.parse(await readFile(peerSetsPath, 'utf-8')) as PrivatePeerSet[];
  } catch (err) {
    process.stderr.write(
      `Could not read peer sets at ${peerSetsPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
    return;
  }

  const peerSet = peerSets.find((p) => p.companyName === ident.companyName);
  if (!peerSet) {
    process.stderr.write(`No peer set for "${ident.companyName}" in ${peerSetsPath}\n`);
    process.exit(1);
    return;
  }

  const config: LivePrivateValuationConfig = {
    companyId: ident.companyId,
    companyName: ident.companyName,
    domain: ident.domain,
    githubOrg: ident.githubOrg,
    usptoAssignee: ident.usptoAssignee,
    lifeStage: ident.lifeStage,
    peerTickers: peerSet.peerTickers,
    illiquidityDiscount: peerSet.illiquidityDiscount,
    fmpApiKey: process.env.FMP_API_KEY!,
    fredApiKey: process.env.FRED_API_KEY!,
    secUserAgent: process.env.SEC_USER_AGENT!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    ...(process.env.GITHUB_TOKEN ? { githubToken: process.env.GITHUB_TOKEN } : {}),
    ...(process.env.ML_SERVICE_URL ? { mlServiceUrl: process.env.ML_SERVICE_URL } : {}),
    ...(process.env.ML_SERVICE_API_KEY ? { mlApiKey: process.env.ML_SERVICE_API_KEY } : {}),
  };

  process.stderr.write(`\nPulling fresh data for ${ident.companyName} — about 15 seconds...\n\n`);

  const result = await runLivePrivateValuation(config);
  const { inputs, blended } = result;
  const w = blended.weights;

  const lines: string[] = [];
  lines.push(`── ${ident.companyName} · ${ident.lifeStage} ──`);
  lines.push(`Peer set      : ${peerSet.peerTickers.join(', ')} (${inputs.peerMedians.peerCount} valid)`);
  lines.push(
    `Revenue base  : ${inputs.intel.revenueLtmUsd === null ? 'n/a' : fmtUsd(inputs.intel.revenueLtmUsd)}` +
      ` · confidence ${inputs.intel.revenueConfidence}` +
      ` · as of ${inputs.intel.revenueAsOfMonth ?? 'unknown'}`,
  );
  lines.push(
    `Risk-free rate: ${(inputs.macro.riskFreeRate * 100).toFixed(2)}% (FRED DGS10 as of ${inputs.macro.asOf})`,
  );
  lines.push(
    `Peer medians  : beta ${inputs.peerMedians.beta.toFixed(2)} · EV/Rev ${inputs.peerMedians.evToRevenue.toFixed(2)}x` +
      ` · EBITDA margin ${(inputs.peerMedians.ebitdaMargin * 100).toFixed(1)}%`,
  );
  if (inputs.github) {
    lines.push(
      `GitHub        : ${inputs.github.commits90d} commits / ${inputs.github.activeContributors90d} contributors` +
        ` (90d, ${inputs.github.reposScanned} repos)`,
    );
  }
  if (inputs.patents) {
    lines.push(`USPTO         : ${inputs.patents.patentsFiledTrailing12m} patents (trailing 12m)`);
  }
  if (inputs.tranco) {
    lines.push(`Tranco rank   : #${inputs.tranco.currentRank.toLocaleString()}`);
  }
  if (inputs.formD) {
    lines.push(`SEC Form D    : ${inputs.formD.filingsTrailing12m} filings (trailing 12m)`);
  }
  lines.push('');
  lines.push(
    `Valuation     : ${fmtUsd(blended.finalValuation.bear)} bear · ` +
      `${fmtUsd(blended.finalValuation.base)} base · ` +
      `${fmtUsd(blended.finalValuation.bull)} bull`,
  );
  lines.push(`Confidence    : ${(blended.confidence * 100).toFixed(0)}%`);
  lines.push(
    `Method weights: DCF ${(w.dcf * 100).toFixed(0)}% · Comps ${(w.comps * 100).toFixed(0)}% · LBO ${(w.lbo * 100).toFixed(0)}%`,
  );
  if (inputs.engineWarnings.length > 0) {
    lines.push(`Warnings      : ${inputs.engineWarnings.join('; ')}`);
  }
  lines.push('');

  process.stderr.write(lines.join('\n'));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
