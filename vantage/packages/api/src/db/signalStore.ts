import { flattenLineage } from '@vantage/harmonizer';
import type { Signal } from '@vantage/shared';
import type { LivePrivateValuationResult } from '@vantage/core-private/orchestrator';
import { schema, type DB } from './client.js';

/**
 * Persistence for harmonized signals and live private valuations.
 *
 * persistSignal writes a Signal + its flattened transformChain inside one
 * transaction. persistLiveValuation layers the decision-log row (for Phase 8
 * meta-learning) and the raw alt-data snapshots on top.
 */

/**
 * Persist a harmonized Signal and its lineage. Returns the new signal id.
 */
export async function persistSignal(db: DB, signal: Signal): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.platformSignals)
      .values({
        entity: signal.entity,
        signalType: signal.signalType,
        direction: signal.direction,
        magnitude: signal.magnitude,
        confidence: signal.confidence,
        sourceVersion: signal.sourceVersion,
        rationale: signal.rationale,
        metadata: signal.metadata ?? null,
        timestamp: new Date(signal.timestamp),
      })
      .returning({ id: schema.platformSignals.id });

    const signalId = row!.id;

    const lineage = flattenLineage(signal);
    if (lineage.length > 0) {
      await tx.insert(schema.platformAudit).values(
        lineage.map((step) => ({
          signalId,
          step: step.step,
          op: step.op,
          inputs: step.inputs,
          output: step.output,
          weight: step.weight,
          timestamp: new Date(step.ts),
        })),
      );
    }

    return signalId;
  });
}

export interface PersistLiveValuationResult {
  signalId: string;
  decisionId: string;
}

/**
 * Persist a full live private valuation: the blended Signal + lineage, a
 * decision-log row, and (when the platform company UUID is known) the raw
 * alt-data snapshots that fed the run.
 */
export async function persistLiveValuation(
  db: DB,
  result: LivePrivateValuationResult,
  platformCompanyId?: string,
): Promise<PersistLiveValuationResult> {
  const signalId = await persistSignal(db, result.signal);

  const [decisionRow] = await db
    .insert(schema.platformDecisions)
    .values({
      entity: result.signal.entity,
      decisionType: 'private_valuation',
      decisionPayload: result.inputs,
      outcomePayload: null, // filled in later by Phase 8 meta-learning
    })
    .returning({ id: schema.platformDecisions.id });

  const decisionId = decisionRow!.id;

  if (platformCompanyId) {
    const observedAt = new Date();
    const { github, patents, formD, tranco } = result.inputs;
    const altRows: Array<typeof schema.privateAltData.$inferInsert> = [];
    if (github) {
      altRows.push({ companyId: platformCompanyId, source: 'github', payload: github, observedAt });
    }
    if (patents) {
      altRows.push({ companyId: platformCompanyId, source: 'uspto', payload: patents, observedAt });
    }
    if (formD) {
      altRows.push({
        companyId: platformCompanyId,
        source: 'sec_edgar',
        payload: formD,
        observedAt,
      });
    }
    if (tranco) {
      altRows.push({ companyId: platformCompanyId, source: 'tranco', payload: tranco, observedAt });
    }
    if (altRows.length > 0) {
      await db.insert(schema.privateAltData).values(altRows);
    }
  }

  return { signalId, decisionId };
}
