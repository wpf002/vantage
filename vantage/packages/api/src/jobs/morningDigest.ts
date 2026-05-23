import pino from 'pino';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { listActiveDigestRules, markRuleFired } from '../db/alertStore.js';
import { MorningDigestConfig, labelDisplay } from '../alerts/config.js';
import { dispatchEmail, eventsFeedUrl, userEmail } from '../workers/alert-dispatch.js';

/**
 * Phase 10 — Morning Read digest. Time-based (the one alert exception to the
 * reactive model), run every 15 min by the cron. Each tick, send to any
 * morning_digest rule whose local send-hour has arrived and which hasn't
 * already fired today in the user's timezone. Email only — a daily web push
 * would be too noisy.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.morning-digest' });

interface LocalParts {
  hour: number;
  dateStr: string; // YYYY-MM-DD in the target timezone
}

function localParts(timeZone: string, when: Date = new Date()): LocalParts | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
    });
    const parts = fmt.formatToParts(when);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const hourRaw = get('hour');
    const hour = Number(hourRaw === '24' ? '0' : hourRaw);
    const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
    return { hour, dateStr };
  } catch {
    return null; // invalid timezone
  }
}

interface DigestMover {
  ticker: string;
  name: string | null;
  score: number;
  label: string;
  delta: number;
}

interface Digest {
  asOf: string;
  moversUp: DigestMover[];
  moversDown: DigestMover[];
  breakdowns: DigestMover[];
}

/** Build a compact Morning Read for the most recent qualifying scored day. */
async function buildDigest(): Promise<Digest | null> {
  const resolved = (await db.execute(sql`
    SELECT to_char(as_of::date, 'YYYY-MM-DD') AS d
    FROM public_scores
    GROUP BY as_of::date
    HAVING count(*) >= 5
    ORDER BY as_of::date DESC
    LIMIT 1
  `)) as unknown as Array<{ d: string }>;
  const asOf = resolved[0]?.d;
  if (!asOf) return null;

  const rows = (await db.execute(sql`
    WITH t AS (
      SELECT DISTINCT ON (ps.ticker) ps.ticker, ps.score, ps.label, ps.as_of, c.name
      FROM public_scores ps
      LEFT JOIN platform_companies c ON c.ticker = ps.ticker
      WHERE ps.as_of >= ${asOf}::date AND ps.as_of < (${asOf}::date + interval '1 day')
      ORDER BY ps.ticker, ps.as_of DESC
    ), p AS (
      SELECT DISTINCT ON (ticker) ticker, score, label
      FROM public_scores
      WHERE as_of < ${asOf}::date
      ORDER BY ticker, as_of DESC
    )
    SELECT t.ticker, t.name, t.score, t.label, (t.score - p.score) AS delta, p.label AS prior_label
    FROM t JOIN p ON p.ticker = t.ticker
    WHERE p.score IS NOT NULL
  `)) as unknown as Array<{
    ticker: string;
    name: string | null;
    score: number;
    label: string;
    delta: number;
    prior_label: string;
  }>;

  const mapped: DigestMover[] = rows.map((r) => ({
    ticker: r.ticker,
    name: r.name,
    score: r.score,
    label: r.label,
    delta: r.delta,
  }));
  const moversUp = [...mapped].filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const moversDown = [...mapped]
    .filter((m) => m.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 5);
  const breakdowns = rows
    .filter((r) => r.label === 'narrative_breakdown' && r.prior_label !== 'narrative_breakdown')
    .map((r) => ({ ticker: r.ticker, name: r.name, score: r.score, label: r.label, delta: r.delta }))
    .slice(0, 5);

  return { asOf, moversUp, moversDown, breakdowns };
}

function digestSection(title: string, movers: DigestMover[]): string {
  if (movers.length === 0) return '';
  const rows = movers
    .map(
      (m) =>
        `<tr><td style="padding:4px 12px 4px 0;font-family:'Courier New',monospace;font-size:12px;color:#7B7F89;">${m.ticker}</td>` +
        `<td style="padding:4px 0;font-size:15px;">${escapeHtml(m.name ?? m.ticker)}</td>` +
        `<td style="padding:4px 0 4px 12px;font-family:'Courier New',monospace;font-size:13px;text-align:right;">${m.score.toFixed(0)} (${m.delta > 0 ? '+' : ''}${m.delta.toFixed(1)})</td></tr>`,
    )
    .join('');
  return `<div style="font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.12em;font-size:11px;color:#A8201A;margin:24px 0 8px;">${escapeHtml(title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

function digestEmailHtml(digest: Digest): string {
  const breakdownRows =
    digest.breakdowns.length > 0
      ? digest.breakdowns
          .map(
            (m) =>
              `<tr><td style="padding:4px 12px 4px 0;font-family:'Courier New',monospace;font-size:12px;color:#7B7F89;">${m.ticker}</td>` +
              `<td style="padding:4px 0;font-size:15px;">${escapeHtml(m.name ?? m.ticker)} — ${labelDisplay(m.label)}</td></tr>`,
          )
          .join('')
      : '';
  const breakdownsBlock = breakdownRows
    ? `<div style="font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.12em;font-size:11px;color:#A8201A;margin:24px 0 8px;">New Narrative Breakdowns</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${breakdownRows}</table>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F5F2EC;padding:40px 0;font-family:Georgia,'Times New Roman',serif;color:#15161A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#FBFAF7;border:1px solid #B6B9C1;">
      <tr><td style="padding:32px 40px;">
        <div style="font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.12em;font-size:11px;color:#7B7F89;">Morning Read · ${digest.asOf}</div>
        <h1 style="font-size:28px;margin:12px 0 4px;letter-spacing:-0.015em;">What moved overnight</h1>
        ${digestSection('Biggest Moves Up', digest.moversUp)}
        ${digestSection('Biggest Moves Down', digest.moversDown)}
        ${breakdownsBlock}
        <p style="margin:28px 0 0;"><a href="${eventsFeedUrl().replace('/alerts', '/board')}" style="font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.06em;font-size:13px;color:#A8201A;text-decoration:none;border-bottom:2px solid #A8201A;padding-bottom:2px;">Open the full board →</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface MorningDigestResult {
  considered: number;
  sent: number;
  skipped: number;
}

export async function runMorningDigest(opts: { force?: boolean } = {}): Promise<MorningDigestResult> {
  const rules = await listActiveDigestRules(db);
  const result: MorningDigestResult = { considered: rules.length, sent: 0, skipped: 0 };
  if (rules.length === 0) return result;

  let digest: Digest | null = null;
  const now = new Date();

  for (const rule of rules) {
    let cfg;
    try {
      cfg = MorningDigestConfig.parse(rule.config);
    } catch {
      result.skipped++;
      continue;
    }
    const local = localParts(cfg.localTimezone, now);
    if (!local) {
      result.skipped++;
      continue;
    }

    const due = opts.force || local.hour >= cfg.sendHour;
    if (!due) {
      result.skipped++;
      continue;
    }
    // Already delivered today (in the user's tz)?
    if (!opts.force && rule.lastFiredAt) {
      const fired = localParts(cfg.localTimezone, rule.lastFiredAt);
      if (fired && fired.dateStr === local.dateStr) {
        result.skipped++;
        continue;
      }
    }

    if (digest === null) digest = await buildDigest();
    if (!digest) {
      result.skipped++;
      continue;
    }

    const email = await userEmail(db, rule.ownerUserId);
    if (!email) {
      result.skipped++;
      continue;
    }
    const channelResult = await dispatchEmail(
      email,
      `Vantage Morning Read · ${digest.asOf}`,
      digestEmailHtml(digest),
    );
    await markRuleFired(db, rule.id);
    if (channelResult === 'sent') result.sent++;
    else result.skipped++;
    log.info({ ruleId: rule.id, channelResult }, 'morning digest: dispatched');
  }

  return result;
}
