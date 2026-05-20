import { and, asc, isNull, lt, ne, sql } from 'drizzle-orm';
import pino from 'pino';
import { FmpClient } from '@vantage/data-ingest/public';
import { schema, type DB } from '../db/client.js';
import { resolvePublicScore } from './outcomes/public-score.js';
import { resolvePrivateValuation } from './outcomes/private-valuation.js';
import { resolveClassification } from './outcomes/classification.js';
import { resolvePortfolio } from './outcomes/portfolio.js';
import type { DecisionRow, OutcomeContext, ResolvedOutcome } from './outcomes/shared.js';

/**
 * Phase 8 outcome-backfill dispatcher.
 *
 * Every decision logged since Phase 2 carried a null outcomePayload. This job
 * closes the loop: for each decision older than 30 days that hasn't been
 * resolved, it dispatches to a per-type resolver, fills outcomePayload, and
 * stamps outcomeAt. Simulations are stress tests, not predictions about
 * realized outcomes, so they're filtered out before the loop.
 *
 * Best-effort and idempotent. A resolver that returns null leaves the decision
 * unresolved (skipped — insufficient data) for the next nightly run; a resolver
 * that throws is logged and counted as a failure but never corrupts or deletes
 * the decision. Re-running after everything is resolved is a no-op.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.outcomes' });

const RESOLVE_AGE_DAYS = 30;
/** Private re-runs are real FMP + alt-data calls — cap per night to protect the budget. */
const MAX_PRIVATE_RERUNS = 50;

export interface BackfillSummary {
  processed: number;
  resolved: number;
  failed: number;
  skipped: number;
}

export async function runOutcomeBackfill(db: DB): Promise<BackfillSummary> {
  const cutoff = new Date(Date.now() - RESOLVE_AGE_DAYS * 24 * 60 * 60 * 1000);

  const decisions = (await db
    .select({
      id: schema.platformDecisions.id,
      entity: schema.platformDecisions.entity,
      decisionType: schema.platformDecisions.decisionType,
      decisionPayload: schema.platformDecisions.decisionPayload,
      createdAt: schema.platformDecisions.createdAt,
    })
    .from(schema.platformDecisions)
    .where(
      and(
        isNull(schema.platformDecisions.outcomePayload),
        lt(schema.platformDecisions.createdAt, cutoff),
        ne(schema.platformDecisions.decisionType, 'simulation'),
      ),
    )
    .orderBy(asc(schema.platformDecisions.createdAt))) as DecisionRow[];

  const fmpApiKey = process.env.FMP_API_KEY ?? null;
  const ctx: OutcomeContext = {
    fmpApiKey,
    fmp: fmpApiKey ? new FmpClient({ apiKey: fmpApiKey }) : null,
  };

  log.info(
    { candidates: decisions.length, hasFmp: !!ctx.fmp },
    'outcomes: backfill start',
  );

  const summary: BackfillSummary = { processed: 0, resolved: 0, failed: 0, skipped: 0 };
  let privateReruns = 0;

  for (const decision of decisions) {
    summary.processed += 1;

    // Honor the private re-run cap (oldest first, so we already prioritized).
    if (decision.decisionType === 'private_valuation' && privateReruns >= MAX_PRIVATE_RERUNS) {
      summary.skipped += 1;
      continue;
    }

    let outcome: ResolvedOutcome;
    try {
      outcome = await dispatch(db, decision, ctx);
    } catch (err) {
      summary.failed += 1;
      log.error(
        {
          decisionId: decision.id,
          decisionType: decision.decisionType,
          entity: decision.entity,
          err: err instanceof Error ? err.message : String(err),
        },
        'outcomes: resolver failed — leaving unresolved for next run',
      );
      continue;
    }

    if (decision.decisionType === 'private_valuation') privateReruns += 1;

    if (outcome === null) {
      summary.skipped += 1;
      continue;
    }

    // Only mark resolved when the outcome fetch succeeded. Stamp outcomeAt.
    await db
      .update(schema.platformDecisions)
      .set({ outcomePayload: outcome, outcomeAt: new Date() })
      .where(sql`${schema.platformDecisions.id} = ${decision.id}`);
    summary.resolved += 1;
  }

  log.info(summary, 'outcomes: backfill done');
  return summary;
}

function dispatch(db: DB, decision: DecisionRow, ctx: OutcomeContext): Promise<ResolvedOutcome> {
  switch (decision.decisionType) {
    case 'public_score':
      return resolvePublicScore(db, decision, ctx);
    case 'private_valuation':
      return resolvePrivateValuation(db, decision);
    case 'classification':
      return resolveClassification(db, decision, ctx);
    case 'portfolio_construction':
      return resolvePortfolio(db, decision, ctx);
    default:
      // Unknown / non-predictive type (e.g. simulation slipped through) — skip.
      return Promise.resolve(null);
  }
}
