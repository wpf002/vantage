/**
 * Persistence helpers for evidence quality tables.
 *
 * All writes are fire-and-forget from the caller's perspective — evidence
 * quality enriches the audit trail but is not on the critical path for
 * scoring or decisions. Errors are logged, not thrown.
 */

import pino from 'pino';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from './client.js';
import type { EvidenceQuality } from '@vantage/evidence';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.evidence' });

// ── Evidence quality ──────────────────────────────────────────────────────

/**
 * Persist an evidence quality assessment for a signal.
 * Silently skips if the signal_id already has a quality row (idempotent).
 */
export async function persistEvidenceQuality(
  signalId: string,
  quality: EvidenceQuality,
): Promise<void> {
  try {
    await db.insert(schema.evidenceQuality).values({
      signalId,
      sourceKey: quality.sourceKey,
      sourceCredibility: quality.sourceCredibility.toFixed(5),
      recencyScore: quality.recencyScore.toFixed(5),
      independenceScore: quality.independenceScore.toFixed(5),
      methodologicalStrength: quality.methodologicalStrength.toFixed(5),
      historicalReliability: quality.historicalReliability.toFixed(5),
      compositeScore: quality.compositeScore.toFixed(5),
      weightConfig: quality.weights,
    }).onConflictDoNothing();
  } catch (err) {
    log.warn({ signalId, err: (err as Error).message }, 'evidence quality persist failed');
  }
}

/**
 * Fetch evidence quality rows for a set of signal ids.
 * Returns a map of signal_id → EvidenceQuality composite score (for quick lookup).
 */
export async function getQualityBySignalIds(
  signalIds: string[],
): Promise<Map<string, number>> {
  if (signalIds.length === 0) return new Map();
  const rows = await db
    .select({
      signalId: schema.evidenceQuality.signalId,
      compositeScore: schema.evidenceQuality.compositeScore,
    })
    .from(schema.evidenceQuality)
    .where(inArray(schema.evidenceQuality.signalId, signalIds));
  return new Map(rows.map((r) => [r.signalId, Number(r.compositeScore)]));
}

// ── Evidence sources (reputation) ─────────────────────────────────────────

/**
 * Fetch a source's current state. Returns null if not found (unknown source).
 */
export async function getSourceState(sourceKey: string) {
  const rows = await db
    .select()
    .from(schema.evidenceSources)
    .where(eq(schema.evidenceSources.sourceKey, sourceKey))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert a source's reputation after observing an outcome.
 * Creates the row if it doesn't exist (for sources not in the seed list).
 */
export async function upsertSourceReputation(
  sourceKey: string,
  update: {
    credibilityScore: number;
    sampleCount: number;
    correctCount: number;
  },
): Promise<void> {
  try {
    await db
      .insert(schema.evidenceSources)
      .values({
        sourceKey,
        sourceType: inferSourceType(sourceKey),
        displayName: sourceKey,
        credibilityScore: update.credibilityScore.toFixed(5),
        sampleCount: update.sampleCount,
        correctCount: update.correctCount,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.evidenceSources.sourceKey,
        set: {
          credibilityScore: update.credibilityScore.toFixed(5),
          sampleCount: update.sampleCount,
          correctCount: update.correctCount,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    log.warn({ sourceKey, err: (err as Error).message }, 'source reputation upsert failed');
  }
}

// ── Reasoning paths ───────────────────────────────────────────────────────

export interface ReasoningPathRow {
  decisionId: string;
  entity: string;
  layer: string;
  layerScore?: number;
  thresholdKey?: string;
  thresholdValue?: number;
  fired: boolean;
  inputSignalIds: string[];
  qualityScores: Record<string, number>;
  compositeQuality?: number;
  sensitivity: Record<string, number>;
  maxSensitivitySignalId?: string;
  maxSensitivityDelta?: number;
}

/** Persist one or more reasoning path rows for a decision. */
export async function persistReasoningPaths(paths: ReasoningPathRow[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await db.insert(schema.reasoningPaths).values(
      paths.map((p) => ({
        decisionId: p.decisionId,
        entity: p.entity,
        layer: p.layer,
        layerScore: p.layerScore?.toFixed(5),
        thresholdKey: p.thresholdKey,
        thresholdValue: p.thresholdValue?.toFixed(5),
        fired: p.fired,
        inputSignalIds: p.inputSignalIds,
        qualityScores: p.qualityScores,
        compositeQuality: p.compositeQuality?.toFixed(5),
        sensitivity: p.sensitivity,
        maxSensitivitySignalId: p.maxSensitivitySignalId,
        maxSensitivityDelta: p.maxSensitivityDelta?.toFixed(7),
      })),
    );
  } catch (err) {
    log.warn({ decisionId: paths[0]?.decisionId, err: (err as Error).message }, 'reasoning path persist failed');
  }
}

/**
 * Fetch reasoning paths for a decision, ordered by layer.
 */
export async function getReasoningPaths(decisionId: string): Promise<typeof schema.reasoningPaths.$inferSelect[]> {
  return db
    .select()
    .from(schema.reasoningPaths)
    .where(eq(schema.reasoningPaths.decisionId, decisionId))
    .orderBy(schema.reasoningPaths.capturedAt);
}

/**
 * For a graded decision: fetch all source keys that contributed via
 * reasoning_paths → evidence_quality chain.
 */
export async function getSourceKeysForDecision(decisionId: string): Promise<string[]> {
  // Get input signal ids from all reasoning path rows
  const paths = await db
    .select({ inputSignalIds: schema.reasoningPaths.inputSignalIds })
    .from(schema.reasoningPaths)
    .where(eq(schema.reasoningPaths.decisionId, decisionId));

  const signalIds = paths
    .flatMap((p) => (p.inputSignalIds as string[]) ?? [])
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (signalIds.length === 0) return [];

  // Look up source keys from evidence_quality
  const qualityRows = await db
    .select({ sourceKey: schema.evidenceQuality.sourceKey })
    .from(schema.evidenceQuality)
    .where(inArray(schema.evidenceQuality.signalId, [...new Set(signalIds)]));

  return [...new Set(qualityRows.map((r) => r.sourceKey))];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function inferSourceType(key: string): string {
  if (key.startsWith('fmp:market_data')) return 'market_data';
  if (key.startsWith('fmp:earnings') || key.startsWith('fmp:estimate')) return 'analyst_estimate';
  if (key.startsWith('sec:')) return 'sec_filing';
  if (key.startsWith('news:')) return 'news_wire';
  if (key.startsWith('alt_data:')) return 'alt_data';
  if (key.startsWith('ml:')) return 'ml_model';
  return 'unknown';
}
