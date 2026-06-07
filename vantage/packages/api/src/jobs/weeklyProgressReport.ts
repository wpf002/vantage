import pino from 'pino';
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { dispatchEmail } from '../workers/alert-dispatch.js';

/**
 * Weekly Vantage growth report. A single email summarizing how the platform
 * itself is evolving: how many tickers are now covered and scored, what the
 * loudest reads of the week were, and how well the engine is grading out.
 *
 * Sends through Resend (same client as alerts/morning digest). Recipient is
 * `PROGRESS_REPORT_EMAIL` (defaults to the project owner). Scheduled by the
 * worker bootstrap via `ensureWeeklyProgressReportSchedule`.
 *
 * Metric groups (in the email, in this order):
 *   1. Coverage growth   — universe size, new this week, % scored fresh
 *   2. Signal highlights — top score moves, new Aligned Strength / Breakdown
 *   3. Engine quality    — sweep success rate, meta-learning hit rate
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vantage.progress-report' });

const DEFAULT_TO = process.env.PROGRESS_REPORT_EMAIL || 'wfoti71992@gmail.com';
const UI_BASE =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface ScoreMover {
  ticker: string;
  current: number;
  previous: number;
  delta: number;
  label: string;
}

interface NewLabelEntry {
  ticker: string;
  score: number;
}

export interface WeeklyMetrics {
  windowStart: Date;
  windowEnd: Date;
  // Coverage
  universeSize: number;
  addedThisWeek: number;
  scoredFresh: number; // tickers with a score timestamped within the window
  coveragePct: number; // scoredFresh / universeSize
  // Signal highlights
  topMovers: ScoreMover[];
  newAlignedStrength: NewLabelEntry[];
  newNarrativeBreakdown: NewLabelEntry[];
  // Engine quality
  sweepCount: number;
  decisionsGraded: number;
  hitRatePct: number | null; // null when not enough graded decisions
}

export async function computeWeeklyMetrics(): Promise<WeeklyMetrics> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - WEEK_MS);
  // postgres.js (via drizzle's sql template) rejects raw Date objects in
  // parameter binding — pass an ISO string and cast in SQL.
  const windowStartIso = windowStart.toISOString();

  // ── Coverage ───────────────────────────────────────────────────────────
  const [univ] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.platformCompanies)
    .where(sql`${schema.platformCompanies.marketType} = 'public'`);

  const [added] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.platformCompanies)
    .where(
      sql`${schema.platformCompanies.marketType} = 'public' AND ${schema.platformCompanies.createdAt} >= ${windowStartIso}::timestamptz`,
    );

  // Distinct tickers with a public_score row inside the window.
  const [fresh] = await db
    .select({ n: sql<number>`count(distinct ${schema.publicScores.ticker})::int` })
    .from(schema.publicScores)
    .where(sql`${schema.publicScores.asOf} >= ${windowStartIso}::timestamptz`);

  const universeSize = univ?.n ?? 0;
  const scoredFresh = fresh?.n ?? 0;
  const addedThisWeek = added?.n ?? 0;
  const coveragePct = universeSize > 0 ? (scoredFresh / universeSize) * 100 : 0;

  // ── Signal highlights ──────────────────────────────────────────────────
  // For each ticker: latest score inside the window AND most-recent prior
  // score from before the window. SQL window functions keep this to one
  // round trip even with thousands of rows.
  const moversRaw = await db.execute<{
    ticker: string;
    current: number;
    previous: number;
    label: string;
  }>(sql`
    WITH ranked AS (
      SELECT
        ticker,
        score,
        label,
        as_of,
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS rn,
        (as_of >= ${windowStartIso}::timestamptz) AS in_window
      FROM public_scores
    ),
    latest_in AS (
      SELECT ticker, score AS current, label
      FROM ranked
      WHERE in_window = true AND rn = 1
    ),
    latest_before AS (
      SELECT ticker, score AS previous
      FROM (
        SELECT ticker, score, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS pr
        FROM public_scores
        WHERE as_of < ${windowStartIso}::timestamptz
      ) prev
      WHERE pr = 1
    )
    SELECT li.ticker, li.current, lb.previous, li.label
    FROM latest_in li
    JOIN latest_before lb ON lb.ticker = li.ticker
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
    .slice(0, 10);

  // New entries into specific labels this week — i.e. a score with the
  // label landed in-window AND the most-recent prior label was different.
  const newLabel = async (label: string): Promise<NewLabelEntry[]> => {
    const rows = await db.execute<{ ticker: string; score: number }>(sql`
      WITH ranked AS (
        SELECT
          ticker,
          score,
          label,
          as_of,
          ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY as_of DESC) AS rn
        FROM public_scores
      ),
      latest_in AS (
        SELECT ticker, score, label FROM ranked
        WHERE rn = 1 AND label = ${label}
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
    return rows.map((r) => ({ ticker: r.ticker, score: Number(r.score) }));
  };

  const newAlignedStrength = await newLabel('aligned_strength');
  const newNarrativeBreakdown = await newLabel('narrative_breakdown');

  // ── Engine quality ─────────────────────────────────────────────────────
  // Sweep count = distinct days inside the window that produced at least
  // one score. With the daily cron in place this should reliably be 7.
  const [sweep] = await db
    .select({ n: sql<number>`count(distinct date_trunc('day', ${schema.publicScores.asOf}))::int` })
    .from(schema.publicScores)
    .where(sql`${schema.publicScores.asOf} >= ${windowStartIso}::timestamptz`);

  // Meta-learning: count graded classification decisions in-window and the
  // hit rate. `outcome_payload->>'hit' = 'true'` is the convention from
  // outcomeCapture (defensive: also accept the boolean literal).
  const [graded] = await db
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
          AND ${schema.platformDecisions.outcomeAt} >= ${windowStartIso}::timestamptz`,
    );

  const decisionsGraded = graded?.total ?? 0;
  const hits = graded?.hits ?? 0;
  const hitRatePct = decisionsGraded > 0 ? (hits / decisionsGraded) * 100 : null;

  return {
    windowStart,
    windowEnd,
    universeSize,
    addedThisWeek,
    scoredFresh,
    coveragePct,
    topMovers,
    newAlignedStrength,
    newNarrativeBreakdown,
    sweepCount: sweep?.n ?? 0,
    decisionsGraded,
    hitRatePct,
  };
}

// ─── Email rendering ──────────────────────────────────────────────────────

const fmtPct = (n: number, digits = 0): string => `${n.toFixed(digits)}%`;
const fmtSignedScore = (n: number): string =>
  `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

function row(label: string, value: string): string {
  return `<tr>
    <td class="v-metric-label" style="padding:8px 16px 8px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#888;white-space:nowrap;">${label}</td>
    <td class="v-metric-value" style="padding:8px 0;font-family:'IBM Plex Mono',monospace;color:#111;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${value}</td>
  </tr>`;
}

function tickerListBlock(title: string, items: { ticker: string; right: string }[]): string {
  if (items.length === 0) {
    return `<p style="margin:0 0 12px 0;color:#666;font-style:italic;font-size:14px;">${title}: none this week.</p>`;
  }
  const rows = items
    .map(
      (it) => `<li style="margin:0 0 4px 0;font-size:14px;">
        <a href="${UI_BASE}/public/${encodeURIComponent(it.ticker)}" style="color:#a01818;text-decoration:none;font-family:'IBM Plex Mono',monospace;">${it.ticker}</a>
        <span style="color:#666;">— ${it.right}</span>
      </li>`,
    )
    .join('');
  return `<p class="v-eyebrow" style="margin:0 0 8px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#111;">${title}</p>
    <ul style="margin:0 0 20px 0;padding:0;list-style:none;">${rows}</ul>`;
}

const MOBILE_STYLES = `
  @media only screen and (max-width: 600px) {
    .v-outer { padding: 24px 0 !important; }
    .v-card { width: 100% !important; max-width: 100% !important; padding: 28px 20px !important; }
    .v-h1 { font-size: 26px !important; line-height: 1.15 !important; }
    .v-h2 { font-size: 16px !important; }
    .v-eyebrow { font-size: 10px !important; letter-spacing: 0.06em !important; }
    .v-period { font-size: 10px !important; }
    .v-metric-label { font-size: 10px !important; letter-spacing: 0.06em !important; padding-right: 8px !important; }
    .v-metric-value { font-size: 12px !important; }
    .v-section { margin-bottom: 24px !important; }
  }
`;

export function renderProgressEmailHtml(m: WeeklyMetrics): string {
  const period = `${m.windowStart.toISOString().slice(0, 10)} → ${m.windowEnd.toISOString().slice(0, 10)}`;

  const movers = m.topMovers.map((mv) => ({
    ticker: mv.ticker,
    right: `${fmtSignedScore(mv.delta)} (now ${mv.current.toFixed(0)})`,
  }));
  const asEntries = m.newAlignedStrength.map((e) => ({
    ticker: e.ticker,
    right: `score ${e.score.toFixed(0)}`,
  }));
  const nbEntries = m.newNarrativeBreakdown.map((e) => ({
    ticker: e.ticker,
    right: `score ${e.score.toFixed(0)}`,
  }));

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${MOBILE_STYLES}</style></head>
<body style="margin:0;background:#f4f1ea;font-family:'Source Serif 4',Georgia,serif;color:#111;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="v-outer" style="background:#f4f1ea;padding:40px 0;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" class="v-card" style="background:#fbf9f4;padding:48px 56px;max-width:640px;width:100%;">
      <tr><td>
        <p class="v-eyebrow" style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:#111;">Vantage · Weekly Progress</p>
        <h1 class="v-h1" style="margin:6px 0 4px 0;font-family:'Playfair Display',Georgia,serif;font-size:32px;line-height:1.1;color:#111;white-space:nowrap;">Weekly Progress</h1>
        <p class="v-period" style="margin:0 0 32px 0;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#888;">${period}</p>

        <h2 class="v-h2" style="margin:0 0 8px 0;font-family:'Playfair Display',Georgia,serif;font-size:18px;color:#111;">Coverage</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="v-section" style="border-top:1px solid #ddd;border-bottom:1px solid #ddd;margin-bottom:28px;">
          ${row('Universe', `${m.universeSize.toLocaleString()} tickers`)}
          ${
            // A week that adds >half the universe is the initial bootstrap, not
            // organic weekly growth — label it so the number isn't misleading.
            m.addedThisWeek > m.universeSize * 0.5
              ? row('Universe loaded', `${m.addedThisWeek.toLocaleString()} (initial load)`)
              : row('Added this week', m.addedThisWeek.toLocaleString())
          }
          ${row('Scored fresh', `${m.scoredFresh.toLocaleString()} (${fmtPct(m.coveragePct)})`)}
        </table>

        <h2 class="v-h2" style="margin:0 0 8px 0;font-family:'Playfair Display',Georgia,serif;font-size:18px;color:#111;">Signal Highlights</h2>
        ${tickerListBlock('Top score moves', movers)}
        ${tickerListBlock('New Aligned Strength', asEntries)}
        ${tickerListBlock('New Narrative Breakdown', nbEntries)}

        <h2 class="v-h2" style="margin:0 0 8px 0;font-family:'Playfair Display',Georgia,serif;font-size:18px;color:#111;">Engine Quality</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="v-section" style="border-top:1px solid #ddd;border-bottom:1px solid #ddd;margin-bottom:28px;">
          ${row('Sweep days', `${m.sweepCount} / 7`)}
          ${row('Decisions graded', m.decisionsGraded.toLocaleString())}
          ${row('Hit rate', m.hitRatePct === null ? 'n/a (not enough graded)' : fmtPct(m.hitRatePct, 1))}
        </table>

        <p style="margin:32px 0 0 0;font-family:'Source Serif 4',Georgia,serif;font-style:italic;font-size:13px;color:#888;">
          Sent from Vantage. Reply to this email if anything looks off.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export interface SendWeeklyProgressReportResult {
  to: string;
  dispatched: 'sent' | 'failed' | 'skipped';
  metrics: WeeklyMetrics;
}

export async function sendWeeklyProgressReport(opts: { to?: string } = {}): Promise<SendWeeklyProgressReportResult> {
  const to = opts.to ?? DEFAULT_TO;
  log.info({ to }, 'progress report: start');
  const metrics = await computeWeeklyMetrics();
  const html = renderProgressEmailHtml(metrics);
  const subject = `Vantage weekly: ${metrics.scoredFresh.toLocaleString()} fresh scores, ${metrics.universeSize.toLocaleString()}-ticker universe`;
  const dispatched = await dispatchEmail(to, subject, html);
  log.info({ to, dispatched, ...metrics }, 'progress report: done');
  return { to, dispatched, metrics };
}
