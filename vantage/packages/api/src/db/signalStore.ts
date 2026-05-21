import { eq } from 'drizzle-orm';
import { flattenLineage } from '@vantage/harmonizer';
import type { Signal, Sector } from '@vantage/shared';
import type { ClassificationResult } from '@vantage/classification';
import type { LivePrivateValuationResult } from '@vantage/core-private/orchestrator';
import type { LivePublicScoreResult } from '@vantage/core-public/orchestrator';
import type { FmpProfile } from '@vantage/data-ingest/public';
import { schema, type DB } from './client.js';
import { harmonizeQueue } from '../queues/index.js';

/**
 * Persistence for harmonized signals and live private valuations.
 *
 * persistSignal writes a Signal + its flattened transformChain inside one
 * transaction. persistLiveValuation layers the decision-log row (for Phase 8
 * meta-learning) and the raw alt-data snapshots on top.
 */

/**
 * Persist a harmonized Signal and its lineage. Returns the new signal id.
 *
 * After the transaction commits, the signal is enqueued onto the Phase 4
 * harmonize queue. The enqueue is best-effort: if Redis is unreachable we log
 * and move on rather than fail the write — the worker queue is meant to be
 * decoupled from request persistence, not transactional with it.
 */
export async function persistSignal(db: DB, signal: Signal): Promise<string> {
  const signalId = await db.transaction(async (tx) => {
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

    const id = row!.id;

    const lineage = flattenLineage(signal);
    if (lineage.length > 0) {
      await tx.insert(schema.platformAudit).values(
        lineage.map((step) => ({
          signalId: id,
          step: step.step,
          op: step.op,
          inputs: step.inputs,
          output: step.output,
          weight: step.weight,
          timestamp: new Date(step.ts),
        })),
      );
    }

    return id;
  });

  try {
    await harmonizeQueue.add('harmonize', {
      signalId,
      entity: signal.entity,
      signalType: signal.signalType,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[signalStore] failed to enqueue harmonize job', err);
  }

  return signalId;
}

export interface PersistClassificationResult {
  classificationId: string;
  decisionId: string;
}

/**
 * Persist a ClassificationResult: one row in platform_classifications, and a
 * mirrored decision-log entry for Phase 8 meta-learning. No uniqueness
 * constraint on entity — each run inserts a fresh row, and the
 * /v1/classifications endpoint surfaces only the most recent per entity.
 */
export async function persistClassification(
  db: DB,
  result: ClassificationResult,
  triggeredBySignalId: string,
): Promise<PersistClassificationResult> {
  const asOf = new Date(result.asOf);

  const [row] = await db
    .insert(schema.platformClassifications)
    .values({
      entity: result.entity,
      assetClass: result.classification,
      confidence: result.confidence,
      rationale: result.rationale,
      contributingSignals: result.contributingSignals,
      asOf,
    })
    .returning({ id: schema.platformClassifications.id });
  const classificationId = row!.id;

  const [decisionRow] = await db
    .insert(schema.platformDecisions)
    .values({
      entity: result.entity,
      decisionType: 'classification',
      decisionPayload: { result, triggeredBySignalId },
      outcomePayload: null,
    })
    .returning({ id: schema.platformDecisions.id });
  const decisionId = decisionRow!.id;

  return { classificationId, decisionId };
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

/**
 * Map FMP's freeform sector string onto the Vantage `Sector` enum. Best-effort
 * substring match — anything unrecognized falls back to 'other'.
 */
export function mapSectorString(raw: string | undefined): Sector {
  if (!raw) return 'other';
  const s = raw.toLowerCase();
  if (s.includes('tech')) return 'technology';
  if (s.includes('health') || s.includes('pharma') || s.includes('biotech')) return 'healthcare';
  if (s.includes('financ') || s.includes('bank') || s.includes('insurance')) return 'financials';
  if (s.includes('communication')) return 'communication_services';
  if (s.includes('consumer') && (s.includes('cyclical') || s.includes('discretionary'))) {
    return 'consumer_discretionary';
  }
  if (s.includes('consumer') && (s.includes('defensive') || s.includes('staple'))) {
    return 'consumer_staples';
  }
  if (s.includes('industrial')) return 'industrials';
  if (s.includes('energy') || s.includes('oil') || s.includes('gas')) return 'energy';
  if (s.includes('material') || s.includes('mining') || s.includes('chemical')) return 'materials';
  if (s.includes('utilit')) return 'utilities';
  if (s.includes('real estate') || s.includes('reit')) return 'real_estate';
  return 'other';
}

/**
 * Look up — or create — the `platform_companies` row for a public ticker.
 * Universal search relies on this: any FMP-resolvable ticker becomes a seeded
 * company the first time it's scored. lifeStage defaults to 'public_mature'
 * (Phase 8 meta-learning can refine it later).
 */
export async function ensureCompany(db: DB, profile: FmpProfile) {
  // Phase 9 — the screener filters by market cap, so stash it (USD) on the
  // company's metadata at the wire boundary. Best-effort: FMP omits it for
  // some tickers, and pre-Phase-9 rows simply read back null.
  const metadata = profile.marketCap != null ? { marketCap: profile.marketCap } : null;

  const existing = await db
    .select()
    .from(schema.platformCompanies)
    .where(eq(schema.platformCompanies.ticker, profile.symbol))
    .limit(1);
  if (existing.length > 0) {
    const row = existing[0]!;
    // Backfill a freshly-available market cap onto an older row that lacks one.
    const existingCap = (row.metadata as { marketCap?: number } | null)?.marketCap;
    if (profile.marketCap != null && existingCap == null) {
      await db
        .update(schema.platformCompanies)
        .set({ metadata: { ...(row.metadata as object | null), marketCap: profile.marketCap } })
        .where(eq(schema.platformCompanies.id, row.id));
    }
    return row;
  }

  const [row] = await db
    .insert(schema.platformCompanies)
    .values({
      name: profile.companyName,
      marketType: 'public',
      ticker: profile.symbol,
      sector: mapSectorString(profile.sector),
      lifeStage: 'public_mature',
      country: 'US',
      metadata,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;

  // Lost an insert race against a concurrent request — the row exists now.
  const [raced] = await db
    .select()
    .from(schema.platformCompanies)
    .where(eq(schema.platformCompanies.ticker, profile.symbol))
    .limit(1);
  return raced!;
}

export interface PersistPublicScoreResult {
  signalId: string;
  decisionId: string;
}

/**
 * Persist a full live public score: the harmonized Signal + lineage, a
 * decision-log row carrying the raw FMP input snapshot, the three component
 * payloads, the assembled score, and the parsed product segments.
 */
export async function persistPublicScore(
  db: DB,
  result: LivePublicScoreResult,
): Promise<PersistPublicScoreResult> {
  const { result: score, signal, inputs } = result;
  const ticker = score.ticker;
  const asOf = new Date(score.asOf);

  const signalId = await persistSignal(db, signal);

  const [decisionRow] = await db
    .insert(schema.platformDecisions)
    .values({
      entity: ticker,
      decisionType: 'public_score',
      decisionPayload: inputs,
      outcomePayload: null, // filled in later by Phase 8 meta-learning
    })
    .returning({ id: schema.platformDecisions.id });
  const decisionId = decisionRow!.id;

  await db.insert(schema.publicEgs).values({ ticker, payload: score.components.egs, asOf });
  await db.insert(schema.publicNis).values({ ticker, payload: score.components.nis, asOf });
  await db.insert(schema.publicNhs).values({ ticker, payload: score.components.nhs, asOf });

  await db.insert(schema.publicScores).values({
    ticker,
    score: score.score,
    label: score.label,
    direction: score.direction,
    components: score.components,
    confidence: score.confidence,
    asOf,
  });

  await db.insert(schema.publicSegments).values({
    ticker,
    kind: 'product',
    payload: inputs.segments ?? [],
    asOf,
  });

  return { signalId, decisionId };
}
