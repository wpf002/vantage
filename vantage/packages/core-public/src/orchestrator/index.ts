import { InsufficientDataError } from '@vantage/shared';
import type { Signal } from '@vantage/shared';
import { FmpClient, fetchAllPublicData } from '@vantage/data-ingest/public';
import type { PublicDataBundle, FmpEarning } from '@vantage/data-ingest/public';
import { computePublicScore, publicScoreToSignal, type PublicScoreResult } from '../score.js';
import { PublicLabelMeta, type PublicLabel } from '../labels.js';
import type { EgsInputs } from '../egs/index.js';
import type { NisInputs, SegmentDatum } from '../nis/index.js';
import type { NhsInputs } from '../nhs/index.js';

/**
 * Live public-scoring orchestrator — the public-side analog of
 * `runLivePrivateValuation`.
 *
 * Every input is pulled fresh from FMP on every run; there are no hand-tuned
 * assumptions and nothing is cached. It fans out the eight FMP calls in
 * parallel, synthesizes the EGS / NIS / NHS engine inputs, runs the existing
 * `computePublicScore`, emits a Signal, and returns the full raw-input
 * snapshot for audit-chain reconstruction.
 *
 * Pure library code: no env reads, no persistence. Anyone with the same
 * inputs can replay it.
 */

export interface LivePublicScoreConfig {
  ticker: string;
  fmpApiKey: string;
  /** Reserved for Phase 3.5 — currently unused on the public side. */
  mlServiceUrl?: string;
}

export interface LivePublicScoreResult {
  result: PublicScoreResult;
  signal: Signal;
  inputs: PublicDataBundle;
}

/** Surprise percentages are clamped to avoid divide-by-tiny blow-ups. */
const SURPRISE_CLAMP = 5;

/**
 * v1 narrative-segment heuristic. TODO(Phase 10): replace with LLM-driven
 * narrative tagging — for Phase 3 this stays a deterministic rule.
 */
const HEURISTIC_NOTE =
  'v1 rule-based narrative tagging: largest fast-growing segment (growth > 2x ' +
  'company-wide rate), else largest segment by revenue share. ' +
  'TODO(Phase 10): LLM-driven narrative tagging.';

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[mid - 1]! + v[mid]!) / 2 : v[mid]!;
}

/** Sum the positive entries of a flat segment map. */
function segmentTotal(seg: Record<string, number>): number {
  return Object.values(seg).reduce((acc, v) => acc + (v > 0 ? v : 0), 0);
}

const DIGIT_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

/**
 * FMP segment keys arrive title-cased and machine-mangled — digits spelled out
 * ("Three Six Five"), conjunctions capitalized, stray "Corporation" suffixes.
 * Normalize them to something a reader expects.
 */
function normalizeSegmentName(raw: string): string {
  let s = raw.trim();
  s = s.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine)( (zero|one|two|three|four|five|six|seven|eight|nine))+\b/gi,
    (match) =>
      match
        .split(/\s+/)
        .map((w) => DIGIT_WORDS[w.toLowerCase()] ?? w)
        .join(''),
  );
  s = s.replace(/\bLinked In\b/gi, 'LinkedIn');
  s = s.replace(/\s+(Corporation|Incorporated|Inc\.?)$/i, '');
  s = s.replace(/\b(And|Or|Of|The|For|To|In)\b/g, (w) => w.toLowerCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A segment below this revenue share is too small to be "the narrative". */
const NARRATIVE_MIN_SHARE = 5;

/** Company-wide YoY revenue growth (%) derived from the earnings revenue series. */
function deriveCompanyGrowthPct(earnings: FmpEarning[]): number {
  const withRev = earnings
    .filter((e): e is FmpEarning & { revenue: number } => e.revenue !== null && e.revenue > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = withRev[0];
  const yearAgo = withRev[4] ?? withRev[withRev.length - 1];
  if (!latest || !yearAgo || yearAgo === latest || yearAgo.revenue <= 0) return 0;
  return ((latest.revenue - yearAgo.revenue) / yearAgo.revenue) * 100;
}

interface EgsBuild {
  egsInputs: EgsInputs;
  earningsDate: string;
  priceT0: number;
  priceT1: number;
  priceT3: number;
}

/**
 * Phase 2 — walk the trailing-8-quarter earnings rows newest-first, find the
 * first one whose earnings date lands in the price series with at least three
 * trading days of follow-through, and build the EGS inputs from it.
 */
function buildEgsInputs(ticker: string, bundle: PublicDataBundle): EgsBuild {
  const prices = [...bundle.prices].sort((a, b) => a.date.localeCompare(b.date));
  const dateIndex = new Map(prices.map((p, i) => [p.date, i]));

  const usable = bundle.earnings
    .filter(
      (e) =>
        e.eps !== null &&
        e.epsEstimated !== null &&
        e.revenue !== null &&
        e.revenueEstimated !== null,
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const row of usable) {
    const idx = dateIndex.get(row.date);
    if (idx === undefined) continue; // earnings date not in the price series — walk back
    const t0 = prices[idx];
    const t1 = prices[idx + 1];
    const t3 = prices[idx + 3];
    if (!t0 || !t1 || !t3) continue; // not enough post-earnings trading days

    const epsEst = row.epsEstimated!;
    const revEst = row.revenueEstimated!;
    const epsSurprisePct = clamp(
      (row.eps! - epsEst) / Math.abs(epsEst || 1e-9),
      -SURPRISE_CLAMP,
      SURPRISE_CLAMP,
    );
    const revenueSurprisePct = clamp(
      (row.revenue! - revEst) / Math.abs(revEst || 1e-9),
      -SURPRISE_CLAMP,
      SURPRISE_CLAMP,
    );

    return {
      egsInputs: {
        epsSurprisePct,
        revenueSurprisePct,
        oneDayReturn: (t1.close - t0.close) / t0.close,
        threeDayReturn: (t3.close - t0.close) / t0.close,
      },
      earningsDate: row.date,
      priceT0: t0.close,
      priceT1: t1.close,
      priceT3: t3.close,
    };
  }

  throw new InsufficientDataError(
    'public.expectation_gap',
    `no earnings date in the trailing 8 quarters for ${ticker} could be matched against ` +
      `${bundle.prices.length} days of price history`,
  );
}

interface NisBuild {
  nisInputs: NisInputs;
  heuristicNote: string;
}

/**
 * Phase 3 — build the NIS inputs from product-revenue segmentation. When fewer
 * than two segments are reported, fall back to a single synthetic "Total"
 * segment so the score still computes (with lower NIS confidence) rather than
 * throwing.
 */
function buildNisInputs(bundle: PublicDataBundle): NisBuild {
  const derivedGrowthPct = deriveCompanyGrowthPct(bundle.earnings);

  const synthetic = (note: string): NisBuild => ({
    nisInputs: {
      currentPeriodSegments: [
        {
          name: 'Total',
          revenueSharePct: 100,
          yoyGrowthPct: derivedGrowthPct,
          isNarrativeSegment: true,
        },
      ],
      historicalConsistency: 0.5,
    },
    heuristicNote: `${HEURISTIC_NOTE} (${note})`,
  });

  const segments = bundle.segments;
  if (!segments || segments.length < 1) {
    return synthetic('synthetic Total segment — no segmentation data reported');
  }

  const sorted = [...segments].sort((a, b) => b.date.localeCompare(a.date));
  const current = sorted[0]!.segments;
  const prior = sorted[1]?.segments ?? null;
  const priorPrior = sorted[2]?.segments ?? null;

  const currentNames = Object.keys(current).filter((n) => (current[n] ?? 0) > 0);
  if (currentNames.length < 2) {
    return synthetic('synthetic Total segment — fewer than 2 reported segments');
  }

  const totalCurrent = segmentTotal(current);
  const totalPrior = prior ? segmentTotal(prior) : 0;
  const companyGrowthPct =
    prior && totalPrior > 0
      ? ((totalCurrent - totalPrior) / totalPrior) * 100
      : derivedGrowthPct;

  const built: SegmentDatum[] = currentNames.map((rawName) => {
    const cur = current[rawName]!;
    const pri = prior ? (prior[rawName] ?? 0) : 0;
    return {
      name: normalizeSegmentName(rawName),
      revenueSharePct: clamp((cur / totalCurrent) * 100, 0, 100),
      yoyGrowthPct: prior && pri > 0 ? ((cur - pri) / pri) * 100 : 0,
      isNarrativeSegment: false,
    };
  });

  // Heuristic: the largest fast-growing segment, else the largest by share —
  // but only segments with a meaningful revenue share are eligible, so a tiny
  // "Other" line can't be mistaken for the company's story.
  const eligible = built.filter((s) => s.revenueSharePct >= NARRATIVE_MIN_SHARE);
  const candidates = eligible.length > 0 ? eligible : built;

  const growing = candidates.filter((s) => s.yoyGrowthPct > 0);
  let narrative: SegmentDatum | undefined;
  if (growing.length > 0) {
    const fastest = growing.reduce((a, b) => (b.yoyGrowthPct > a.yoyGrowthPct ? b : a));
    if (fastest.yoyGrowthPct > 2 * Math.max(companyGrowthPct, 0.0001)) {
      narrative = fastest;
    }
  }
  if (!narrative) {
    narrative = candidates.reduce((a, b) => (b.revenueSharePct > a.revenueSharePct ? b : a));
  }
  narrative.isNarrativeSegment = true;

  // historicalConsistency — ratio of segments that grew positively in both the
  // current and the prior period (a proxy for narrative stability).
  let historicalConsistency = 0.7;
  if (prior && priorPrior) {
    let bothPositive = 0;
    for (const name of currentNames) {
      const cur = current[name]!;
      const pri = prior[name] ?? 0;
      const prePri = priorPrior[name] ?? 0;
      const curGrew = pri > 0 && cur > pri;
      const priGrew = prePri > 0 && pri > prePri;
      if (curGrew && priGrew) bothPositive += 1;
    }
    historicalConsistency = clamp(bothPositive / currentNames.length, 0, 1);
  } else if (prior) {
    const grew = built.filter((s) => s.yoyGrowthPct > 0).length;
    historicalConsistency = clamp(grew / built.length, 0, 1);
  }

  return {
    nisInputs: { currentPeriodSegments: built, historicalConsistency },
    heuristicNote: HEURISTIC_NOTE,
  };
}

/**
 * Trailing-90d price-target move (%), derived from the recency-windowed
 * consensus averages: last quarter vs. last year. Falls back to last-month and
 * all-time windows when a window is empty; 0 only when the company has no
 * analyst price-target coverage at all.
 */
function priceTargetMovePct(bundle: PublicDataBundle): number {
  const s = bundle.priceTargetSummary;
  if (!s) return 0;
  const recent = s.lastQuarterAvgPriceTarget ?? s.lastMonthAvgPriceTarget ?? null;
  const baseline = s.lastYearAvgPriceTarget ?? s.allTimeAvgPriceTarget ?? null;
  if (recent == null || baseline == null || baseline <= 0) return 0;
  return ((recent - baseline) / baseline) * 100;
}

/**
 * Phase 4 — build the NHS inputs.
 */
function buildNhsInputs(bundle: PublicDataBundle): NhsInputs {
  let analystUpgradesTrailing90d = 0;
  let analystDowngradesTrailing90d = 0;
  const recs = bundle.analystRecs;
  if (recs && recs.length > 0) {
    const sorted = [...recs].sort((a, b) => b.date.localeCompare(a.date));
    const latest = sorted[0]!;
    const ref = sorted[Math.min(3, sorted.length - 1)]!;
    const bullishLatest = latest.strongBuy + latest.buy;
    const bullishRef = ref.strongBuy + ref.buy;
    const bearishLatest = latest.strongSell + latest.sell;
    const bearishRef = ref.strongSell + ref.sell;
    analystUpgradesTrailing90d = Math.max(0, Math.round(bullishLatest - bullishRef));
    analystDowngradesTrailing90d = Math.max(0, Math.round(bearishLatest - bearishRef));
  }

  const ttm = bundle.ratios.priceToSalesRatioTTM;
  const historicalValues = (bundle.keyMetrics ?? [])
    .map((m) => m.priceToSalesRatio)
    .filter((x): x is number => typeof x === 'number' && x > 0);
  const med = median(historicalValues);

  const priceToRevenueRatio = ttm && ttm > 0 ? ttm : (med ?? 1);
  const historicalMedianPriceToRevenue = med && med > 0 ? med : priceToRevenueRatio;

  return {
    priceTargetMoveTrailing90dPct: priceTargetMovePct(bundle),
    analystUpgradesTrailing90d,
    analystDowngradesTrailing90d,
    priceToRevenueRatio,
    historicalMedianPriceToRevenue,
  };
}

export async function runLivePublicScore(
  config: LivePublicScoreConfig,
): Promise<LivePublicScoreResult> {
  const ticker = config.ticker.toUpperCase();

  // ── Phase 1: parallel fetch ───────────────────────────────────────────
  const fmp = new FmpClient({ apiKey: config.fmpApiKey });
  const bundle = await fetchAllPublicData(ticker, fmp);

  // ── Phases 2-4: synthesize engine inputs ──────────────────────────────
  const egs = buildEgsInputs(ticker, bundle);
  const nis = buildNisInputs(bundle);
  const nhsInputs = buildNhsInputs(bundle);

  // ── Phase 5: compute, emit Signal, return with full input snapshot ────
  const epsSurprise = egs.egsInputs.epsSurprisePct;
  const surpriseSign = epsSurprise > 0.01 ? 1 : epsSurprise < -0.01 ? -1 : 0;

  const result = computePublicScore({
    ticker,
    surpriseSign,
    egs: egs.egsInputs,
    nis: nis.nisInputs,
    nhs: nhsInputs,
  });

  const label = result.label as PublicLabel;
  const meta = PublicLabelMeta[label];
  const baseSignal = publicScoreToSignal(result);
  const signal: Signal = {
    ...baseSignal,
    metadata: {
      ...(baseSignal.metadata ?? {}),
      label: result.label,
      labelDisplay: meta.display,
      labelDescription: meta.description,
      companyName: bundle.profile.companyName,
      sector: bundle.profile.sector ?? null,
      industry: bundle.profile.industry ?? null,
      score: result.score,
      confidence: result.confidence,
      components: result.components,
      provenance: {
        fetchedAt: bundle.fetchedAt,
        earningsDate: egs.earningsDate,
        epsSurprisePct: egs.egsInputs.epsSurprisePct,
        revenueSurprisePct: egs.egsInputs.revenueSurprisePct,
        oneDayReturn: egs.egsInputs.oneDayReturn,
        threeDayReturn: egs.egsInputs.threeDayReturn,
        priceT0: egs.priceT0,
        priceT1: egs.priceT1,
        priceT3: egs.priceT3,
        segments: nis.nisInputs.currentPeriodSegments,
        narrativeSegmentHeuristic: nis.heuristicNote,
      },
    },
  };

  return { result, signal, inputs: bundle };
}
