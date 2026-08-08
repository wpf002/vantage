/**
 * Reputation decay — update source credibility after an outcome is graded.
 *
 * Called by captureOutcomes() immediately after each decision is graded.
 * The function is fire-and-forget: errors are logged, not re-thrown, so
 * a reputation update failure never blocks the grading pipeline.
 *
 * Algorithm: exponential smoothing (applyOutcome in @vantage/evidence).
 *   new_score = (1 - rate) * old_score + rate * bonus
 *   bonus = 1.0 if correct, 0.0 if wrong.
 *   rate is halved while sample_count < MIN_SAMPLES_FOR_FULL_DECAY (= 5)
 *   to dampen early-sample noise.
 */

import pino from 'pino';
import { applyOutcome } from '@vantage/evidence';
import { getSourceKeysForDecision, getSourceState, upsertSourceReputation } from '../db/evidenceStore.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.evidence.reputation' });

/**
 * After grading a decision, update the credibility score for every source
 * that contributed evidence to that decision.
 *
 * @param decisionId - UUID of the platform_decision that was just graded
 * @param correct    - the graded outcome (true = prediction correct)
 */
export async function updateSourceReputationForDecision(
  decisionId: string,
  correct: boolean,
): Promise<void> {
  try {
    const sourceKeys = await getSourceKeysForDecision(decisionId);
    if (sourceKeys.length === 0) {
      // No reasoning path rows yet (decisions scored before Evidence Quality
      // was wired in will have no rows). Skip silently.
      return;
    }

    await Promise.all(
      sourceKeys.map(async (sourceKey) => {
        const state = await getSourceState(sourceKey);
        const current = state
          ? {
              credibilityScore: Number(state.credibilityScore),
              sampleCount: state.sampleCount,
              correctCount: state.correctCount,
              decayRate: state.decayRate ? Number(state.decayRate) : undefined,
            }
          : { credibilityScore: 0.65, sampleCount: 0, correctCount: 0 };

        const updated = applyOutcome(current, correct);
        await upsertSourceReputation(sourceKey, {
          credibilityScore: updated.credibilityScore,
          sampleCount: updated.sampleCount,
          correctCount: updated.correctCount,
        });

        log.debug(
          {
            sourceKey,
            decisionId,
            correct,
            before: current.credibilityScore.toFixed(4),
            after: updated.credibilityScore.toFixed(4),
          },
          'reputation updated',
        );
      }),
    );
  } catch (err) {
    log.warn({ decisionId, err: (err as Error).message }, 'reputation update failed — skipping');
  }
}
