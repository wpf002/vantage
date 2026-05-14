import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { runDcf, DcfInputs } from '@vantage/core-private/dcf';
import { runComps, CompsInputs } from '@vantage/core-private/comps';
import { runLbo, LboInputs } from '@vantage/core-private/lbo';
import { blendValuations, blendedValuationToSignal } from '@vantage/core-private/blend';
import { requestMlAdjustment } from '@vantage/core-private/ml-bridge';
import { harmonize } from '@vantage/harmonizer';
import type { LifeStage } from '@vantage/shared';

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
};
