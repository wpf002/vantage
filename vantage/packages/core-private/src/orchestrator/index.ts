import { InsufficientDataError } from '@vantage/shared';
import type { LifeStage, Signal } from '@vantage/shared';
import {
  fetchPeerMedians,
  fetchGitHubVelocity,
  fetchPatentActivity,
  fetchFormDActivity,
  fetchTrancoRank,
  fetchMacroEnvironment,
  fetchCompanyIntel,
} from '@vantage/data-ingest/private';
import type {
  PeerMedians,
  GitHubVelocity,
  PatentActivity,
  FormDActivity,
  TrancoRank,
  MacroEnvironment,
  CompanyIntel,
} from '@vantage/data-ingest/private';
import { runDcf, type DcfInputs } from '../dcf/index.js';
import { runComps, type CompsInputs, type PeerMultiples } from '../comps/index.js';
import { runLbo, type LboInputs } from '../lbo/index.js';
import { blendValuations, blendedValuationToSignal } from '../blend/index.js';
import { requestMlAdjustment } from '../ml-bridge/index.js';
import type { ValuationMethodResult, BlendedValuation } from '../types.js';

/**
 * Live private-valuation orchestrator.
 *
 * Pulls every input fresh on every run — the ONLY manual input is the peer
 * set (the human-intelligence layer). It fans out 7 fetchers in parallel,
 * synthesizes DCF / Comps / LBO inputs from peer medians + macro + the
 * intel-reported revenue, runs the existing engines, blends, optionally
 * applies the ML adjustment, and returns a Signal + the full raw-input
 * snapshot for the audit chain.
 *
 * This is pure library code: no env reads, no persistence. Anyone with the
 * same inputs can replay it.
 */

export interface LivePrivateValuationConfig {
  companyId: string;
  companyName: string;
  domain: string;
  githubOrg?: string;
  usptoAssignee?: string;
  lifeStage: LifeStage;
  peerTickers: string[]; // min 3
  illiquidityDiscount?: number; // default 0.25
  fmpApiKey: string;
  fredApiKey: string;
  githubToken?: string;
  secUserAgent: string;
  anthropicApiKey: string;
  mlServiceUrl?: string;
  mlApiKey?: string;
}

export interface LivePrivateValuationInputs {
  companyId: string;
  companyName: string;
  lifeStage: LifeStage;
  intel: CompanyIntel;
  peerMedians: PeerMedians;
  macro: MacroEnvironment;
  tranco: TrancoRank | null;
  github: GitHubVelocity | null;
  patents: PatentActivity | null;
  formD: FormDActivity | null;
  dcfInputs: DcfInputs | null;
  compsInputs: CompsInputs;
  lboInputs: LboInputs | null;
  engineWarnings: string[];
}

export interface LivePrivateValuationResult {
  blended: BlendedValuation;
  signal: Signal;
  inputs: LivePrivateValuationInputs;
}

const TAX_RATE = 0.21;
const TERMINAL_GROWTH = 0.025;
const WC_PCT_REVENUE = 0.05;
const DEPRECIATION_PCT_REVENUE = 0.04;
const DE_RATIO = 0.1;
const COST_OF_DEBT_SPREAD = 0.025;
const DEFAULT_ILLIQUIDITY_DISCOUNT = 0.25;

function log10Safe(value: number): number {
  return Math.log10(Math.max(1, value));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Build a 5-year growth schedule starting at the peer growth rate, decaying 15%/yr. */
function growthSchedule(peerGrowthLtm: number): number[] {
  const start = Math.max(0.05, peerGrowthLtm);
  const rates: number[] = [];
  let g = start;
  for (let i = 0; i < 5; i += 1) {
    rates.push(g);
    g *= 0.85;
  }
  return rates;
}

export async function runLivePrivateValuation(
  config: LivePrivateValuationConfig,
): Promise<LivePrivateValuationResult> {
  // ── Phase 1: parallel fetch ───────────────────────────────────────────
  // Required sources (intel, peerMedians, macro, tranco) propagate failures.
  // Optional sources (github, patents, formD) degrade to null.
  const [intel, peerMedians, macro, tranco, github, patents, formD] = await Promise.all([
    fetchCompanyIntel(config.companyName, { apiKey: config.anthropicApiKey }),
    fetchPeerMedians(config.peerTickers, config.fmpApiKey),
    fetchMacroEnvironment(config.fredApiKey),
    fetchTrancoRank(config.domain),
    config.githubOrg
      ? fetchGitHubVelocity(config.githubOrg, config.githubToken).catch(() => null)
      : Promise.resolve(null),
    config.usptoAssignee
      ? fetchPatentActivity(config.usptoAssignee).catch(() => null)
      : Promise.resolve(null),
    fetchFormDActivity(config.companyName, config.secUserAgent).catch(() => null),
  ]);

  // ── Phase 2: synthesize engine inputs ─────────────────────────────────
  const illiquidityDiscount = config.illiquidityDiscount ?? DEFAULT_ILLIQUIDITY_DISCOUNT;

  let dcfInputs: DcfInputs | null = null;
  if (intel.revenueLtmUsd === null) {
    throw new InsufficientDataError(
      'dcf',
      `no intel-reported revenue for ${config.companyName} — cannot anchor a cash-flow projection`,
    );
  }
  const revenue = intel.revenueLtmUsd;
  dcfInputs = {
    baseRevenue: revenue,
    revenueGrowthRates: growthSchedule(peerMedians.revenueGrowthLtm),
    ebitdaMargin: peerMedians.ebitdaMargin,
    taxRate: TAX_RATE,
    capexAsPctOfRevenue: Math.min(1, Math.max(0, peerMedians.capexPctRevenue)),
    workingCapitalAsPctOfRevenue: WC_PCT_REVENUE,
    depreciationAsPctOfRevenue: DEPRECIATION_PCT_REVENUE,
    riskFreeRate: macro.riskFreeRate,
    equityRiskPremium: macro.equityRiskPremium,
    beta: peerMedians.beta,
    costOfDebt: macro.riskFreeRate + COST_OF_DEBT_SPREAD,
    debtToEquityRatio: DE_RATIO,
    terminalGrowthRate: TERMINAL_GROWTH,
    netDebt: 0,
  };

  const compsPeers: PeerMultiples[] = peerMedians.snapshots.map((s) => {
    const peer: PeerMultiples = {
      ticker: s.ticker,
      evToRevenue: s.evToRevenue ?? peerMedians.evToRevenue,
    };
    const evToEbitda = s.evToEbitda ?? peerMedians.evToEbitda;
    if (evToEbitda != null) peer.evToEbitda = evToEbitda;
    return peer;
  });
  const compsInputs: CompsInputs = {
    revenueLTM: revenue,
    ebitdaLTM: revenue * peerMedians.ebitdaMargin,
    peers: compsPeers,
    netDebt: 0,
    illiquidityDiscount,
  };

  let lboInputs: LboInputs | null = null;
  const entryEbitda = revenue * peerMedians.ebitdaMargin;
  if (entryEbitda > 0) {
    lboInputs = {
      entryEbitda,
      exitEbitda: entryEbitda * 1.15 ** 5,
      exitMultiple: peerMedians.evToEbitda ?? 18,
      debtToEbitda: 4.5,
      interestRate: 0.085,
      taxRate: TAX_RATE,
      holdYears: 5,
      targetIrr: 0.25,
      capexAsPctOfEbitda: 0.1,
      workingCapitalChangeAsPctOfEbitda: 0.05,
    };
  }

  // ── Phase 3: run engines (per-method failures tolerated) ──────────────
  const methodResults: ValuationMethodResult[] = [];
  const engineWarnings: string[] = [];

  try {
    methodResults.push(runDcf(dcfInputs));
  } catch (err) {
    engineWarnings.push(`dcf failed: ${errMessage(err)}`);
  }
  try {
    methodResults.push(runComps(compsInputs));
  } catch (err) {
    engineWarnings.push(`comps failed: ${errMessage(err)}`);
  }
  if (lboInputs) {
    try {
      methodResults.push(runLbo(lboInputs));
    } catch (err) {
      engineWarnings.push(`lbo failed: ${errMessage(err)}`);
    }
  } else {
    engineWarnings.push('lbo skipped: non-positive entry EBITDA under peer margin');
  }

  if (methodResults.length === 0) {
    throw new InsufficientDataError(
      'private.blended_valuation',
      `every valuation method failed — ${engineWarnings.join('; ')}`,
    );
  }

  // ── Phase 4: optional ML adjustment ───────────────────────────────────
  const preBlend = blendValuations(config.companyId, config.lifeStage, methodResults);
  let mlAdjustment: BlendedValuation['mlAdjustment'];
  if (config.mlServiceUrl) {
    const features: Record<string, number> = {
      web_traffic_yoy_pct: 0,
      google_trends_90d_change: 0,
      tranco_rank_log: tranco?.rankLog ?? 6,
      gh_commits_90d_log: github ? log10Safe(github.commits90d) : 0,
      gh_active_contributors_90d_log: github ? log10Safe(github.activeContributors90d) : 0,
      patents_filed_12m_log: patents ? log10Safe(patents.patentsFiledTrailing12m) : 0,
      patents_granted_12m_log: 0,
      app_dau_90d_change: 0,
      app_installs_90d_log: 0,
      tech_stack_change_score: 0,
      form_d_offerings_12m: formD?.filingsTrailing12m ?? 0,
      form_d_amount_log: 0,
      revenue_growth_ltm: peerMedians.revenueGrowthLtm,
      gross_margin_ltm: peerMedians.ebitdaMargin + 0.2,
      burn_multiple_ltm: 0,
    };
    try {
      mlAdjustment = await requestMlAdjustment(
        {
          companyId: config.companyId,
          preMlValuation: preBlend.preMlValuation.base,
          features,
        },
        { baseUrl: config.mlServiceUrl, apiKey: config.mlApiKey },
      );
    } catch {
      // ML is advisory — a failure here never blocks the valuation.
      mlAdjustment = undefined;
    }
  }

  // ── Phase 5: blend, emit Signal, return with full input snapshot ──────
  const blended = blendValuations(
    config.companyId,
    config.lifeStage,
    methodResults,
    mlAdjustment,
  );
  // blendedValuationToSignal carries weights + mlAdjustment in metadata; enrich
  // with the company / revenue / valuation context the API and UI need to
  // render a run without re-fetching anything.
  const baseSignal = blendedValuationToSignal(blended);
  const signal: Signal = {
    ...baseSignal,
    metadata: {
      ...(baseSignal.metadata ?? {}),
      companyName: config.companyName,
      lifeStage: config.lifeStage,
      finalValuation: blended.finalValuation,
      preMlValuation: blended.preMlValuation,
      revenue: {
        ltmUsd: intel.revenueLtmUsd,
        confidence: intel.revenueConfidence,
        asOfMonth: intel.revenueAsOfMonth,
        source: intel.revenueSource,
      },
      methodResults: blended.methodResults.map((r) => ({
        method: r.method,
        confidence: r.confidence,
        rationale: r.rationale,
        warnings: r.warnings,
      })),
    },
  };

  return {
    blended,
    signal,
    inputs: {
      companyId: config.companyId,
      companyName: config.companyName,
      lifeStage: config.lifeStage,
      intel,
      peerMedians,
      macro,
      tranco,
      github,
      patents,
      formD,
      dcfInputs,
      compsInputs,
      lboInputs,
      engineWarnings,
    },
  };
}
