import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, ilike } from 'drizzle-orm';
import { FmpClient } from '@vantage/data-ingest/public';
import type { FmpSearchHit } from '@vantage/data-ingest/public';
import { db, schema } from '../db/client.js';

/**
 * Universal company search — spans seeded companies and live FMP lookups.
 * Resolution order:
 *   1. exact ticker hit in platform_companies
 *   2. fuzzy name match in platform_companies
 *   3. an unknown-but-real ticker symbol, confirmed via an FMP profile probe
 *   4. an unknown company name, resolved to a US ticker via FMP name search
 *   5. nothing
 *
 * The UI uses 'public_unknown' to offer "Score this ticker now", which then
 * triggers POST /v1/public/score-live.
 */

const SearchQuery = z.object({ q: z.string().optional() });

/** A query that could plausibly be a US ticker: 1-5 letters, no spaces. */
const TICKER_RE = /^[A-Za-z]{1,5}$/;

const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX']);

/** First name-search hit that looks like a primary US listing. */
function pickUsListing(hits: FmpSearchHit[]): FmpSearchHit | null {
  // A plain symbol (no dot suffix like ".DE") on a US exchange is the primary.
  const us = hits.find(
    (h) => !h.symbol.includes('.') && (!h.exchange || US_EXCHANGES.has(h.exchange)),
  );
  if (us) return us;
  return hits.find((h) => !h.symbol.includes('.')) ?? null;
}

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search',
    { schema: { querystring: SearchQuery } },
    async (req) => {
      const query = (req.query.q ?? '').trim();
      if (!query) return { kind: 'no_match' as const };

      const upper = query.toUpperCase();

      // 1. exact ticker
      const exact = await db
        .select()
        .from(schema.platformCompanies)
        .where(eq(schema.platformCompanies.ticker, upper))
        .limit(1);
      if (exact.length > 0) {
        const c = exact[0]!;
        return {
          kind: 'exact' as const,
          match: { type: c.marketType, id: c.ticker ?? c.id, ticker: c.ticker, name: c.name },
        };
      }

      // 2. fuzzy name match against seeded companies
      const byName = await db
        .select()
        .from(schema.platformCompanies)
        .where(ilike(schema.platformCompanies.name, `%${query}%`))
        .limit(8);
      if (byName.length > 0) {
        return {
          kind: 'name_matches' as const,
          matches: byName.map((c) => ({
            type: c.marketType,
            id: c.ticker ?? c.id,
            ticker: c.ticker,
            name: c.name,
          })),
        };
      }

      // 3 & 4. not seeded — fall through to FMP.
      if (process.env.FMP_API_KEY) {
        const fmp = new FmpClient({ apiKey: process.env.FMP_API_KEY });

        // 3. query looks like a ticker — probe for a real profile
        if (TICKER_RE.test(query)) {
          try {
            const profile = await fmp.profile(upper);
            if (profile && profile.companyName) {
              return {
                kind: 'public_unknown' as const,
                suggestion: {
                  ticker: profile.symbol,
                  name: profile.companyName,
                  exchange: profile.exchangeShortName ?? profile.exchange ?? null,
                },
              };
            }
          } catch {
            // FMP unreachable — fall through.
          }
        }

        // 4. query is a company name — resolve it to a US ticker
        try {
          const hits = await fmp.searchByName(query, 10);
          const listing = pickUsListing(hits);
          if (listing) {
            return {
              kind: 'public_unknown' as const,
              suggestion: {
                ticker: listing.symbol,
                name: listing.name,
                exchange: listing.exchange ?? null,
              },
            };
          }
        } catch {
          // FMP unreachable — fall through.
        }
      }

      // 5. nothing
      return { kind: 'no_match' as const };
    },
  );
};
