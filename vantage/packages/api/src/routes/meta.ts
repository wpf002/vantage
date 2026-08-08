import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql, eq } from 'drizzle-orm';
import { PUBLIC_SCORE_WEIGHTS, CLASSIFICATION_THRESHOLDS } from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { captureOutcomes, type OutcomePayload, DEFAULT_HORIZON_DAYS } from '../jobs/outcomeCapture.js';
import { getActiveScoringWeights } from '../db/scoringWeights.js';
import { getActiveClassificationThresholds } from '../db/classificationThresholds.js';
import { classificationQueue } from '../queues/index.js';
import { rebuildSystemPortfolio } from '../jobs/systemPortfolio.js';
import { backtestReputation } from '../jobs/backtestReputation.js';
import { getReasoningPaths } from '../db/evidenceStore.js';

/**
 * Phase 8 — steps 3–5: the meta-learning surface.
 *
 * Reads the graded decision log (decisions whose outcomes have been captured)
 * and computes calibration: per-label and per-class hit-rates, average
 * realized returns, and the score→return correlation. This is the "report
 * card" on Vantage's own predictions.
 *
 * GET  /v1/meta          — calibration summary + recent graded decisions
 * POST /v1/meta/capture  — run the outcome-capture sweep on demand (admin/dev)
 */

interface DecisionRow {
  id: string;
  entity: string;
  decision_type: string;
  outcome_payload: OutcomePayload;
  outcome_at: string;
  created_at: string;
}

interface Bucket {
  key: string;
  n: number;
  hits: number;
  retSum: number;
}

function summarize(buckets: Map<string, Bucket>) {
  return [...buckets.values()]
    .map((b) => ({
      key: b.key,
      count: b.n,
      hitRate: b.n > 0 ? b.hits / b.n : 0,
      avgReturn: b.n > 0 ? b.retSum / b.n : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Pearson correlation between two equal-length series. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

const CaptureBody = z.object({
  horizonDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const metaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async () => {
    const graded = (await db.execute(sql`
      SELECT id, entity, decision_type, outcome_payload, outcome_at, created_at
      FROM platform_decisions
      WHERE outcome_payload IS NOT NULL
      ORDER BY outcome_at DESC
    `)) as unknown as DecisionRow[];

    // Pending = gradable decisions still awaiting an outcome.
    const pendingRows = (await db.execute(sql`
      SELECT count(*)::int AS n
      FROM platform_decisions
      WHERE outcome_payload IS NULL
        AND decision_type IN ('public_score', 'classification')
    `)) as unknown as Array<{ n: number }>;
    const pending = pendingRows[0]?.n ?? 0;

    const byLabel = new Map<string, Bucket>();
    const byClass = new Map<string, Bucket>();
    const scoreXs: number[] = [];
    const retYs: number[] = [];
    let hits = 0;

    for (const row of graded) {
      const o = row.outcome_payload;
      if (o.correct) hits++;
      if (o.kind === 'public_score' && o.label) {
        const b = byLabel.get(o.label) ?? { key: o.label, n: 0, hits: 0, retSum: 0 };
        b.n++;
        if (o.correct) b.hits++;
        b.retSum += o.forwardReturn;
        byLabel.set(o.label, b);
        if (typeof o.score === 'number') {
          scoreXs.push(o.score);
          retYs.push(o.forwardReturn);
        }
      } else if (o.kind === 'classification' && o.assetClass) {
        const b = byClass.get(o.assetClass) ?? { key: o.assetClass, n: 0, hits: 0, retSum: 0 };
        b.n++;
        if (o.correct) b.hits++;
        b.retSum += o.forwardReturn;
        byClass.set(o.assetClass, b);
      }
    }

    // The learning loops' current state — active Public Score weights and
    // classification confidence floors. Learned values supersede the static
    // defaults once the nightly calibration runs.
    const activeWeights = await getActiveScoringWeights();
    const activeThresholds = await getActiveClassificationThresholds();

    return {
      horizonDays: DEFAULT_HORIZON_DAYS,
      totals: {
        graded: graded.length,
        pending,
        overallHitRate: graded.length > 0 ? hits / graded.length : 0,
      },
      learnedWeights: {
        active: activeWeights ?? PUBLIC_SCORE_WEIGHTS,
        isLearned: activeWeights !== null,
      },
      learnedThresholds: {
        active: activeThresholds ?? CLASSIFICATION_THRESHOLDS,
        isLearned: activeThresholds !== null,
      },
      scoreReturnCorrelation: pearson(scoreXs, retYs),
      byLabel: summarize(byLabel),
      byClass: summarize(byClass),
      recent: graded.slice(0, 25).map((r) => ({
        entity: r.entity,
        decisionType: r.decision_type,
        outcomeAt: new Date(r.outcome_at).toISOString(),
        ...r.outcome_payload,
      })),
    };
  });

  app.post('/capture', { schema: { body: CaptureBody } }, async (req) => {
    const result = await captureOutcomes({ horizonDays: req.body.horizonDays });
    return result;
  });

  // POST /v1/meta/rebuild-portfolio — rebuild the system portfolio on demand.
  app.post('/rebuild-portfolio', async () => {
    const result = await rebuildSystemPortfolio(db);
    return result;
  });

  // POST /v1/meta/reclassify — enqueue a classification job for every entity
  // that has at least one signal. Workers process the queue asynchronously.
  app.post('/reclassify', async () => {
    const rows = await db
      .selectDistinct({ entity: schema.platformSignals.entity })
      .from(schema.platformSignals);
    const entities = rows.map((r) => r.entity).filter(Boolean);
    for (const entity of entities) {
      await classificationQueue.add('classify', { entity, triggeredBySignalId: 'manual-reclassify' });
    }
    return { enqueued: entities.length };
  });

  // ── Evidence Quality endpoints ───────────────────────────────────────────

  /**
   * GET /v1/meta/evidence/sources
   * Current reputation state for all tracked sources, sorted by sample count.
   */
  app.get('/evidence/sources', async () => {
    const rows = await db
      .select()
      .from(schema.evidenceSources)
      .orderBy(schema.evidenceSources.sampleCount);

    return rows.map((r) => ({
      sourceKey: r.sourceKey,
      sourceType: r.sourceType,
      displayName: r.displayName,
      credibilityScore: Number(r.credibilityScore),
      sampleCount: r.sampleCount,
      correctCount: r.correctCount,
      hitRate: r.sampleCount > 0 ? r.correctCount / r.sampleCount : null,
      updatedAt: r.updatedAt,
    }));
  });

  /**
   * POST /v1/meta/evidence/backtest
   * Run a read-only reputation backtest over graded decision history.
   * Body: { limit?: number }
   */
  const BacktestBody = z.object({
    limit: z.coerce.number().int().min(1).max(100000).optional(),
  });
  app.post('/evidence/backtest', { schema: { body: BacktestBody } }, async (req) => {
    return backtestReputation({ limit: req.body.limit });
  });

  /**
   * GET /v1/meta/decisions/:id/reasoning
   * Reasoning path (layer traces) for a specific decision.
   */
  app.get(
    '/decisions/:id/reasoning',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const paths = await getReasoningPaths(req.params.id);
      return paths.map((p) => ({
        layer: p.layer,
        layerScore: p.layerScore !== null ? Number(p.layerScore) : null,
        thresholdKey: p.thresholdKey,
        thresholdValue: p.thresholdValue !== null ? Number(p.thresholdValue) : null,
        fired: p.fired,
        inputSignalIds: p.inputSignalIds,
        qualityScores: p.qualityScores,
        compositeQuality: p.compositeQuality !== null ? Number(p.compositeQuality) : null,
        sensitivity: p.sensitivity,
        maxSensitivitySignalId: p.maxSensitivitySignalId,
        maxSensitivityDelta: p.maxSensitivityDelta !== null ? Number(p.maxSensitivityDelta) : null,
        capturedAt: p.capturedAt,
      }));
    },
  );

  /**
   * GET /v1/meta/evidence/entity/:entity/reasoning
   * Latest reasoning paths for an entity (e.g. a ticker), across all its
   * decisions, ordered newest-first. Returns at most 5 decisions × their layers.
   * Used by the per-company score page to surface signal quality.
   */
  app.get(
    '/evidence/entity/:entity/reasoning',
    { schema: { params: z.object({ entity: z.string().min(1).max(20) }) } },
    async (req) => {
      const { entity } = req.params;

      // Latest 3 decisions for this entity that have reasoning paths.
      const recentDecisions = await db
        .select({ id: schema.platformDecisions.id, decisionType: schema.platformDecisions.decisionType, createdAt: schema.platformDecisions.createdAt })
        .from(schema.platformDecisions)
        .where(eq(schema.platformDecisions.entity, entity))
        .orderBy(schema.platformDecisions.createdAt)
        .limit(3);

      if (recentDecisions.length === 0) return [];

      const results = await Promise.all(
        recentDecisions.map(async (d) => {
          const paths = await getReasoningPaths(d.id);
          return {
            decisionId: d.id,
            decisionType: d.decisionType,
            decidedAt: d.createdAt,
            layers: paths.map((p) => ({
              layer: p.layer,
              layerScore: p.layerScore !== null ? Number(p.layerScore) : null,
              compositeQuality: p.compositeQuality !== null ? Number(p.compositeQuality) : null,
              fired: p.fired,
              maxSensitivitySignalId: p.maxSensitivitySignalId,
              maxSensitivityDelta: p.maxSensitivityDelta !== null ? Number(p.maxSensitivityDelta) : null,
            })),
          };
        }),
      );

      // Only return decisions that have reasoning path rows.
      return results.filter((r) => r.layers.length > 0);
    },
  );
};
