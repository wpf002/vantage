import 'dotenv/config';
import { scoreUniverse } from '../jobs/universeScore.js';
import { closeQueues } from '../queues/index.js';

/**
 * One-shot: run a full Public Score sweep over `platform_companies` on demand,
 * the same path the daily `scoreUniverse` cron (01:00 UTC) takes. Use this to
 * populate `public_scores` immediately instead of waiting for the next cron —
 * e.g. right after a fresh `load:universe`.
 *
 * Run from the repo root:
 *   pnpm --filter @vantage/api score:universe
 * or with overrides:
 *   LIMIT=50 pnpm --filter @vantage/api score:universe
 *   UNIVERSE_SCORE_DELAY_MS=1000 pnpm --filter @vantage/api score:universe
 *   RESUME=1 pnpm --filter @vantage/api score:universe   # skip already-scored
 *
 * RESUME=1 skips tickers that already have a persisted score, so a sweep that
 * was killed partway can be relaunched without redoing completed work.
 *
 * Heads-up: a full ~3,000-ticker pass takes ~2 hours and makes ~9 FMP calls
 * per ticker (~27k total). Verify your FMP plan's daily quota before running
 * the whole universe; use LIMIT to test on a slice first.
 */

async function main(): Promise<void> {
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;
  const resume = process.env.RESUME === '1' || process.env.RESUME === 'true';

  process.stderr.write(
    `Scoring public universe (limit=${limit ?? 'none — full universe'}, resume=${resume})…\n`,
  );

  const result = await scoreUniverse({
    ...(limit ? { limit } : {}),
    ...(resume ? { skipScored: true } : {}),
  });
  process.stderr.write(
    `Done. scanned=${result.scanned} scored=${result.scored} skipped=${result.skipped} failed=${result.failed}\n`,
  );

  await closeQueues();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`score-universe failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
