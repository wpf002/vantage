import webpush from 'web-push';
import { Resend } from 'resend';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { schema, type DB } from '../db/client.js';
import { listPushSubscriptions, deletePushSubscription } from '../db/alertStore.js';

/**
 * Phase 10 — alert dispatch. Web push and email are equal-weight channels;
 * each is tolerant of the other's failure. Notification copy is serif-stripped
 * plain text and links back to the relevant tear sheet.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.alert-dispatch' });

const UI_BASE = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000';
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Vantage <alerts@vantage.local>';

let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:alerts@vantage.local';
  if (!pub || !priv) {
    log.warn('VAPID keys not set — web push disabled');
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

let resendClient: Resend | null = null;
function resend(): Resend | null {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    log.warn('RESEND_API_KEY not set — email disabled');
    return null;
  }
  resendClient = new Resend(key);
  return resendClient;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
}

export type ChannelResult = 'sent' | 'failed' | 'skipped';

/** Tear sheet URL for an entity (ticker → public read; otherwise search). */
export function tearSheetUrl(entity: string): string {
  return `${UI_BASE}/public/${encodeURIComponent(entity)}`;
}

export function eventsFeedUrl(): string {
  return `${UI_BASE}/alerts`;
}

/**
 * Push to every subscription the user has. Returns 'sent' if at least one
 * subscription accepted, 'failed' if all attempts errored, 'skipped' if there
 * are no subscriptions or VAPID is unconfigured. Stale (410/404) subscriptions
 * are pruned.
 */
export async function dispatchWebPush(
  db: DB,
  userId: string,
  payload: PushNotificationPayload,
): Promise<ChannelResult> {
  if (!ensureVapid()) return 'skipped';
  const subs = await listPushSubscriptions(db, userId);
  if (subs.length === 0) return 'skipped';

  let anySent = false;
  for (const sub of subs) {
    const keys = sub.keys as { p256dh: string; auth: string };
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys },
        JSON.stringify(payload),
      );
      anySent = true;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription gone — prune it so we stop trying.
        await deletePushSubscription(db, userId, sub.endpoint).catch(() => undefined);
        log.info({ userId }, 'pruned stale push subscription');
      } else {
        log.warn({ userId, err: (err as Error).message }, 'web push send failed');
      }
    }
  }
  return anySent ? 'sent' : 'failed';
}

export async function dispatchEmail(
  to: string,
  subject: string,
  html: string,
): Promise<ChannelResult> {
  const client = resend();
  if (!client) return 'skipped';
  try {
    const { error } = await client.emails.send({ from: EMAIL_FROM, to, subject, html });
    if (error) {
      log.warn({ to, err: error.message }, 'resend email failed');
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    log.warn({ to, err: (err as Error).message }, 'resend email threw');
    return 'failed';
  }
}

export async function userEmail(db: DB, userId: string): Promise<string | null> {
  const rows = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
}

/** Editorial plain HTML for an alert email. */
export function alertEmailHtml(input: {
  entityName: string;
  whatChanged: string;
  when: string;
  tearSheetUrl: string;
}): string {
  const mobileStyles = `
    @media only screen and (max-width: 600px) {
      .v-outer { padding: 24px 0 !important; }
      .v-card { width: 100% !important; max-width: 100% !important; }
      .v-pad-body { padding: 28px 20px 20px !important; }
      .v-pad-foot { padding: 16px 20px 24px !important; }
      .v-eyebrow { font-size: 10px !important; letter-spacing: 0.08em !important; }
      .v-h1 { font-size: 22px !important; }
      .v-body { font-size: 16px !important; }
    }
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${mobileStyles}</style></head>
<body style="margin:0;background:#F5F2EC;font-family:Georgia,'Times New Roman',serif;color:#15161A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="v-outer" style="background:#F5F2EC;padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" class="v-card" style="max-width:520px;width:100%;background:#FBFAF7;border:1px solid #B6B9C1;">
      <tr><td class="v-pad-body" style="padding:32px 40px 24px;">
        <div class="v-eyebrow" style="font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.12em;font-size:11px;color:#A8201A;">Vantage Alert</div>
        <h1 class="v-h1" style="font-size:26px;margin:14px 0 6px;letter-spacing:-0.015em;">${escapeHtml(input.entityName)}</h1>
        <p class="v-body" style="font-size:17px;line-height:1.5;color:#2A2C32;margin:8px 0 4px;">${escapeHtml(input.whatChanged)}</p>
        <p style="font-family:'Courier New',monospace;font-size:12px;color:#7B7F89;margin:0 0 28px;">${escapeHtml(input.when)}</p>
        <a href="${input.tearSheetUrl}" style="font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.06em;font-size:13px;color:#A8201A;text-decoration:none;border-bottom:2px solid #A8201A;padding-bottom:2px;">View on Vantage →</a>
      </td></tr>
      <tr><td class="v-pad-foot" style="padding:18px 40px 28px;border-top:1px solid #EAE4D8;">
        <a href="${eventsFeedUrl()}" style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;color:#7B7F89;text-decoration:none;">See all activity →</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
