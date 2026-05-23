import type Redis from 'ioredis';
import pino from 'pino';
import { db } from '../db/client.js';
import { connection } from '../queues/index.js';
import {
  activeRulesForEntity,
  latestTwoClassifications,
  latestTwoScores,
  type AlertRuleRow,
} from '../db/alertStore.js';
import {
  ClassificationTransitionConfig,
  LabelChangeConfig,
  ScoreMoveConfig,
  labelDisplay,
  type AlertRuleType,
} from '../alerts/config.js';
import { fireRule } from '../alerts/fire.js';

/**
 * Phase 10 — reactive alert evaluator. Subscribes to the Redis pub/sub channel
 * the harmonize worker publishes to (vantage.signals.harmonized), matches each
 * signal against active rules whose watchlists contain the entity, and fans
 * out notifications. No periodic scans — the signal stream drives everything.
 *
 * morning_digest rules are time-based and handled by a separate cron, not here.
 */

export const HARMONIZED_SIGNAL_CHANNEL = 'vantage.signals.harmonized';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.alert-evaluator' });

const PUBLIC_SCORE_SIGNAL = 'public.score';
const CLASSIFICATION_SIGNAL = 'platform.classification';

export interface HarmonizedSignalMessage {
  signalId: string;
  entity: string;
  signalType: string;
  direction?: number;
  magnitude?: number;
  timestamp?: string;
}

interface Trigger {
  payload: Record<string, unknown>;
  /** Short human description of what fired (eyebrow-cased by the UI). */
  what: string;
}

/** Build a trigger if `rule` fires for `signal`, else null. */
async function evaluateRule(
  rule: AlertRuleRow,
  signal: HarmonizedSignalMessage,
): Promise<Trigger | null> {
  const ruleType = rule.ruleType as AlertRuleType;
  const entity = signal.entity;

  if (ruleType === 'label_change' && signal.signalType === PUBLIC_SCORE_SIGNAL) {
    const scores = await latestTwoScores(db, entity);
    if (scores.length < 2) return null;
    const [cur, prior] = scores as [(typeof scores)[0], (typeof scores)[0]];
    if (cur.label === prior.label) return null;
    const cfg = LabelChangeConfig.parse(rule.config);
    if (cfg.targetLabel && cfg.targetLabel !== cur.label) return null;
    return {
      payload: { fromLabel: prior.label, toLabel: cur.label, score: cur.score },
      what: `Moved to ${labelDisplay(cur.label)}`,
    };
  }

  if (ruleType === 'score_move' && signal.signalType === PUBLIC_SCORE_SIGNAL) {
    const scores = await latestTwoScores(db, entity);
    if (scores.length < 2) return null;
    const [cur, prior] = scores as [(typeof scores)[0], (typeof scores)[0]];
    const delta = cur.score - prior.score;
    const cfg = ScoreMoveConfig.parse(rule.config);
    if (Math.abs(delta) < cfg.thresholdPoints) return null;
    const dirOk =
      cfg.direction === 'either' ||
      (cfg.direction === 'up' && delta > 0) ||
      (cfg.direction === 'down' && delta < 0);
    if (!dirOk) return null;
    return {
      payload: { from: prior.score, to: cur.score, delta },
      what: `Score ${delta > 0 ? '+' : ''}${delta.toFixed(1)} → ${cur.score.toFixed(1)}`,
    };
  }

  if (ruleType === 'classification_transition' && signal.signalType === CLASSIFICATION_SIGNAL) {
    const cls = await latestTwoClassifications(db, entity);
    if (cls.length < 2) return null;
    const [cur, prior] = cls as [(typeof cls)[0], (typeof cls)[0]];
    if (cur.assetClass === prior.assetClass) return null;
    const cfg = ClassificationTransitionConfig.parse(rule.config);
    if (cfg.targetClass && cfg.targetClass !== cur.assetClass) return null;
    return {
      payload: { fromClass: prior.assetClass, toClass: cur.assetClass },
      what: `Reclassified ${prior.assetClass} → ${cur.assetClass}`,
    };
  }

  return null;
}

// fireRule lives in ../alerts/fire.js (queue-free) so the CLI and routes can
// reuse it without importing the BullMQ/Redis surface. Re-exported here for
// callers that already import it from the evaluator module.
export { fireRule };

async function handleMessage(raw: string): Promise<void> {
  let msg: HarmonizedSignalMessage;
  try {
    msg = JSON.parse(raw) as HarmonizedSignalMessage;
  } catch {
    log.warn({ raw }, 'alert evaluator: unparseable message');
    return;
  }
  if (!msg.entity || !msg.signalType) return;

  const rules = await activeRulesForEntity(db, msg.entity);
  for (const rule of rules) {
    try {
      const trigger = await evaluateRule(rule, msg);
      if (!trigger) continue;
      await fireRule(rule, {
        entity: msg.entity,
        triggerSignalId: msg.signalId ?? null,
        payload: trigger.payload,
        what: trigger.what,
      });
    } catch (err) {
      log.error({ ruleId: rule.id, err: (err as Error).message }, 'alert evaluator: rule failed');
    }
  }
}

let subscriber: Redis | null = null;

export function startAlertEvaluator(): void {
  if (subscriber) return; // idempotent
  // A subscriber connection can't issue normal commands, so duplicate the
  // shared connection rather than reusing it.
  subscriber = connection.duplicate();
  subscriber.on('error', (err) => log.error({ err: err.message }, 'alert evaluator: redis error'));
  subscriber.subscribe(HARMONIZED_SIGNAL_CHANNEL, (err) => {
    if (err) log.error({ err: err.message }, 'alert evaluator: subscribe failed');
    else log.info({ channel: HARMONIZED_SIGNAL_CHANNEL }, 'alert evaluator: subscribed');
  });
  subscriber.on('message', (_channel, raw) => {
    void handleMessage(raw);
  });
}

export async function stopAlertEvaluator(): Promise<void> {
  if (!subscriber) return;
  await subscriber.quit().catch(() => undefined);
  subscriber = null;
}
