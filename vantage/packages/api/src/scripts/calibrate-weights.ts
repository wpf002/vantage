import 'dotenv/config';
import { calibrateWeights } from '../jobs/calibrateWeights.js';
import { closeQueues } from '../queues/index.js';

/**
 * One-shot: run the Public Score weight-calibration step on demand — the same
 * path as the nightly `vantage.meta.calibrate` cron. Reads graded outcomes,
 * re-weights the EGS/NIS/NHS components by realized predictive power, and writes
 * a new `scoring_weights` row that the next scoring run picks up.
 *
 *   pnpm --filter @vantage/api calibrate:weights
 *
 * No-ops (leaves weights unchanged) until enough graded outcomes exist — graded
 * outcomes only appear once decisions age past the 30-day measurement horizon.
 */

async function main(): Promise<void> {
  const result = await calibrateWeights();
  process.stderr.write(`Done. ${JSON.stringify(result)}\n`);
  await closeQueues();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(
      `calibrate-weights failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
  });
