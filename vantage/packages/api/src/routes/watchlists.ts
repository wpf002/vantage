import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthorizedError } from '@vantage/shared';
import { db } from '../db/client.js';
import {
  addWatchlistItem,
  createWatchlist,
  deleteWatchlist,
  getWatchlistWithItems,
  getWatchlistRow,
  listSystemWatchlists,
  listWatchlistsForUser,
  removeWatchlistItem,
  updateWatchlist,
} from '../db/watchlistStore.js';

/**
 * Phase 10 — watchlists. A per-user subset of entities. System-curated
 * watchlists (kind='system') are read-only and visible to any signed-in user.
 */

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
});

const AddItemBody = z.object({
  entity: z.string().min(1).max(64),
});

const IdParams = z.object({ id: z.string().uuid() });
const ItemParams = z.object({ id: z.string().uuid(), entity: z.string().min(1).max(64) });

function requireUser(req: { user: { id: string; email: string; name: string | null } | null }) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export const watchlistsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Public: system-curated watchlists ───────────────────────────────
  app.get('/system', async () => {
    return listSystemWatchlists(db);
  });

  // ── Authenticated: list mine + system ───────────────────────────────
  app.get('/', async (req) => {
    const user = requireUser(req);
    return listWatchlistsForUser(db, user.id);
  });

  app.post('/', { schema: { body: CreateBody } }, async (req) => {
    const user = requireUser(req);
    const created = await createWatchlist(db, {
      ownerUserId: user.id,
      name: req.body.name,
      description: req.body.description,
    });
    return { watchlistId: created.id };
  });

  // ── Detail with items (system viewable by any signed-in user) ───────
  app.get('/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const user = requireUser(req);
    const detail = await getWatchlistWithItems(db, req.params.id);
    if (!detail) return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
    if (detail.kind === 'personal' && detail.ownerUserId !== user.id) {
      // Hide existence of others' personal watchlists.
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
    }
    return detail;
  });

  app.patch('/:id', { schema: { params: IdParams, body: PatchBody } }, async (req) => {
    const user = requireUser(req);
    return updateWatchlist(db, req.params.id, user.id, {
      name: req.body.name,
      description: req.body.description,
    });
  });

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => {
    const user = requireUser(req);
    await deleteWatchlist(db, req.params.id, user.id);
    return { deleted: true };
  });

  app.post('/:id/items', { schema: { params: IdParams, body: AddItemBody } }, async (req) => {
    const user = requireUser(req);
    // Normalize public tickers to upper-case so de-dup is case-insensitive.
    const entity = req.body.entity.trim().toUpperCase();
    const res = await addWatchlistItem(db, req.params.id, user.id, entity);
    return { ...res, entity };
  });

  app.delete('/:id/items/:entity', { schema: { params: ItemParams } }, async (req) => {
    const user = requireUser(req);
    await removeWatchlistItem(db, req.params.id, user.id, req.params.entity);
    return { removed: true };
  });
};

// getWatchlistRow is exported for reuse by the alerts routes' ownership checks.
void getWatchlistRow;
