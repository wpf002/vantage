import 'dotenv/config';
import { runMorningDigest } from '../jobs/morningDigest.js';
import { ensureAdminMorningDigestRule } from '../jobs/ensureAdminDigestRule.js';
import { closeQueues } from '../queues/index.js';

/**
 * One-shot: fire the Morning Read digest immediately, ignoring the per-rule
 * "already fired today" and send-hour gates. Same code path the every-15-min
 * cron uses — useful for verifying Resend config (EMAIL_FROM domain verified,
 * RESEND_API_KEY set) and that an active morning_digest rule exists for the
 * user, without waiting for the scheduled slot.
 *
 *   pnpm --filter @vantage/api digest:send-now
 */

async function main(): Promise<void> {
  process.stderr.write('Ensuring admin morning_digest rule exists…\n');
  await ensureAdminMorningDigestRule();

  process.stderr.write('Sending morning digest (forced)…\n');
  const result = await runMorningDigest({ force: true });
  process.stderr.write(
    `Done. considered=${result.considered} sent=${result.sent} skipped=${result.skipped}\n`,
  );

  await closeQueues();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(
      `send-digest-now failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
  });
