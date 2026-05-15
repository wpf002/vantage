import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  buildCandidatesFromClassifications,
  constructPortfolio,
} from '@vantage/portfolio';
import {
  UnauthorizedError,
  NotFoundError,
  AuthorizationError,
  PortfolioConstraints,
  Sector,
} from '@vantage/shared';
import { db } from '../db/client.js';
import {
  persistPortfolio,
  getPortfolioById,
  getPortfolioBySlug,
  getSystemPortfolio,
  listUserPortfolios,
  listPublishedPortfolios,
  publishPortfolio,
  unpublishPortfolio,
  deletePortfolio,
  renamePortfolio,
  validateSlug,
} from '../db/portfolioStore.js';
import { rebuildSystemPortfolio } from '../jobs/systemPortfolio.js';

const ConstraintsBody = z
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
  .optional();

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  constraints: ConstraintsBody,
  sectorFilter: z.array(Sector).optional(),
});

const PaginateQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().datetime().optional(),
});

const IdParams = z.object({ id: z.string().uuid() });
const SlugParams = z.object({ slug: z.string() });

const PublishBody = z.object({
  slug: z.string().min(3).max(60),
  description: z.string().max(280).optional(),
});

const RenameBody = z.object({
  name: z.string().min(1).max(120),
});

const RebalanceBody = z
  .object({
    sectorFilter: z.array(Sector).optional(),
    excludeEntities: z.array(z.string()).optional(),
  })
  .optional();

function requireUser(req: { user: { id: string; email: string; name: string | null } | null }) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

function defaultConstraints(): typeof PortfolioConstraints._type {
  return PortfolioConstraints.parse({
    maxAssetWeight: 0.1,
    maxSectorWeight: 0.25,
    minCrossSectorCount: 4,
    sleeveTargets: { core: 0.5, growth: 0.25, defensive: 0.15, tactical: 0.1 },
  });
}

function mergeConstraints(
  partial: z.infer<typeof ConstraintsBody>,
): typeof PortfolioConstraints._type {
  const base = defaultConstraints();
  return PortfolioConstraints.parse({
    maxAssetWeight: partial?.maxAssetWeight ?? base.maxAssetWeight,
    maxSectorWeight: partial?.maxSectorWeight ?? base.maxSectorWeight,
    minCrossSectorCount: partial?.minCrossSectorCount ?? base.minCrossSectorCount,
    sleeveTargets: partial?.sleeveTargets ?? base.sleeveTargets,
  });
}

export const portfoliosRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Public: system standing position ────────────────────────────────
  app.get('/system', async (_req, reply) => {
    const row = await getSystemPortfolio(db);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'system portfolio not yet built' });
    return row;
  });

  app.get(
    '/published',
    { schema: { querystring: PaginateQuery } },
    async (req) => {
      return listPublishedPortfolios(db, req.query);
    },
  );

  app.get(
    '/published/:slug',
    { schema: { params: SlugParams } },
    async (req, reply) => {
      const row = await getPortfolioBySlug(db, req.params.slug);
      if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
      return row;
    },
  );

  // ── Authenticated: list current user's portfolios ───────────────────
  app.get('/mine', async (req) => {
    const user = requireUser(req);
    return listUserPortfolios(db, user.id);
  });

  // ── Authenticated: build a new personal portfolio ───────────────────
  app.post('/', { schema: { body: CreateBody } }, async (req) => {
    const user = requireUser(req);
    const constraints = mergeConstraints(req.body.constraints);
    const candidates = await buildCandidatesFromClassifications(db, {
      sectorFilter: req.body.sectorFilter,
    });
    const result = constructPortfolio(candidates, constraints);
    const persisted = await persistPortfolio(db, {
      ownerUserId: user.id,
      kind: 'personal',
      name: req.body.name,
      constraints,
      result,
      candidatesUsed: candidates,
    });
    return { portfolioId: persisted.portfolioId };
  });

  // ── Get one by id (auth-gated for personal portfolios) ──────────────
  app.get('/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const row = await getPortfolioById(db, req.params.id);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
    if (row.kind === 'personal') {
      // Personal portfolios are only visible to their owner. Signed-out
      // users get a 404 (not 403) so the portfolio's existence stays
      // hidden — same pattern Linear / GitHub use for private resources.
      if (!req.user || req.user.id !== row.ownerUserId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
      }
    }
    return row;
  });

  // ── Candidate pool: every classified company, for the picker ─────────
  // We deliberately include AVOID-classified rows and drop the freshness
  // filter so the user sees the full universe and can pick anything that's
  // ever been scored. The engine still treats AVOID as no-sleeve at build
  // time, so picking one is harmless.
  app.get('/candidates', async (req) => {
    requireUser(req);
    const candidates = await buildCandidatesFromClassifications(db, {
      includeAvoid: true,
      maxAgeDays: 365 * 5,
    });
    return candidates;
  });

  // ── Rebalance: build a new version from current classifications ─────
  app.post(
    '/:id/rebalance',
    { schema: { params: IdParams, body: RebalanceBody } },
    async (req, reply) => {
      const user = requireUser(req);
      const existing = await getPortfolioById(db, req.params.id);
      if (!existing) return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
      if (existing.ownerUserId !== user.id) {
        throw new AuthorizationError('only the owner may rebalance');
      }

      // Keep the original name verbatim — no `(vN)` suffix. The new portfolio
      // is a fresh row (history preserved) but listed under the same name as
      // the source, so the user's portfolio list doesn't get cluttered.
      const newName = existing.name.replace(/\s*\(v\d+\)\s*$/, '');

      const constraints = existing.constraints as typeof PortfolioConstraints._type;

      // Pull the candidate pool with the optional sector filter, then drop
      // any entities the caller explicitly excluded. Excludes win — so the
      // user can both narrow by sector and surgically remove a holding.
      let candidates = await buildCandidatesFromClassifications(db, {
        sectorFilter: req.body?.sectorFilter,
      });
      const excludeSet = new Set(req.body?.excludeEntities ?? []);
      if (excludeSet.size > 0) {
        candidates = candidates.filter((c) => !excludeSet.has(c.entity));
      }

      const result = constructPortfolio(candidates, constraints);
      const persisted = await persistPortfolio(db, {
        ownerUserId: user.id,
        kind: 'personal',
        name: newName,
        constraints,
        result,
        candidatesUsed: candidates,
      });
      return { portfolioId: persisted.portfolioId };
    },
  );

  // ── Publish / unpublish / delete ────────────────────────────────────
  app.post(
    '/:id/publish',
    { schema: { params: IdParams, body: PublishBody } },
    async (req) => {
      const user = requireUser(req);
      // Validate slug shape up front so the error is surfaced cleanly to
      // the client before we touch the DB.
      validateSlug(req.body.slug);
      return publishPortfolio(db, req.params.id, user.id, req.body.slug, req.body.description);
    },
  );

  app.post(
    '/:id/rename',
    { schema: { params: IdParams, body: RenameBody } },
    async (req) => {
      const user = requireUser(req);
      return renamePortfolio(db, req.params.id, user.id, req.body.name);
    },
  );

  app.post('/:id/unpublish', { schema: { params: IdParams } }, async (req) => {
    const user = requireUser(req);
    return unpublishPortfolio(db, req.params.id, user.id);
  });

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => {
    const user = requireUser(req);
    await deletePortfolio(db, req.params.id, user.id);
    return { deleted: true };
  });

  // ── Admin-style system rebuild ───────────────────────────────────────
  // Phase 5 has no admin role. Gate by hard-coded email until Phase 10 adds
  // proper RBAC. The cron worker is the canonical path; this endpoint exists
  // for first-time setup and on-demand rebuilds.
  app.post('/system/rebuild', async (req, reply) => {
    const user = requireUser(req);
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail || user.email.toLowerCase() !== adminEmail.toLowerCase()) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'admin-only endpoint' });
    }
    const result = await rebuildSystemPortfolio(db);
    return result;
  });
};

// NotFoundError import is intentional — exported types are re-used by callers.
void NotFoundError;
