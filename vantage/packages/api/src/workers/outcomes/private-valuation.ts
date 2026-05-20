import { VantageError } from '@vantage/shared';
import { runLivePrivateValuation } from '@vantage/core-private/orchestrator';
import { type DB } from '../../db/client.js';
import {
  buildPrivateValuationConfig,
  getCompanyIdentifiers,
} from '../../jobs/privateValuationConfig.js';
import { blendedBaseAsOf, type DecisionRow, type ResolvedOutcome } from './shared.js';

/**
 * Private-valuation outcome resolver.
 *
 * EXPENSIVE — re-runs the full live valuation pipeline (real FMP + alt-data
 * pulls). The dispatcher caps how many of these run per night and processes
 * oldest first. Compares the fresh base valuation against the original.
 *
 * Skips (returns null) rather than throwing on a missing config or a company
 * we don't cover, so a misconfig never burns a retry. Genuine upstream errors
 * from the orchestrator propagate so the dispatcher records a failure.
 */
export async function resolvePrivateValuation(
  db: DB,
  decision: DecisionRow,
): Promise<ResolvedOutcome> {
  const entity = decision.entity;
  if (!getCompanyIdentifiers(entity)) return null; // not a covered company — can't re-run

  const originalBase = await blendedBaseAsOf(db, entity, decision.createdAt);
  if (originalBase === null || originalBase === 0) return null; // no anchor to compare against

  let config;
  try {
    ({ config } = buildPrivateValuationConfig(entity));
  } catch (err) {
    // Missing API key / peer set — a config problem, not a transient failure.
    // Skip; the next run retries once the config is fixed.
    if (err instanceof VantageError) return null;
    throw err;
  }

  const result = await runLivePrivateValuation(config);
  const currentBase = result.blended.finalValuation.base;
  const deltaPct = (currentBase - originalBase) / originalBase;

  return {
    originalBase,
    currentBase,
    deltaPct,
    newConfidence: result.blended.confidence,
    resolvedAt: new Date().toISOString(),
  };
}
