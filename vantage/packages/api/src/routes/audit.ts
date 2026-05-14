import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { NotFoundError } from '@vantage/shared';

const Params = z.object({ signalId: z.string().uuid() });

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/:signalId',
    { schema: { params: Params } },
    async (req) => {
      const { signalId } = req.params;
      const signal = await db
        .select()
        .from(schema.platformSignals)
        .where(eq(schema.platformSignals.id, signalId))
        .limit(1);
      if (signal.length === 0) throw new NotFoundError('signal', signalId);

      const lineage = await db
        .select()
        .from(schema.platformAudit)
        .where(eq(schema.platformAudit.signalId, signalId))
        .orderBy(asc(schema.platformAudit.step));

      return { signal: signal[0], lineage };
    },
  );
};
