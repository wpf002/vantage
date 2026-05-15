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
    origin: process.env.API_CORS_ORIGIN ?? true,
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

  // Routes
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(privateRoutes, { prefix: '/v1/private' });
  await app.register(publicRoutes, { prefix: '/v1/public' });
  await app.register(searchRoutes, { prefix: '/v1' });
  await app.register(classifyRoutes, { prefix: '/v1/classify' });
  await app.register(portfolioRoutes, { prefix: '/v1/portfolio' });
  await app.register(simulationRoutes, { prefix: '/v1/simulation' });
  await app.register(auditRoutes, { prefix: '/v1/audit' });

  return app;
}

async function main() {
  const app = await buildServer();
  const host = process.env.API_HOST ?? '0.0.0.0';
  const port = Number(process.env.API_PORT ?? 4000);

  try {
    await app.listen({ host, port });
    app.log.info(`Vantage API listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
