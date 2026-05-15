import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and, desc, asc } from 'drizzle-orm';
import { computePublicScore, publicScoreToSignal, PublicScoreInputs } from '@vantage/core-public';
import { runLivePublicScore } from '@vantage/core-public/orchestrator';
import type { LivePublicScoreConfig } from '@vantage/core-public/orchestrator';
import { harmonize } from '@vantage/harmonizer';
import { InsufficientDataError, NotFoundError, ValidationError } from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { ensureCompany, persistPublicScore } from '../db/signalStore.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ValidationError(`server misconfigured: ${name} is not set`);
  return value;
}

const ScoreLiveRequest = z.object({ ticker: z.string().min(1).max(8) });
const LatestParams = z.object({ ticker: z.string() });

export const publicRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── POST /score — compute from pre-built inputs (kept for testing) ─────
  app.post(
    '/score',
    { schema: { body: PublicScoreInputs } },
    async (req) => {
      const result = computePublicScore(req.body);
      const signal = harmonize(publicScoreToSignal(result));
      return { result, signal };
    },
  );

  // ── POST /score-live — pull every input fresh from FMP, run, persist ──
  app.post(
    '/score-live',
    { schema: { body: ScoreLiveRequest } },
    async (req, reply) => {
      const ticker = req.body.ticker.toUpperCase();
      const config: LivePublicScoreConfig = {
        ticker,
        fmpApiKey: requireEnv('FMP_API_KEY'),
        ...(process.env.ML_SERVICE_URL ? { mlServiceUrl: process.env.ML_SERVICE_URL } : {}),
      };

      let result;
      try {
        result = await runLivePublicScore(config);
      } catch (err) {
        // No usable earnings / no FMP data — a structured 422, not a 500.
        if (err instanceof InsufficientDataError) {
          return reply.status(422).send({
            error: err.code,
            message: err.message,
            context: err.context,
          });
        }
        throw err;
      }

      const signal = harmonize(result.signal);
      // Universal search: make sure this ticker is a seeded company row.
      await ensureCompany(db, result.inputs.profile);
      const { signalId } = await persistPublicScore(db, { ...result, signal });

      return { result: result.result, signal, signalId, inputs: result.inputs };
    },
  );

  // ── GET /score-live/latest/:ticker — most recent persisted score ──────
  app.get(
    '/score-live/latest/:ticker',
    { schema: { params: LatestParams } },
    async (req) => {
      const ticker = req.params.ticker.toUpperCase();
      const signals = await db
        .select()
        .from(schema.platformSignals)
        .where(
          and(
            eq(schema.platformSignals.entity, ticker),
            eq(schema.platformSignals.signalType, 'public.score'),
          ),
        )
        .orderBy(desc(schema.platformSignals.timestamp))
        .limit(1);

      if (signals.length === 0) throw new NotFoundError('public score', ticker);
      const signal = signals[0]!;

      const lineage = await db
        .select()
        .from(schema.platformAudit)
        .where(eq(schema.platformAudit.signalId, signal.id))
        .orderBy(asc(schema.platformAudit.step));

      const meta = (signal.metadata ?? {}) as Record<string, unknown>;
      return {
        signal,
        lineage,
        label: meta.label ?? null,
        score: meta.score ?? signal.magnitude * 100,
        components: meta.components ?? null,
      };
    },
  );
};
