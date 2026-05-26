import { and, eq } from 'drizzle-orm';
import pino from 'pino';
import { db, schema } from '../db/client.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.ensure-digest' });

const DEFAULT_SEND_HOUR = Number(process.env.MORNING_DIGEST_DEFAULT_HOUR ?? 7);
const DEFAULT_TZ = process.env.MORNING_DIGEST_DEFAULT_TZ ?? 'America/New_York';

/**
 * Boot-time idempotent provisioning. If `ADMIN_EMAIL` resolves to a user and
 * that user has no active morning_digest rule, create one against their first
 * personal watchlist (creating a "My Watchlist" if they have none). Without
 * this, a fresh deploy has no rules for the digest cron to fire against and
 * the user never sees an email even when Resend + the worker are healthy.
 */
export async function ensureAdminMorningDigestRule(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  try {
    const users = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, adminEmail.toLowerCase()))
      .limit(1);
    const userId = users[0]?.id;
    if (!userId) {
      log.info({ adminEmail }, 'no user found for ADMIN_EMAIL — skipping digest provisioning');
      return;
    }

    const existing = await db
      .select({ id: schema.platformAlertRules.id })
      .from(schema.platformAlertRules)
      .where(
        and(
          eq(schema.platformAlertRules.ownerUserId, userId),
          eq(schema.platformAlertRules.ruleType, 'morning_digest'),
          eq(schema.platformAlertRules.active, true),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    const watchlists = await db
      .select({ id: schema.platformWatchlists.id })
      .from(schema.platformWatchlists)
      .where(
        and(
          eq(schema.platformWatchlists.ownerUserId, userId),
          eq(schema.platformWatchlists.kind, 'personal'),
        ),
      )
      .limit(1);
    let watchlistId = watchlists[0]?.id;
    if (!watchlistId) {
      const [row] = await db
        .insert(schema.platformWatchlists)
        .values({ name: 'My Watchlist', ownerUserId: userId, kind: 'personal' })
        .returning({ id: schema.platformWatchlists.id });
      watchlistId = row!.id;
    }

    await db.insert(schema.platformAlertRules).values({
      watchlistId,
      ownerUserId: userId,
      ruleType: 'morning_digest',
      config: { localTimezone: DEFAULT_TZ, sendHour: DEFAULT_SEND_HOUR },
      channels: { web: false, email: true },
    });
    log.info(
      { userId, sendHour: DEFAULT_SEND_HOUR, tz: DEFAULT_TZ },
      'provisioned default morning_digest rule',
    );
  } catch (err) {
    log.error({ err: (err as Error).message }, 'failed to provision admin digest rule');
  }
}
