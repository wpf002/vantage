import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  type Decision,
  UnauthorizedError,
  AuthorizationError,
  analyzeCalibration,
  bucketBy,
  computeBrierScore,
  computeHitRate,
  computeReliabilityCurve,
  decisionHit,
  decisionReturn,
  meanConfidence,
  pearson,
} from '@vantage/shared';
import { db } from '../db/client.js';
import {
  loadCalibrationDecisions,
  listDecisionFeed,
  decisionCounts,
  type LoadCalibrationOpts,
} from '../db/metaStore.js';
import { outcomesQueue } from '../queues/index.js';

/**
 * Phase 8 meta-learning routes. All ADMIN_EMAIL-gated, mirroring the
 * /v1/portfolios/system/rebuild guard. The page should not exist for
 * non-admins, so we 403 here and the UI returns notFound().
 */

function requireUser(req: FastifyRequest) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

function requireAdmin(req: FastifyRequest) {
  const user = requireUser(req);
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || user.email.toLowerCase() !== adminEmail.toLowerCase()) {
    throw new AuthorizationError('admin-only surface');
  }
  return user;
}

const CalibrationQuery = z.object({
  decisionType: z.string().optional(),
  sector: z.string().optional(),
  fromDate: z.string().datetime().optional(),
});

const SuggestionsQuery = z.object({
  fromDate: z.string().datetime().optional(),
});

const DecisionsQuery = z.object({
  decisionType: z.string().optional(),
  resolved: z.coerce.boolean().optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

interface SegmentStats {
  hitRate: number;
  brier: number;
  avgConfidence: number;
  calibrationGap: number; // avgConfidence − hitRate; positive = overconfident
  sampleSize: number;
}

function segmentStats(decisions: Decision[]): SegmentStats {
  const { hitRate, sampleSize } = computeHitRate(decisions);
  const { brier } = computeBrierScore(decisions);
  const avgConfidence = meanConfidence(decisions);
  return { hitRate, brier, avgConfidence, calibrationGap: avgConfidence - hitRate, sampleSize };
}

function statsByBucket(buckets: Record<string, Decision[]>): Record<string, SegmentStats> {
  const out: Record<string, SegmentStats> = {};
  for (const [key, group] of Object.entries(buckets)) out[key] = segmentStats(group);
  return out;
}

/** Public-label forward returns + hit stats, keyed by label. */
function labelStats(
  decisions: Decision[],
): Record<string, SegmentStats & { meanForwardReturn90d: number }> {
  const publics = decisions.filter((d) => d.decisionType === 'public_score');
  const byLabel = bucketBy(publics, { label: (d) => d.payload.label });
  const out: Record<string, SegmentStats & { meanForwardReturn90d: number }> = {};
  for (const [label, group] of Object.entries(byLabel)) {
    const returns = group.map(decisionReturn).filter((r): r is number => r !== null);
    const mean = returns.length === 0 ? 0 : returns.reduce((a, v) => a + v, 0) / returns.length;
    out[label] = { ...segmentStats(group), meanForwardReturn90d: mean };
  }
  return out;
}

/** Per-method correlation between method confidence and realized accuracy. */
function methodStats(
  decisions: Decision[],
): Record<'DCF' | 'Comps' | 'LBO', { confidenceCorrelation: number; sampleSize: number }> {
  const methods: Array<'DCF' | 'Comps' | 'LBO'> = ['DCF', 'Comps', 'LBO'];
  const out = {} as Record<'DCF' | 'Comps' | 'LBO', { confidenceCorrelation: number; sampleSize: number }>;
  for (const method of methods) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const d of decisions) {
      if (d.decisionType !== 'private_valuation') continue;
      const m = d.payload.methods?.find((x) => x.method === method && x.weight > 0);
      if (!m || !Number.isFinite(m.confidence)) continue;
      const h = decisionHit(d);
      if (h === null) continue;
      xs.push(m.confidence);
      ys.push(h ? 1 : 0);
    }
    out[method] = { confidenceCorrelation: pearson(xs, ys), sampleSize: xs.length };
  }
  return out;
}

function hitRateAtHorizon(decisions: Decision[], pick: (d: Decision) => number | undefined): number {
  let hits = 0;
  let n = 0;
  for (const d of decisions) {
    if (d.decisionType !== 'public_score' || !d.outcome) continue;
    const r = pick(d);
    if (r === undefined || !Number.isFinite(r)) continue;
    const dir = d.payload.direction;
    if (dir !== 'bullish' && dir !== 'bearish') continue;
    n += 1;
    if ((dir === 'bullish' && r > 0) || (dir === 'bearish' && r < 0)) hits += 1;
  }
  return n === 0 ? 0 : hits / n;
}

export const metaRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── GET /calibration — full per-segment breakdown ──────────────────────
  app.get('/calibration', { schema: { querystring: CalibrationQuery } }, async (req) => {
    requireAdmin(req);
    const opts: LoadCalibrationOpts = {
      ...(req.query.decisionType ? { decisionType: req.query.decisionType } : {}),
      ...(req.query.sector ? { sector: req.query.sector } : {}),
      ...(req.query.fromDate ? { fromDate: new Date(req.query.fromDate) } : {}),
    };
    const [decisions, counts] = await Promise.all([
      loadCalibrationDecisions(db, opts),
      decisionCounts(db, opts.fromDate),
    ]);

    return {
      counts,
      overall: segmentStats(decisions),
      byClass: statsByBucket(bucketBy(decisions, { class: (d) => d.payload.assetClass })),
      bySector: statsByBucket(bucketBy(decisions, { sector: (d) => d.payload.sector })),
      byClassAndSector: statsByBucket(
        bucketBy(decisions, { class: (d) => d.payload.assetClass, sector: (d) => d.payload.sector }),
      ),
      byLabel: labelStats(decisions),
      byMethod: methodStats(decisions),
      reliability: computeReliabilityCurve(decisions),
      timeDecay: {
        hitRateAt30d: hitRateAtHorizon(decisions, (d) => d.outcome?.realizedReturn30d),
        hitRateAt60d: hitRateAtHorizon(decisions, (d) => d.outcome?.realizedReturn60d),
        hitRateAt90d: hitRateAtHorizon(decisions, (d) => d.outcome?.realizedReturn90d),
        hitRateAt180d: hitRateAtHorizon(decisions, (d) => d.outcome?.realizedReturn180d),
      },
    };
  });

  // ── GET /suggestions — ranked tuning suggestions ───────────────────────
  app.get('/suggestions', { schema: { querystring: SuggestionsQuery } }, async (req) => {
    requireAdmin(req);
    const opts: LoadCalibrationOpts = {
      ...(req.query.fromDate ? { fromDate: new Date(req.query.fromDate) } : {}),
    };
    const decisions = await loadCalibrationDecisions(db, opts);
    return analyzeCalibration(decisions);
  });

  // ── GET /decisions — paginated raw decision feed ───────────────────────
  app.get('/decisions', { schema: { querystring: DecisionsQuery } }, async (req) => {
    requireAdmin(req);
    return listDecisionFeed(db, {
      ...(req.query.decisionType ? { decisionType: req.query.decisionType } : {}),
      ...(req.query.resolved !== undefined ? { resolved: req.query.resolved } : {}),
      ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
      ...(req.query.limit ? { limit: req.query.limit } : {}),
    });
  });

  // ── POST /backfill — trigger the outcome backfill out-of-band ──────────
  app.post('/backfill', async (req, reply) => {
    requireAdmin(req);
    const job = await outcomesQueue.add('backfill-outcomes', { reason: 'manual' });
    return reply.status(202).send({ jobId: job.id, status: 'enqueued' });
  });
};
