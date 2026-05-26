import pino from 'pino';
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { listActiveDigestRules, markRuleFired } from '../db/alertStore.js';
import { MorningDigestConfig, labelDisplay } from '../alerts/config.js';
import { dispatchEmail, userEmail } from '../workers/alert-dispatch.js';

/**
 * Morning Read — daily editorial on what Vantage learned overnight. Not a
 * markets recap; an engine recap. Each section reports a layer of the
 * platform's intelligence:
 *
 *   1. What got smarter — meta-learning: decisions matured, rolling hit rate.
 *   2. What it learned about — biggest score moves, new labels formed.
 *   3. What got broader — universe coverage and narrative-tag activity.
 *   4. Current convictions — highest + lowest live scores.
 *
 * Time-based (the one alert exception to the reactive model), run every 15 min
 * by the cron. Each tick, send to any morning_digest rule whose local
 * send-hour has arrived and which hasn't already fired today in the user's
 * timezone. Email only — a daily web push would be too noisy.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.morning-digest' });

const UI_BASE =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000';

const DAY_MS = 24 * 60 * 60 * 1000;
// Trailing window for the rolling hit rate. 30d is the same horizon the weekly
// progress report uses for "engine quality".
const HIT_RATE_WINDOW_MS = 30 * DAY_MS;

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
    return null;
  }
}

interface ScoreMover {
  ticker: string;
  current: number;
  previous: number;
  delta: number;
  label: string;
}

interface LabelEntry {
  ticker: string;
  score: number;
  label: string;
}

interface ConvictionEntry {
  ticker: string;
  score: number;
  label: string;
}

export interface MorningMetrics {
  asOf: string; // YYYY-MM-DD UTC; the date the email is dated by
  windowStart: Date;
  windowEnd: Date;
  // Engine quality (meta-learning)
  decisionsMatured24h: number;
  rollingHitRatePct: number | null; // 30d
  rollingDecisionsGraded: number;
  // Signal highlights (24h)
  topMovers: ScoreMover[];
  newAlignedStrength: LabelEntry[];
  newNarrativeBreakdown: LabelEntry[];
  // Coverage (24h)
  universeSize: number;
  added24h: number;
  scoredFresh24h: number;
  narrativeTagsRefreshed24h: number;
  // Current convictions (snapshot — most recent score per ticker)
  topConvictions: ConvictionEntry[];
  bottomConvictions: ConvictionEntry[];
}

export async function computeMorningMetrics(): Promise<MorningMetrics> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - DAY_MS);
  const rollingStart = new Date(windowEnd.getTime() - HIT_RATE_WINDOW_MS);
  const windowStartIso = windowStart.toISOString();
  const rollingStartIso = rollingStart.toISOString();
  const asOf = windowEnd.toISOString().slice(0, 10);

  // ── Engine quality (meta-learning) ───────────────────────────────────
  const [matured24h] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.platformDecisions)
    .where(
      sql`${schema.platformDecisions.decisionType} = 'classification'
          AND ${schema.platformDecisions.outcomeAt} IS NOT NULL
          AND ${schema.platformDecisions.outcomeAt} >= ${windowStartIso}::timestamptz`,
    );

  const [rolling] = await db
    .select({
      total: sql<number>`count(*)::int`,
      hits: sql<number>`count(*) filter (
        where (outcome_payload->>'hit')::text in ('true','t')
        or (outcome_payload->'hit')::text = 'true'
      )::int`,
    })
    .from(schema.platformDecisions)
    .where(
      sql`${schema.platformDecisions.decisionType} = 'classification'
          AND ${schema.platformDecisions.outcomeAt} IS NOT NULL
          AND ${schema.platformDecisions.outcomeAt} >= ${rollingStartIso}::timestamptz`,
    );

  const rollingDecisionsGraded = rolling?.total ?? 0;
  const rollingHits = rolling?.hits ?? 0;
  const rollingHitRatePct =
    rollingDecisionsGraded > 0 ? (rollingHits / rollingDecisionsGraded) * 100 : null;

  // ── Signal highlights (24h) ──────────────────────────────────────────
  // Latest score in-window per ticker AND most-recent prior score from
  // before the window. Same shape as the weekly progress report query.
  const moversRaw = await db.execute<{
    ticker: string;
    current: number;
    previous: number;
    label: string;
  }>(sql`
    WITH ranked AS (
      SELECT ticker, score, label, as_of,
             ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS rn,
             (as_of >= ${windowStartIso}::timestamptz) AS in_window
      FROM public_scores
    ),
    latest_in AS (
      SELECT ticker, score AS current, label FROM ranked
      WHERE in_window = true AND rn = 1
    ),
    latest_before AS (
      SELECT ticker, score AS previous FROM (
        SELECT ticker, score, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS pr
        FROM public_scores
        WHERE as_of < ${windowStartIso}::timestamptz
      ) prev WHERE pr = 1
    )
    SELECT li.ticker, li.current, lb.previous, li.label
    FROM latest_in li JOIN latest_before lb ON lb.ticker = li.ticker
  `);

  const topMovers: ScoreMover[] = moversRaw
    .map((r) => ({
      ticker: r.ticker,
      current: Number(r.current),
      previous: Number(r.previous),
      delta: Number(r.current) - Number(r.previous),
      label: r.label,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  const newLabel = async (label: string): Promise<LabelEntry[]> => {
    const rows = await db.execute<{ ticker: string; score: number }>(sql`
      WITH ranked AS (
        SELECT ticker, score, label, as_of,
               ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS rn
        FROM public_scores
      ),
      latest_in AS (
        SELECT ticker, score, label FROM ranked WHERE rn = 1 AND label = ${label}
      ),
      previously AS (
        SELECT ticker, label FROM (
          SELECT ticker, label, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS pr
          FROM public_scores
          WHERE as_of < ${windowStartIso}::timestamptz
        ) p WHERE pr = 1
      )
      SELECT li.ticker, li.score
      FROM latest_in li
      LEFT JOIN previously prev ON prev.ticker = li.ticker
      WHERE prev.label IS DISTINCT FROM ${label}
      ORDER BY li.score DESC
      LIMIT 5
    `);
    return rows.map((r) => ({ ticker: r.ticker, score: Number(r.score), label }));
  };

  const newAlignedStrength = await newLabel('aligned_strength');
  const newNarrativeBreakdown = await newLabel('narrative_breakdown');

  // ── Coverage (24h) ───────────────────────────────────────────────────
  const [univ] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.platformCompanies)
    .where(sql`${schema.platformCompanies.marketType} = 'public'`);

  const [added] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.platformCompanies)
    .where(
      sql`${schema.platformCompanies.marketType} = 'public'
          AND ${schema.platformCompanies.createdAt} >= ${windowStartIso}::timestamptz`,
    );

  const [scored] = await db
    .select({ n: sql<number>`count(distinct ${schema.publicScores.ticker})::int` })
    .from(schema.publicScores)
    .where(sql`${schema.publicScores.asOf} >= ${windowStartIso}::timestamptz`);

  const [tagsRefreshed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.publicNarrativeTags)
    .where(sql`${schema.publicNarrativeTags.createdAt} >= ${windowStartIso}::timestamptz`);

  // ── Current convictions (snapshot) ───────────────────────────────────
  const convictions = await db.execute<{ ticker: string; score: number; label: string }>(sql`
    SELECT DISTINCT ON (ticker) ticker, score, label
    FROM public_scores
    ORDER BY ticker, as_of DESC
  `);
  const sortedHigh = [...convictions]
    .map((r) => ({ ticker: r.ticker, score: Number(r.score), label: r.label }))
    .sort((a, b) => b.score - a.score);
  const topConvictions = sortedHigh.slice(0, 5);
  const bottomConvictions = [...sortedHigh].reverse().slice(0, 5);

  return {
    asOf,
    windowStart,
    windowEnd,
    decisionsMatured24h: matured24h?.n ?? 0,
    rollingHitRatePct,
    rollingDecisionsGraded,
    topMovers,
    newAlignedStrength,
    newNarrativeBreakdown,
    universeSize: univ?.n ?? 0,
    added24h: added?.n ?? 0,
    scoredFresh24h: scored?.n ?? 0,
    narrativeTagsRefreshed24h: tagsRefreshed?.n ?? 0,
    topConvictions,
    bottomConvictions,
  };
}

// ─── Email rendering ──────────────────────────────────────────────────────

// Vantage palette / type stack — must match packages/ui/tailwind.config.ts and
// layout.tsx so the email reads as a Vantage artifact, not a third-party tool.
//   cream:      #F5F2EC (DEFAULT), #FBFAF7 (50), #EAE4D8 (200)
//   ink:        #15161A (900) #2A2C32 (800) #4A4D55 (700) #7B7F89 (500) #9DA1A8 (100 hairline) #B6B9C1 (300)
//   editorial:  #A8201A (DEFAULT), #7E1813 (dark)
//
// Email clients can't reliably load Google Fonts, so each stack lists the
// Google face first then degrades to the same Georgia / system-ui / mono
// fallbacks Tailwind picks. Numbers always use mono with tabular-nums for
// alignment across rows.
const F_DISPLAY = `'Playfair Display',Georgia,'Times New Roman',serif`;
const F_SERIF = `'Source Serif 4',Georgia,'Times New Roman',serif`;
const F_SANS = `'Inter',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif`;
const F_MONO = `'IBM Plex Mono',Menlo,Consolas,'Courier New',monospace`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fmtPct = (n: number, digits = 0): string => `${n.toFixed(digits)}%`;
const fmtSigned = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

// Eyebrow label — uppercase Inter at the small-caps tracking the UI uses.
function eyebrow(s: string, opts: { color?: string; size?: number } = {}): string {
  const color = opts.color ?? '#7B7F89';
  const size = opts.size ?? 11;
  return `<div style="font-family:${F_SANS};text-transform:uppercase;letter-spacing:0.12em;font-size:${size}px;color:${color};font-weight:500;">${escapeHtml(s)}</div>`;
}

function sectionHeading(s: string): string {
  return `<h2 style="font-family:${F_DISPLAY};font-size:20px;font-weight:400;margin:0 0 16px 0;letter-spacing:-0.015em;color:#15161A;line-height:1.25;">${escapeHtml(s)}</h2>`;
}

function metricRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:11px 16px 11px 0;font-family:${F_SANS};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#7B7F89;border-bottom:1px solid #EAE4D8;font-weight:500;">${escapeHtml(label)}</td>
    <td align="right" style="padding:11px 0 11px 16px;font-family:${F_MONO};font-size:14px;color:#15161A;border-bottom:1px solid #EAE4D8;font-variant-numeric:tabular-nums;white-space:nowrap;">${escapeHtml(value)}</td>
  </tr>`;
}

// Email clients (esp. Gmail) strip flexbox, so two-column ticker rows must be
// table cells or they collide ("TSLAscore 25"). Each row is its own
// fixed-width-aware table — ticker pinned left, value pinned right, optional
// sub-line spans both columns on its own row.
function tickerRow(t: { ticker: string; right: string; sub?: string }): string {
  const subRow = t.sub
    ? `<tr><td colspan="2" style="padding:3px 0 0 0;font-family:${F_SERIF};font-size:12px;color:#7B7F89;font-style:italic;letter-spacing:0;">${escapeHtml(t.sub)}</td></tr>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;border-collapse:collapse;">
    <tr>
      <td style="font-family:${F_MONO};font-size:13px;padding:0;vertical-align:baseline;letter-spacing:0.04em;">
        <a href="${UI_BASE}/public/${encodeURIComponent(t.ticker)}" style="color:#A8201A;text-decoration:none;">${escapeHtml(t.ticker)}</a>
      </td>
      <td align="right" style="font-family:${F_MONO};font-size:13px;color:#15161A;padding:0;vertical-align:baseline;white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(t.right)}</td>
    </tr>
    ${subRow}
  </table>`;
}

function emptyNote(s: string): string {
  return `<p style="margin:0 0 18px 0;color:#7B7F89;font-style:italic;font-family:${F_SERIF};font-size:14px;line-height:1.55;">${escapeHtml(s)}</p>`;
}

export function renderMorningEmailHtml(m: MorningMetrics): string {
  const moversBlock = m.topMovers.length
    ? m.topMovers
        .map((mv) =>
          tickerRow({
            ticker: mv.ticker,
            right: `${fmtSigned(mv.delta)}  →  ${mv.current.toFixed(0)}`,
            sub: labelDisplay(mv.label),
          }),
        )
        .join('')
    : emptyNote('No score moves yet — the engine needs at least two days of scoring data to compute deltas.');

  const labelBlock = (title: string, entries: LabelEntry[]): string => {
    if (entries.length === 0) return '';
    return `<div style="margin:24px 0 12px 0;">${eyebrow(title, { color: '#15161A', size: 10 })}</div>${entries
      .map((e) => tickerRow({ ticker: e.ticker, right: `score ${e.score.toFixed(0)}` }))
      .join('')}`;
  };

  const convictionBlock = (title: string, entries: ConvictionEntry[]): string => {
    if (entries.length === 0) return '';
    return `${sectionHeading(title)}${entries
      .map((e) =>
        tickerRow({
          ticker: e.ticker,
          right: e.score.toFixed(0),
          sub: labelDisplay(e.label),
        }),
      )
      .join('')}`;
  };

  const coveragePct =
    m.universeSize > 0 ? (m.scoredFresh24h / m.universeSize) * 100 : 0;

  const lede =
    m.scoredFresh24h === 0 && m.added24h === 0
      ? 'The engine is idle — no new scores or universe changes in the last 24 hours.'
      : `${m.scoredFresh24h.toLocaleString()} ticker${m.scoredFresh24h === 1 ? '' : 's'} re-scored. ` +
        `${(m.newAlignedStrength.length + m.newNarrativeBreakdown.length).toLocaleString()} new label transition${m.newAlignedStrength.length + m.newNarrativeBreakdown.length === 1 ? '' : 's'}. ` +
        `${m.decisionsMatured24h.toLocaleString()} decision${m.decisionsMatured24h === 1 ? '' : 's'} matured.`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vantage Morning Read · ${m.asOf}</title>
</head>
<body style="margin:0;padding:0;background:#F5F2EC;font-family:${F_SERIF};color:#15161A;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:48px 16px;">
  <tr><td align="center">
    <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#FBFAF7;border:1px solid #9DA1A8;">

      <!-- Masthead -->
      <tr><td style="padding:40px 48px 8px 48px;border-bottom:1px solid #9DA1A8;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:${F_DISPLAY};font-size:22px;font-weight:400;letter-spacing:-0.01em;color:#15161A;">Vantage</td>
            <td align="right" style="font-family:${F_MONO};font-size:11px;color:#7B7F89;letter-spacing:0.08em;text-transform:uppercase;">Morning Read · ${escapeHtml(m.asOf)}</td>
          </tr>
        </table>
      </td></tr>

      <!-- Lede -->
      <tr><td style="padding:36px 48px 8px 48px;">
        ${eyebrow('The engine, overnight')}
        <h1 style="font-family:${F_DISPLAY};font-size:34px;font-weight:400;margin:10px 0 16px 0;letter-spacing:-0.015em;line-height:1.1;color:#15161A;">What the engine learned overnight</h1>
        <p style="font-family:${F_SERIF};font-size:17px;line-height:1.55;color:#2A2C32;margin:0;">${escapeHtml(lede)}</p>
      </td></tr>

      <!-- What got smarter -->
      <tr><td style="padding:32px 48px 0 48px;">
        ${sectionHeading('What got smarter')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #9DA1A8;">
          ${metricRow('Decisions matured (24h)', m.decisionsMatured24h.toLocaleString())}
          ${metricRow('Hit rate (rolling 30d)', m.rollingHitRatePct === null ? 'not enough graded' : `${fmtPct(m.rollingHitRatePct, 1)} of ${m.rollingDecisionsGraded.toLocaleString()}`)}
        </table>
      </td></tr>

      <!-- What it learned about -->
      <tr><td style="padding:32px 48px 0 48px;">
        ${sectionHeading('What it learned about')}
        <div style="margin:0 0 12px 0;">${eyebrow('Biggest score moves', { color: '#15161A', size: 10 })}</div>
        ${moversBlock}
        ${labelBlock('New Aligned Strength', m.newAlignedStrength)}
        ${labelBlock('New Narrative Breakdown', m.newNarrativeBreakdown)}
      </td></tr>

      <!-- What got broader -->
      <tr><td style="padding:32px 48px 0 48px;">
        ${sectionHeading('What got broader')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #9DA1A8;">
          ${metricRow('Universe', `${m.universeSize.toLocaleString()} public tickers`)}
          ${metricRow('Added (24h)', m.added24h.toLocaleString())}
          ${metricRow('Scored fresh (24h)', `${m.scoredFresh24h.toLocaleString()} · ${fmtPct(coveragePct, 1)}`)}
          ${metricRow('Narrative tags refreshed (24h)', m.narrativeTagsRefreshed24h.toLocaleString())}
        </table>
      </td></tr>

      <!-- Convictions -->
      <tr><td style="padding:32px 48px 0 48px;">
        ${convictionBlock('Top current convictions', m.topConvictions)}
      </td></tr>
      ${
        m.bottomConvictions.length
          ? `<tr><td style="padding:24px 48px 0 48px;">${convictionBlock('Watching for breakdowns', m.bottomConvictions)}</td></tr>`
          : ''
      }

      <!-- Colophon -->
      <tr><td style="padding:36px 48px 40px 48px;border-top:1px solid #9DA1A8;margin-top:36px;">
        <p style="margin:24px 0 0 0;font-family:${F_SERIF};font-style:italic;font-size:13px;color:#7B7F89;line-height:1.55;">
          A daily account of how the engine is learning and growing. Reply to this email if anything looks off.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
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

  let metrics: MorningMetrics | null = null;
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
    if (!opts.force && rule.lastFiredAt) {
      const fired = localParts(cfg.localTimezone, rule.lastFiredAt);
      if (fired && fired.dateStr === local.dateStr) {
        result.skipped++;
        continue;
      }
    }

    if (metrics === null) metrics = await computeMorningMetrics();

    const email = await userEmail(db, rule.ownerUserId);
    if (!email) {
      result.skipped++;
      continue;
    }
    const channelResult = await dispatchEmail(
      email,
      `Vantage Morning Read · ${metrics.asOf} · what the engine learned overnight`,
      renderMorningEmailHtml(metrics),
    );
    await markRuleFired(db, rule.id);
    if (channelResult === 'sent') result.sent++;
    else result.skipped++;
    log.info({ ruleId: rule.id, channelResult }, 'morning digest: dispatched');
  }

  return result;
}
