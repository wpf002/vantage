import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { NotFoundError } from '@vantage/shared';
import { db } from '../db/client.js';

/**
 * Phase 9 — the Daily Board. The page you open in the morning: yesterday's
 * biggest score moves, fresh label changes, and classification transitions.
 *
 * Pure reads. Five sections resolved inside one repeatable-read transaction so
 * they share a consistent snapshot. "Today" is the resolved board date; the
 * comparison baseline ("yesterday") is each ticker's most recent score *before*
 * that day — robust to the sparse, earnings-driven cadence of public scores.
 */

const BoardQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const SECTION_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

interface MoverRow {
  ticker: string;
  name: string | null;
  sector: string | null;
  score_delta: number;
  current_score: number;
  current_label: string;
  prior_label: string;
}
interface LabelRow {
  ticker: string;
  name: string | null;
  sector: string | null;
  score: number;
  transitioned_from_label: string;
}
interface ClassRow {
  entity: string;
  name: string | null;
  ticker: string | null;
  sector: string | null;
  from_class: string;
  to_class: string;
  confidence: number;
}
interface DateRow {
  d: string;
}

export const boardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { querystring: BoardQuery } }, async (req) => {
    const today = req.query.date ?? new Date().toISOString().slice(0, 10);

    return db.transaction(
      async (tx) => {
        // ── Resolve the board date ─────────────────────────────────────────
        // Use `today` if it already has at least 5 scores; otherwise fall back
        // to the most recent prior day with at least 5 scores.
        const resolved = (await tx.execute(sql`
          SELECT to_char(as_of::date, 'YYYY-MM-DD') AS d
          FROM public_scores
          WHERE as_of::date <= ${today}::date
          GROUP BY as_of::date
          HAVING count(*) >= 5
          ORDER BY as_of::date DESC
          LIMIT 1
        `)) as unknown as DateRow[];

        const asOf = resolved[0]?.d ?? null;
        if (!asOf) {
          // No qualifying activity at or before the requested date.
          throw new NotFoundError('daily board', today);
        }
        // Historical boards (>7 days old) aren't supported yet.
        const ageDays = Math.floor((Date.parse(today) - Date.parse(asOf)) / DAY_MS);
        if (ageDays > 7) throw new NotFoundError('daily board', today);

        const dayStart = sql`${asOf}::date`;
        const nextDay = sql`(${asOf}::date + interval '1 day')`;

        // Latest score on the board day, per ticker, with company chrome.
        const todayScores = sql`
          SELECT DISTINCT ON (ps.ticker)
            ps.ticker, ps.score, ps.label, ps.as_of, c.name, c.sector
          FROM public_scores ps
          LEFT JOIN platform_companies c ON c.ticker = ps.ticker
          WHERE ps.as_of >= ${dayStart} AND ps.as_of < ${nextDay}
          ORDER BY ps.ticker, ps.as_of DESC
        `;
        // Each ticker's most recent score strictly before the board day.
        const priorScores = sql`
          SELECT DISTINCT ON (ticker) ticker, score, label, as_of
          FROM public_scores
          WHERE as_of < ${dayStart}
          ORDER BY ticker, as_of DESC
        `;

        const moversBase = sql`
          WITH t AS (${todayScores}), p AS (${priorScores})
          SELECT t.ticker, t.name, t.sector,
                 (t.score - p.score) AS score_delta,
                 t.score AS current_score, t.label AS current_label,
                 p.label AS prior_label
          FROM t JOIN p ON p.ticker = t.ticker
          WHERE p.score IS NOT NULL
        `;

        const biggestMoversUp = (await tx.execute(sql`
          ${moversBase} AND (t.score - p.score) > 0
          ORDER BY score_delta DESC LIMIT ${SECTION_LIMIT}
        `)) as unknown as MoverRow[];

        const biggestMoversDown = (await tx.execute(sql`
          ${moversBase} AND (t.score - p.score) < 0
          ORDER BY score_delta ASC LIMIT ${SECTION_LIMIT}
        `)) as unknown as MoverRow[];

        const labelTransition = (label: string) => sql`
          WITH t AS (${todayScores}), p AS (${priorScores})
          SELECT t.ticker, t.name, t.sector, t.score, p.label AS transitioned_from_label
          FROM t JOIN p ON p.ticker = t.ticker
          WHERE t.label = ${label} AND p.label IS NOT NULL AND p.label <> ${label}
          ORDER BY t.score DESC LIMIT ${SECTION_LIMIT}
        `;

        const newNarrativeBreakdowns = (await tx.execute(
          labelTransition('narrative_breakdown'),
        )) as unknown as LabelRow[];
        const freshMarketUnderreactions = (await tx.execute(
          labelTransition('market_underreaction'),
        )) as unknown as LabelRow[];

        // Classification transitions — entity's class on the board day differs
        // from its most recent prior class. Entities are tickers or UUIDs;
        // join companies on either to recover chrome.
        const classRows = (await tx.execute(sql`
          WITH t AS (
            SELECT DISTINCT ON (entity) entity, asset_class, confidence, as_of
            FROM platform_classifications
            WHERE as_of >= ${dayStart} AND as_of < ${nextDay}
            ORDER BY entity, as_of DESC
          ), p AS (
            SELECT DISTINCT ON (entity) entity, asset_class
            FROM platform_classifications
            WHERE as_of < ${dayStart}
            ORDER BY entity, as_of DESC
          )
          SELECT t.entity, c.name, c.ticker, c.sector,
                 p.asset_class AS from_class, t.asset_class AS to_class, t.confidence
          FROM t JOIN p ON p.entity = t.entity
          LEFT JOIN platform_companies c
            ON c.ticker = t.entity OR c.id::text = t.entity
          WHERE t.asset_class <> p.asset_class
          ORDER BY t.confidence DESC LIMIT ${SECTION_LIMIT}
        `)) as unknown as ClassRow[];

        const mover = (r: MoverRow) => ({
          ticker: r.ticker,
          name: r.name ?? r.ticker,
          sector: r.sector,
          scoreDelta: r.score_delta,
          currentScore: r.current_score,
          currentLabel: r.current_label,
          priorLabel: r.prior_label,
        });
        const labeled = (r: LabelRow) => ({
          ticker: r.ticker,
          name: r.name ?? r.ticker,
          sector: r.sector,
          score: r.score,
          transitionedFromLabel: r.transitioned_from_label,
        });

        return {
          asOf,
          sections: {
            biggestMoversUp: biggestMoversUp.map(mover),
            biggestMoversDown: biggestMoversDown.map(mover),
            newNarrativeBreakdowns: newNarrativeBreakdowns.map(labeled),
            freshMarketUnderreactions: freshMarketUnderreactions.map(labeled),
            classificationTransitions: classRows.map((r) => ({
              ticker: r.ticker ?? r.entity,
              name: r.name ?? r.ticker ?? r.entity,
              sector: r.sector,
              fromClass: r.from_class,
              toClass: r.to_class,
              confidence: r.confidence,
            })),
          },
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  });
};
