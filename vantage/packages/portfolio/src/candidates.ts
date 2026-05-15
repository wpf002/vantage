import { sql, type SQLWrapper } from 'drizzle-orm';
import type { Sector } from '@vantage/shared';
import type { Candidate } from './index.js';

/**
 * Build the candidate list for portfolio construction from live data.
 *
 * The function is intentionally db-driven and decoupled from the api package:
 * it accepts any Drizzle client and queries the platform_classifications and
 * platform_companies tables via raw SQL, so this package does not need to
 * import @vantage/api's schema (which would create a workspace cycle).
 *
 * Joins the most-recent classification per entity against company chrome.
 * AVOID rows are excluded by default — they belong in no sleeve. Stale
 * classifications older than `maxAgeDays` are filtered out so the universe
 * always reflects what the platform currently believes.
 */

export interface BuildCandidatesOptions {
  /** Maximum age of a classification, in days. Older rows are skipped. */
  maxAgeDays?: number;
  /** Include AVOID-classified entities. Default false. */
  includeAvoid?: boolean;
  /** Restrict to the given sectors. Empty / undefined means all. */
  sectorFilter?: Sector[];
}

interface CandidateRow {
  entity: string;
  asset_class: 'CORE' | 'HIGH_ASYMMETRY' | 'TACTICAL' | 'AVOID';
  confidence: number;
  // From the companies join (nullable when entity is a uuid that no longer
  // resolves, or a ticker that hasn't been seeded yet).
  name: string | null;
  sector: string | null;
  ticker: string | null;
}

const SECTORS: readonly Sector[] = [
  'technology',
  'healthcare',
  'financials',
  'consumer_discretionary',
  'consumer_staples',
  'industrials',
  'energy',
  'materials',
  'utilities',
  'real_estate',
  'communication_services',
  'other',
];

function mapSector(raw: string | null): Sector {
  if (!raw) return 'other';
  const lower = raw.toLowerCase();
  return (SECTORS.find((s) => s === lower) ?? 'other') as Sector;
}

/**
 * Drizzle's "any database" type is famously gnarly across dialects. We narrow
 * to the one method we actually use — `execute` against a `sql\`...\`` template
 * — which matches both `PostgresJsDatabase` and `NodePgDatabase` from
 * drizzle-orm. The result is typed as `unknown[]` and cast at the call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDrizzle = { execute: (query: string | SQLWrapper) => Promise<any> };

export async function buildCandidatesFromClassifications(
  db: AnyDrizzle,
  options: BuildCandidatesOptions = {},
): Promise<Candidate[]> {
  const maxAgeDays = options.maxAgeDays ?? 30;
  const includeAvoid = options.includeAvoid ?? false;
  const sectorFilter = options.sectorFilter && options.sectorFilter.length > 0
    ? new Set<string>(options.sectorFilter)
    : null;

  // DISTINCT ON (entity) gives the most recent classification per entity.
  // The join against platform_companies is best-effort: entities may be
  // either company UUIDs (private) or tickers (public), and we look up both
  // shapes. The CASE clause picks whichever match resolves.
  const rows = (await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (entity)
        entity,
        asset_class,
        confidence,
        as_of
      FROM platform_classifications
      WHERE as_of >= NOW() - (${maxAgeDays} * INTERVAL '1 day')
      ORDER BY entity, as_of DESC
    )
    SELECT
      l.entity                       AS entity,
      l.asset_class                  AS asset_class,
      l.confidence                   AS confidence,
      COALESCE(c_id.name, c_tk.name) AS name,
      COALESCE(c_id.sector, c_tk.sector) AS sector,
      COALESCE(c_id.ticker, c_tk.ticker) AS ticker
    FROM latest l
    LEFT JOIN platform_companies c_id
      ON l.entity ~ '^[0-9a-f-]{36}$' AND c_id.id::text = l.entity
    LEFT JOIN platform_companies c_tk
      ON c_tk.ticker IS NOT NULL AND c_tk.ticker = l.entity
  `)) as unknown as CandidateRow[];

  const candidates: Candidate[] = [];
  for (const r of rows) {
    if (!includeAvoid && r.asset_class === 'AVOID') continue;

    const sector = mapSector(r.sector);
    if (sectorFilter && !sectorFilter.has(sector)) continue;

    // Skip rows we can't render — without a name they're not displayable
    // and shouldn't sit in a portfolio table.
    if (!r.name) continue;

    candidates.push({
      entity: r.ticker ?? r.entity,
      name: r.name,
      sector,
      assetClass: r.asset_class,
      conviction: r.confidence,
    });
  }

  candidates.sort((a, b) => b.conviction - a.conviction);
  return candidates;
}
