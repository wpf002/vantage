import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { VantageError } from '@vantage/shared';
import { healthRoutes } from './routes/health.js';
import { privateRoutes } from './routes/private.js';
import { publicRoutes } from './routes/public.js';
import { searchRoutes } from './routes/search.js';
import { classifyRoutes } from './routes/classify.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { simulationRoutes } from './routes/simulation.js';
import { auditRoutes } from './routes/audit.js';
import { classificationsRoutes } from './routes/classifications.js';
import { portfoliosRoutes } from './routes/portfolios.js';
import { screenerRoutes } from './routes/screener.js';
import { boardRoutes } from './routes/board.js';
import { metaRoutes } from './routes/meta.js';
import { registerSessionMiddleware } from './middleware/session.js';
import { startWorkers, stopWorkers } from './queues/workers.js';
import { closeQueues } from './queues/index.js';

async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cors, {
    // Phase 5 — the UI now sends the NextAuth session cookie cross-origin to
    // this API on protected routes, so `credentials: true` is mandatory. The
    // wildcard origin (`true`) is rejected by browsers in credentialed mode,
    // so default to the dev UI origin instead.
    origin: process.env.API_CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  // Centralized error handler mapping VantageError to HTTP
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof VantageError) {
      return reply.status(err.status).send({
        error: err.code,
        message: err.message,
        context: err.context,
      });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'INTERNAL', message: 'unexpected error' });
  });

  // Session middleware decorates request.user from the NextAuth session
  // cookie. Never rejects — protected routes opt in by checking request.user.
  await registerSessionMiddleware(app);

  // Routes
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(privateRoutes, { prefix: '/v1/private' });
  await app.register(publicRoutes, { prefix: '/v1/public' });
  await app.register(searchRoutes, { prefix: '/v1' });
  await app.register(classifyRoutes, { prefix: '/v1/classify' });
  await app.register(portfolioRoutes, { prefix: '/v1/portfolio' });
  await app.register(portfoliosRoutes, { prefix: '/v1/portfolios' });
  await app.register(simulationRoutes, { prefix: '/v1/simulation' });
  await app.register(auditRoutes, { prefix: '/v1/audit' });
  await app.register(classificationsRoutes, { prefix: '/v1/classifications' });
  await app.register(screenerRoutes, { prefix: '/v1/screener' });
  await app.register(boardRoutes, { prefix: '/v1/board' });
  await app.register(metaRoutes, { prefix: '/v1/meta' });

  return app;
}

async function main() {
  const app = await buildServer();
  const host = process.env.API_HOST ?? '0.0.0.0';
  const port = Number(process.env.API_PORT ?? 4000);

  try {
    await app.listen({ host, port });
    app.log.info(`Vantage API listening on http://${host}:${port}`);
    // Workers run in-process for Phase 4 — kicked off after the server is
    // bound so a Redis stall can't block API boot.
    startWorkers();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await stopWorkers();
    await app.close();
    await closeQueues();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main();
