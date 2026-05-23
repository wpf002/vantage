import pino from 'pino';
import { db } from '../db/client.js';
import {
  eventExists,
  insertEvent,
  markRuleFired,
  setEventChannelResults,
  type AlertRuleRow,
} from '../db/alertStore.js';
import { AlertChannels } from './config.js';
import {
  alertEmailHtml,
  dispatchEmail,
  dispatchWebPush,
  tearSheetUrl,
  userEmail,
  type ChannelResult,
} from '../workers/alert-dispatch.js';

/**
 * Phase 10 — persist + dispatch an event for a fired rule. Queue-free so it
 * can be reused by the reactive evaluator, the morning-digest cron, the test
 * endpoint, and the CLI without pulling in BullMQ/Redis.
 *
 * Idempotent on (ruleId, triggerSignalId): a re-delivered signal won't
 * double-fire.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.alert-fire' });

export async function fireRule(
  rule: AlertRuleRow,
  input: {
    entity: string;
    entityName?: string;
    triggerSignalId: string | null;
    payload: Record<string, unknown>;
    what: string;
  },
): Promise<{ eventId: string; channelResults: Record<string, ChannelResult> } | null> {
  if (input.triggerSignalId && (await eventExists(db, rule.id, input.triggerSignalId))) {
    log.info({ ruleId: rule.id, signalId: input.triggerSignalId }, 'alert: already fired — skip');
    return null;
  }

  const channels = AlertChannels.parse(rule.channels);
  const ev = await insertEvent(db, {
    ruleId: rule.id,
    ownerUserId: rule.ownerUserId,
    entity: input.entity,
    triggerSignalId: input.triggerSignalId,
    payload: input.payload,
    channels,
  });

  const entityName = input.entityName ?? input.entity;
  const results: Record<string, ChannelResult> = {};

  if (channels.web) {
    results.web = await dispatchWebPush(db, rule.ownerUserId, {
      title: input.entity,
      body: `${input.entity} → ${input.what}`,
      url: tearSheetUrl(input.entity),
    });
  }
  if (channels.email) {
    const email = await userEmail(db, rule.ownerUserId);
    results.email = email
      ? await dispatchEmail(
          email,
          `${input.entity} — ${input.what}`,
          alertEmailHtml({
            entityName,
            whatChanged: input.what,
            when: new Date().toUTCString(),
            tearSheetUrl: tearSheetUrl(input.entity),
          }),
        )
      : 'skipped';
  }

  await setEventChannelResults(db, ev.id, results);
  await markRuleFired(db, rule.id);
  log.info({ ruleId: rule.id, entity: input.entity, results }, 'alert: fired');
  return { eventId: ev.id, channelResults: results };
}
