import 'dotenv/config';
import { sendWeeklyProgressReport } from '../jobs/weeklyProgressReport.js';
import { closeQueues } from '../queues/index.js';

/**
 * One-shot: fire the weekly Vantage progress email immediately. Same code path
 * the Sunday cron uses — useful for verifying Resend config (EMAIL_FROM domain
 * verified, RESEND_API_KEY set) without waiting for the scheduled slot.
 *
 *   pnpm --filter @vantage/api progress:send-now
 *   TO=other@example.com pnpm --filter @vantage/api progress:send-now
 */

async function main(): Promise<void> {
  const to = process.env.TO;
  process.stderr.write(`Sending weekly progress report${to ? ` to ${to}` : ''}…\n`);

  const result = await sendWeeklyProgressReport(to ? { to } : {});
  process.stderr.write(
    `Done. to=${result.to} dispatched=${result.dispatched} ` +
      `universe=${result.metrics.universeSize} scoredFresh=${result.metrics.scoredFresh} ` +
      `sweepDays=${result.metrics.sweepCount}/7\n`,
  );

  await closeQueues();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(
      `send-progress-report failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
  });
