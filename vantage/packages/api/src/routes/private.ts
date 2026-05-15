import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and, desc, asc } from 'drizzle-orm';
import { runDcf, DcfInputs } from '@vantage/core-private/dcf';
import { runComps, CompsInputs } from '@vantage/core-private/comps';
import { runLbo, LboInputs } from '@vantage/core-private/lbo';
import { blendValuations, blendedValuationToSignal } from '@vantage/core-private/blend';
import { requestMlAdjustment } from '@vantage/core-private/ml-bridge';
import { runLivePrivateValuation } from '@vantage/core-private/orchestrator';
import type { LivePrivateValuationConfig } from '@vantage/core-private/orchestrator';
import { harmonize } from '@vantage/harmonizer';
import { NotFoundError, ValidationError } from '@vantage/shared';
import type { LifeStage } from '@vantage/shared';
import { db, schema } from '../db/client.js';
import { persistLiveValuation } from '../db/signalStore.js';

const ValueRequest = z.object({
  companyId: z.string(),
  lifeStage: z.enum([
    'seed',
    'series_a',
    'series_b',
    'series_c_plus',
    'pre_ipo',
    'public_early',
    'public_mature',
  ]),
  dcf: DcfInputs.optional(),
  comps: CompsInputs.optional(),
  lbo: LboInputs.optional(),
  mlFeatures: z.record(z.number()).optional(),
});

/**
 * Per-company identifiers for the live orchestrator. The peer set lives in
 * infra/seeds/peer-sets-private.json (the human-intelligence layer); the
 * domain / org / assignee handles needed to pull alt-data live here.
 */
interface CompanyIdentifiers {
  companyId: string;
  companyName: string; // must match infra/seeds/companies.json
  domain: string;
  githubOrg: string;
  usptoAssignee: string;
  lifeStage: LifeStage;
}

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

// Load the peer sets once at module init, then serve from memory.
const PEER_SETS: PrivatePeerSet[] = (() => {
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

const ValueLiveRequest = z.object({ companyId: z.string() });
const LatestParams = z.object({ companyId: z.string() });

export const privateRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/value',
    { schema: { body: ValueRequest } },
    async (req) => {
      const body = req.body;
      const methodResults = [];

      if (body.dcf) methodResults.push(runDcf(body.dcf));
      if (body.comps) methodResults.push(runComps(body.comps));
      if (body.lbo) methodResults.push(runLbo(body.lbo));

      if (methodResults.length === 0) {
        return { error: 'at least one method must be provided' };
      }

      // Pre-ML blend
      const preBlend = blendValuations(body.companyId, body.lifeStage as LifeStage, methodResults);

      // Optional ML adjustment
      let mlAdj = undefined;
      if (body.mlFeatures && process.env.ML_SERVICE_URL) {
        try {
          mlAdj = await requestMlAdjustment(
            {
              companyId: body.companyId,
              preMlValuation: preBlend.preMlValuation.base,
              features: body.mlFeatures,
            },
            {
              baseUrl: process.env.ML_SERVICE_URL,
              apiKey: process.env.ML_SERVICE_API_KEY,
            },
          );
        } catch (err) {
          app.log.warn({ err }, 'ML adjustment skipped — upstream unavailable');
        }
      }

      const blended = blendValuations(
        body.companyId,
        body.lifeStage as LifeStage,
        methodResults,
        mlAdj,
      );
      const signal = harmonize(blendedValuationToSignal(blended));

      return { blended, signal };
    },
  );

  // ── POST /value-live — pull every input fresh, run, persist ───────────
  app.post(
    '/value-live',
    { schema: { body: ValueLiveRequest } },
    async (req) => {
      const { companyId } = req.body;
      const ident = COMPANY_IDENTIFIERS[companyId.toLowerCase()];
      if (!ident) throw new NotFoundError('company identifiers', companyId);

      const peerSet = PEER_SETS.find((p) => p.companyName === ident.companyName);
      if (!peerSet) throw new NotFoundError('peer set', ident.companyName);

      const company = await db
        .select({ id: schema.platformCompanies.id })
        .from(schema.platformCompanies)
        .where(eq(schema.platformCompanies.name, ident.companyName))
        .limit(1);
      if (company.length === 0) throw new NotFoundError('company', ident.companyName);
      const platformCompanyId = company[0]!.id;

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

      const result = await runLivePrivateValuation(config);

      // Enrich the signal metadata with the structured valuation so the
      // GET latest endpoint can serve the UI without re-deriving anything.
      const { intel } = result.inputs;
      const signal = harmonize({
        ...result.signal,
        metadata: {
          ...result.signal.metadata,
          companyName: config.companyName,
          lifeStage: config.lifeStage,
          finalValuation: result.blended.finalValuation,
          preMlValuation: result.blended.preMlValuation,
          weights: result.blended.weights,
          confidence: result.blended.confidence,
          methodResults: result.blended.methodResults.map((r) => ({
            method: r.method,
            enterpriseValue: r.enterpriseValue,
            confidence: r.confidence,
            rationale: r.rationale,
            warnings: r.warnings,
          })),
          revenueIntel: {
            revenueLtmUsd: intel.revenueLtmUsd,
            revenueConfidence: intel.revenueConfidence,
            revenueAsOfMonth: intel.revenueAsOfMonth,
            revenueSource: intel.revenueSource,
            growthCommentary: intel.growthCommentary,
          },
        },
      });

      const { signalId } = await persistLiveValuation(
        db,
        { ...result, signal },
        platformCompanyId,
      );

      return { blended: result.blended, signal, signalId, inputs: result.inputs };
    },
  );

  // ── GET /value-live/latest/:companyId — most recent persisted run ─────
  app.get(
    '/value-live/latest/:companyId',
    { schema: { params: LatestParams } },
    async (req) => {
      const { companyId } = req.params;
      const signals = await db
        .select()
        .from(schema.platformSignals)
        .where(
          and(
            eq(schema.platformSignals.entity, companyId),
            eq(schema.platformSignals.signalType, 'private.blended_valuation'),
          ),
        )
        .orderBy(desc(schema.platformSignals.timestamp))
        .limit(1);

      if (signals.length === 0) throw new NotFoundError('private valuation', companyId);
      const signal = signals[0]!;

      const lineage = await db
        .select()
        .from(schema.platformAudit)
        .where(eq(schema.platformAudit.signalId, signal.id))
        .orderBy(asc(schema.platformAudit.step));

      return { signal, lineage, metadata: signal.metadata };
    },
  );
};
