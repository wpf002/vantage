import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { constructPortfolio, Candidate } from '@vantage/portfolio';

const ConstructRequest = z.object({
  candidates: z.array(Candidate),
  constraints: z
    .object({
      maxAssetWeight: z.number().min(0).max(1).optional(),
      maxSectorWeight: z.number().min(0).max(1).optional(),
      minCrossSectorCount: z.number().int().min(1).optional(),
      sleeveTargets: z
        .object({
          core: z.number().min(0).max(1),
          growth: z.number().min(0).max(1),
          defensive: z.number().min(0).max(1),
          tactical: z.number().min(0).max(1),
        })
        .optional(),
    })
    .optional(),
});

export const portfolioRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/construct', { schema: { body: ConstructRequest } }, async (req) => {
    return constructPortfolio(req.body.candidates, req.body.constraints);
  });
};
