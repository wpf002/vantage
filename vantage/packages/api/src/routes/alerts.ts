import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthorizedError } from '@vantage/shared';
import { db } from '../db/client.js';
import {
  AlertChannels,
  AlertRuleType,
  describeRule,
  parseRuleConfig,
} from '../alerts/config.js';
import {
  acknowledgeAll,
  acknowledgeEvent,
  countUnread,
  createRule,
  deleteRule,
  deletePushSubscription,
  getRuleById,
  listEvents,
  listRulesForUser,
  updateRule,
  upsertPushSubscription,
} from '../db/alertStore.js';
import {
  alertEmailHtml,
  dispatchEmail,
  dispatchWebPush,
  tearSheetUrl,
  userEmail,
  type ChannelResult,
} from '../workers/alert-dispatch.js';
import { fireRule } from '../workers/alerts.js';

/**
 * Phase 10 — alert rules, the events inbox, and web-push subscription
 * management. Rules attach to a watchlist and fire reactively (see the alert
 * evaluator worker); events are the user's notification feed.
 */

const CreateRuleBody = z.object({
  watchlistId: z.string().uuid(),
  ruleType: AlertRuleType,
  config: z.record(z.unknown()),
  channels: AlertChannels,
});

const PatchRuleBody = z.object({
  config: z.record(z.unknown()).optional(),
  channels: AlertChannels.optional(),
  active: z.boolean().optional(),
});

const IdParams = z.object({ id: z.string().uuid() });

const EventsQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

const SubscribeBody = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
  userAgent: z.string().optional(),
});

const UnsubscribeBody = z.object({ endpoint: z.string().url().optional() });

function requireUser(req: { user: { id: string; email: string; name: string | null } | null }) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

function ruleView(row: Awaited<ReturnType<typeof getRuleById>>) {
  if (!row) return null;
  const config = row.config as Record<string, unknown>;
  return {
    id: row.id,
    watchlistId: row.watchlistId,
    ruleType: row.ruleType,
    config,
    channels: row.channels,
    active: row.active,
    summary: describeRule(row.ruleType as AlertRuleType, config),
    createdAt: row.createdAt.toISOString(),
    lastFiredAt: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
  };
}

export const alertsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Rules ────────────────────────────────────────────────────────────
  app.get('/rules', async (req) => {
    const user = requireUser(req);
    const rows = await listRulesForUser(db, user.id);
    return rows.map(ruleView);
  });

  app.post('/rules', { schema: { body: CreateRuleBody } }, async (req) => {
    const user = requireUser(req);
    const config = parseRuleConfig(req.body.ruleType, req.body.config);
    const created = await createRule(db, {
      watchlistId: req.body.watchlistId,
      ownerUserId: user.id,
      ruleType: req.body.ruleType,
      config,
      channels: req.body.channels,
    });
    return { ruleId: created.id };
  });

  app.patch('/rules/:id', { schema: { params: IdParams, body: PatchRuleBody } }, async (req) => {
    const user = requireUser(req);
    // If config is being changed, validate it against the existing ruleType.
    let config: Record<string, unknown> | undefined;
    if (req.body.config !== undefined) {
      const existing = await getRuleById(db, req.params.id);
      if (existing) config = parseRuleConfig(existing.ruleType as AlertRuleType, req.body.config);
    }
    return updateRule(db, req.params.id, user.id, {
      config,
      channels: req.body.channels,
      active: req.body.active,
    });
  });

  app.delete('/rules/:id', { schema: { params: IdParams } }, async (req) => {
    const user = requireUser(req);
    await deleteRule(db, req.params.id, user.id);
    return { deleted: true };
  });

  // CLI / settings end-to-end test: fire a rule with a synthetic trigger.
  app.post('/rules/:id/test-dispatch', { schema: { params: IdParams } }, async (req, reply) => {
    const user = requireUser(req);
    const rule = await getRuleById(db, req.params.id);
    if (!rule || rule.ownerUserId !== user.id) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'not found' });
    }
    const res = await fireRule(rule, {
      entity: 'TEST',
      triggerSignalId: null,
      payload: { test: true },
      what: 'Test dispatch',
    });
    return { dispatched: true, channelResults: res?.channelResults ?? {} };
  });

  // ── Events feed ──────────────────────────────────────────────────────
  app.get('/events', { schema: { querystring: EventsQuery } }, async (req) => {
    const user = requireUser(req);
    return listEvents(db, user.id, {
      cursor: req.query.cursor,
      limit: req.query.limit,
      unreadOnly: req.query.unreadOnly,
    });
  });

  app.get('/unread-count', async (req) => {
    const user = requireUser(req);
    return { count: await countUnread(db, user.id) };
  });

  app.post('/events/:id/acknowledge', { schema: { params: IdParams } }, async (req) => {
    const user = requireUser(req);
    await acknowledgeEvent(db, req.params.id, user.id);
    return { acknowledged: true };
  });

  app.post('/events/acknowledge-all', async (req) => {
    const user = requireUser(req);
    const count = await acknowledgeAll(db, user.id);
    return { acknowledged: count };
  });

  // ── Web push subscription ───────────────────────────────────────────
  app.get('/web-push/subscribe', async (req) => {
    requireUser(req);
    return {
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
      enabled: !!process.env.VAPID_PUBLIC_KEY,
    };
  });

  app.post('/web-push/subscribe', { schema: { body: SubscribeBody } }, async (req) => {
    const user = requireUser(req);
    await upsertPushSubscription(db, {
      userId: user.id,
      endpoint: req.body.subscription.endpoint,
      keys: req.body.subscription.keys,
      userAgent: req.body.userAgent ?? req.headers['user-agent'] ?? null,
    });
    return { subscribed: true };
  });

  app.delete('/web-push/subscribe', { schema: { body: UnsubscribeBody } }, async (req) => {
    const user = requireUser(req);
    await deletePushSubscription(db, user.id, req.body?.endpoint);
    return { unsubscribed: true };
  });

  // Send a test notification to the user's current channels (no event row).
  app.post('/test', async (req) => {
    const user = requireUser(req);
    const results: Record<string, ChannelResult> = {};
    results.web = await dispatchWebPush(db, user.id, {
      title: 'Vantage',
      body: 'Test alert — your notifications are working.',
      url: tearSheetUrl('NVDA'),
    });
    const email = await userEmail(db, user.id);
    results.email = email
      ? await dispatchEmail(
          email,
          'Vantage — Test Alert',
          alertEmailHtml({
            entityName: 'Vantage',
            whatChanged: 'This is a test alert. Your notifications are working.',
            when: new Date().toUTCString(),
            tearSheetUrl: tearSheetUrl('NVDA'),
          }),
        )
      : 'skipped';
    return { dispatched: true, channelResults: results };
  });
};
