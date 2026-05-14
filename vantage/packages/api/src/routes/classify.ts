import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { classify, classificationToSignal } from '@vantage/classification';
import { harmonize } from '@vantage/harmonizer';
import { Signal } from '@vantage/shared';

const ClassifyRequest = z.object({
  entity: z.string(),
  signals: z.array(Signal),
});

export const classifyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/', { schema: { body: ClassifyRequest } }, async (req) => {
    const result = classify(req.body);
    const signal = harmonize(classificationToSignal(result));
    return { result, signal };
  });
};
