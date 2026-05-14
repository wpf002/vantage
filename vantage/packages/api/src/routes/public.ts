import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { computePublicScore, publicScoreToSignal, PublicScoreInputs } from '@vantage/core-public';
import { harmonize } from '@vantage/harmonizer';

export const publicRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/score',
    { schema: { body: PublicScoreInputs } },
    async (req) => {
      const result = computePublicScore(req.body);
      const signal = harmonize(publicScoreToSignal(result));
      return { result, signal };
    },
  );
};
