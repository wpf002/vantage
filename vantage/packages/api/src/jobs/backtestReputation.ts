/**
 * Reputation backtest — read-only simulation of reputation decay over
 * the existing graded decision history.
 *
 * This answers the question from the build spec (step 5):
 *   "show me whether it would have improved past signals before wiring it live"
 *
 * It does NOT modify any live data. It:
 *   1. Pulls all graded decisions (outcome_payload.correct !== null) in
 *      chronological order.
 *   2. For each decision, looks up which sources were involved via
 *      reasoning_paths + evidence_quality.
 *   3. Replays applyOutcome() sequentially, tracking per-source state.
 *   4. Compares accuracy under the seed credibility weights vs quality-weighted
 *      credibility (post-replay) using a simple weighted-average hit rate.
 *   5. Returns a BacktestReport — no DB writes.
 *
 * Note: because reasoning_paths rows are only written going forward (after
 * the Evidence Quality feature is wired in), the backtest will show low
 * source coverage for historical decisions. The report includes a
 * `coverageRate` field showing what fraction of graded decisions had
 * source-quality data.
 */

import pino from 'pino';
import { asc, isNotNull } from 'drizzle-orm';
import { applyOutcome, type BacktestReport } from '@vantage/evidence';
import { db, schema } from '../db/client.js';
import { getSourceKeysForDecision, getSourceState } from '../db/evidenceStore.js';
import type { OutcomePayload } from './outcomeCapture.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.evidence.backtest' });

interface SourceSimState {
  credibilityScore: number;
  sampleCount: number;
  correctCount: number;
}

export interface ExtendedBacktestReport extends BacktestReport {
  /** Fraction of graded decisions that had reasoning path / evidence quality rows. */
  coverageRate: number;
  /** Total number of source-outcome pairs replayed. */
  totalReplayPairs: number;
}

/**
 * Run a read-only backtest of source reputation decay over graded history.
 *
 * @param opts.limit  Max decisions to include (default: unlimited).
 * @param opts.decisionTypes  Which decision types to include (default: all gradable).
 */
export async function backtestReputation(
  opts: { limit?: number; decisionTypes?: string[] } = {},
): Promise<ExtendedBacktestReport> {
  const decisionTypes = opts.decisionTypes ?? ['public_score', 'classification'];

  log.info({ decisionTypes, limit: opts.limit }, 'backtest: start');

  // Pull graded decisions in chronological order so replay is time-ordered.
  const query = db
    .select({
      id: schema.platformDecisions.id,
      entity: schema.platformDecisions.entity,
      decisionType: schema.platformDecisions.decisionType,
      outcomePayload: schema.platformDecisions.outcomePayload,
      createdAt: schema.platformDecisions.createdAt,
    })
    .from(schema.platformDecisions)
    .where(isNotNull(schema.platformDecisions.outcomePayload))
    .orderBy(asc(schema.platformDecisions.createdAt));

  const decisions = opts.limit
    ? await query.limit(opts.limit)
    : await query;

  const gradedDecisions = decisions.filter(
    (d) =>
      decisionTypes.includes(d.decisionType) &&
      (d.outcomePayload as OutcomePayload | null)?.correct !== undefined,
  );

  log.info({ scanned: decisions.length, graded: gradedDecisions.length }, 'backtest: decisions loaded');

  // Per-source simulation state (seed from live DB, then replay from there).
  const simStates = new Map<string, SourceSimState>();

  let decisionsWithCoverage = 0;
  let totalReplayPairs = 0;

  // Unweighted accuracy (naive: each graded decision counts equally).
  let unweightedCorrect = 0;
  let unweightedTotal = 0;

  // Quality-weighted accuracy: each decision's contribution is weighted by
  // the average credibility of its contributing sources at replay time.
  let qualityWeightedCorrectSum = 0;
  let qualityWeightedTotalSum = 0;

  // Per-source breakdown accumulators.
  const sourceBreakdown = new Map<
    string,
    { sampleCount: number; correctCount: number }
  >();

  for (const decision of gradedDecisions) {
    const payload = decision.outcomePayload as OutcomePayload;
    const correct = payload.correct;

    unweightedTotal++;
    if (correct) unweightedCorrect++;

    // Look up which sources contributed to this decision.
    const sourceKeys = await getSourceKeysForDecision(decision.id);
    const hasCoverage = sourceKeys.length > 0;
    if (hasCoverage) decisionsWithCoverage++;

    // For each contributing source:
    //   - seed simState from live DB if first encounter
    //   - read current credibility (the "quality weight" for this decision)
    //   - apply outcome to advance the simulation forward
    let avgCredibility = 0;
    if (sourceKeys.length > 0) {
      let credSum = 0;
      for (const sk of sourceKeys) {
        if (!simStates.has(sk)) {
          // Seed from live DB (or use default if not seeded yet).
          const live = await getSourceState(sk);
          simStates.set(sk, {
            credibilityScore: live ? Number(live.credibilityScore) : 0.65,
            sampleCount: live ? live.sampleCount : 0,
            correctCount: live ? live.correctCount : 0,
          });
        }
        const state = simStates.get(sk)!;
        credSum += state.credibilityScore;

        // Update per-source breakdown tracker.
        const bd = sourceBreakdown.get(sk) ?? { sampleCount: 0, correctCount: 0 };
        bd.sampleCount++;
        if (correct) bd.correctCount++;
        sourceBreakdown.set(sk, bd);

        // Advance simulation.
        const updated = applyOutcome(state, correct);
        simStates.set(sk, {
          credibilityScore: updated.credibilityScore,
          sampleCount: updated.sampleCount,
          correctCount: updated.correctCount,
        });
        totalReplayPairs++;
      }
      avgCredibility = credSum / sourceKeys.length;
    } else {
      // No evidence quality data — fallback weight of 0.65 (neutral).
      avgCredibility = 0.65;
    }

    qualityWeightedTotalSum += avgCredibility;
    if (correct) qualityWeightedCorrectSum += avgCredibility;
  }

  const accuracyUnweighted = unweightedTotal > 0 ? unweightedCorrect / unweightedTotal : 0;
  const accuracyQualityWeighted =
    qualityWeightedTotalSum > 0 ? qualityWeightedCorrectSum / qualityWeightedTotalSum : 0;

  const breakdownRows = await Promise.all(
    [...sourceBreakdown.entries()].map(async ([sourceKey, bd]) => {
      const finalState = simStates.get(sourceKey);
      return {
        sourceKey,
        sampleCount: bd.sampleCount,
        correctCount: bd.correctCount,
        hitRate: bd.sampleCount > 0 ? bd.correctCount / bd.sampleCount : 0,
        finalCredibility: finalState?.credibilityScore ?? 0.65,
      };
    }),
  );
  breakdownRows.sort((a, b) => b.sampleCount - a.sampleCount);

  const report: ExtendedBacktestReport = {
    decisionsAnalyzed: gradedDecisions.length,
    gradedDecisions: gradedDecisions.length,
    accuracyUnweighted,
    accuracyQualityWeighted,
    delta: accuracyQualityWeighted - accuracyUnweighted,
    sourceBreakdown: breakdownRows,
    coverageRate: gradedDecisions.length > 0 ? decisionsWithCoverage / gradedDecisions.length : 0,
    totalReplayPairs,
  };

  log.info(
    {
      decisions: report.decisionsAnalyzed,
      unweightedAcc: (accuracyUnweighted * 100).toFixed(1) + '%',
      qualityWeightedAcc: (accuracyQualityWeighted * 100).toFixed(1) + '%',
      delta: (report.delta * 100).toFixed(2) + 'pp',
      coverageRate: (report.coverageRate * 100).toFixed(1) + '%',
      sources: breakdownRows.length,
    },
    'backtest: complete',
  );

  return report;
}
