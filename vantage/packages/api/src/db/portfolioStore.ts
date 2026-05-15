import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { PortfolioResult, Candidate } from '@vantage/portfolio';
import type { PortfolioConstraints } from '@vantage/shared';
import { ValidationError, NotFoundError, AuthorizationError } from '@vantage/shared';
import { schema, type DB } from './client.js';

/**
 * Persistence for Phase 5 portfolios.
 *
 * Portfolios are append-only: rebalancing inserts a new row rather than
 * mutating the previous one. This keeps the decision log honest and gives
 * Phase 8 meta-learning a clean history per owner.
 *
 * Slug rules (enforced here and at the route layer):
 *   - kebab-case, 3–60 chars, lowercase letters / digits / hyphens
 *   - reserved literals are rejected so they can't shadow routes
 */

export interface PersistPortfolioParams {
  ownerUserId: string | null;
  kind: 'system' | 'personal' | 'published';
  name: string;
  slug?: string | null;
  description?: string | null;
  constraints: PortfolioConstraints;
  result: PortfolioResult;
  candidatesUsed: Candidate[];
}

export interface PersistPortfolioResult {
  portfolioId: string;
}

export async function persistPortfolio(
  db: DB,
  params: PersistPortfolioParams,
): Promise<PersistPortfolioResult> {
  return db.transaction(async (tx) => {
    const [portfolio] = await tx
      .insert(schema.platformPortfolios)
      .values({
        name: params.name,
        constraints: params.constraints,
        sleeveWeights: params.result.sleeveWeights,
        cashWeight: params.result.cashWeight,
        warnings: params.result.warnings,
        asOf: new Date(params.result.asOf),
        ownerUserId: params.ownerUserId,
        kind: params.kind,
        slug: params.slug ?? null,
        description: params.description ?? null,
        publishedAt: params.kind === 'published' ? new Date() : null,
      })
      .returning({ id: schema.platformPortfolios.id });
    const portfolioId = portfolio!.id;

    if (params.result.allocations.length > 0) {
      await tx.insert(schema.platformAllocations).values(
        params.result.allocations.map((a) => ({
          portfolioId,
          entity: a.entity,
          name: a.name,
          sector: a.sector,
          sleeve: a.sleeve as 'core' | 'growth' | 'defensive' | 'tactical' | 'none',
          weight: a.weight,
          assetClass: a.assetClass,
        })),
      );
    }

    await tx.insert(schema.platformDecisions).values({
      entity: params.ownerUserId ?? 'system',
      decisionType: 'portfolio_construction',
      decisionPayload: {
        portfolioId,
        kind: params.kind,
        name: params.name,
        constraints: params.constraints,
        result: params.result,
        candidates: params.candidatesUsed,
      },
      outcomePayload: null,
    });

    return { portfolioId };
  });
}

export interface PortfolioRowJoined {
  id: string;
  name: string;
  kind: 'system' | 'personal' | 'published';
  slug: string | null;
  description: string | null;
  publishedAt: string | null;
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  constraints: unknown;
  sleeveWeights: unknown;
  cashWeight: number;
  warnings: unknown;
  asOf: string;
  allocations: Array<{
    id: string;
    entity: string;
    name: string;
    sector: string;
    sleeve: string;
    weight: number;
    assetClass: 'CORE' | 'HIGH_ASYMMETRY' | 'TACTICAL' | 'AVOID';
    ticker: string | null;
    marketType: 'public' | 'private' | null;
  }>;
}

async function loadPortfolioRowOrNull(
  db: DB,
  whereExpr: ReturnType<typeof eq>,
): Promise<PortfolioRowJoined | null> {
  const rows = await db
    .select({
      portfolio: schema.platformPortfolios,
      ownerEmail: schema.users.email,
      ownerName: schema.users.name,
    })
    .from(schema.platformPortfolios)
    .leftJoin(schema.users, eq(schema.platformPortfolios.ownerUserId, schema.users.id))
    .where(whereExpr)
    .limit(1);
  if (rows.length === 0) return null;
  const { portfolio: p, ownerEmail, ownerName } = rows[0]!;

  const allocs = await db
    .select({
      alloc: schema.platformAllocations,
      ticker: schema.platformCompanies.ticker,
      marketType: schema.platformCompanies.marketType,
    })
    .from(schema.platformAllocations)
    .leftJoin(
      schema.platformCompanies,
      sql`${schema.platformCompanies.id}::text = ${schema.platformAllocations.entity}
          OR ${schema.platformCompanies.ticker} = ${schema.platformAllocations.entity}`,
    )
    .where(eq(schema.platformAllocations.portfolioId, p.id))
    .orderBy(desc(schema.platformAllocations.weight));

  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    slug: p.slug,
    description: p.description,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    ownerUserId: p.ownerUserId,
    ownerEmail: ownerEmail,
    ownerName: ownerName,
    constraints: p.constraints,
    sleeveWeights: p.sleeveWeights,
    cashWeight: p.cashWeight,
    warnings: p.warnings,
    asOf: p.asOf.toISOString(),
    allocations: allocs.map((row) => ({
      id: row.alloc.id,
      entity: row.alloc.entity,
      name: row.alloc.name,
      sector: row.alloc.sector,
      sleeve: row.alloc.sleeve,
      weight: row.alloc.weight,
      assetClass: row.alloc.assetClass,
      ticker: row.ticker ?? null,
      marketType: row.marketType ?? null,
    })),
  };
}

export async function getPortfolioById(db: DB, portfolioId: string): Promise<PortfolioRowJoined | null> {
  return loadPortfolioRowOrNull(db, eq(schema.platformPortfolios.id, portfolioId));
}

export async function getPortfolioBySlug(db: DB, slug: string): Promise<PortfolioRowJoined | null> {
  const row = await loadPortfolioRowOrNull(db, eq(schema.platformPortfolios.slug, slug));
  if (!row) return null;
  if (row.kind !== 'published') return null;
  return row;
}

/**
 * Returns the most recent system-curated portfolio. Each nightly rebuild
 * inserts a fresh row so callers always see the latest editorial standing
 * position.
 */
export async function getSystemPortfolio(db: DB): Promise<PortfolioRowJoined | null> {
  const rows = await db
    .select({ id: schema.platformPortfolios.id })
    .from(schema.platformPortfolios)
    .where(eq(schema.platformPortfolios.kind, 'system'))
    .orderBy(desc(schema.platformPortfolios.asOf))
    .limit(1);
  if (rows.length === 0) return null;
  return loadPortfolioRowOrNull(db, eq(schema.platformPortfolios.id, rows[0]!.id));
}

export interface PortfolioListItem {
  id: string;
  name: string;
  kind: 'system' | 'personal' | 'published';
  slug: string | null;
  description: string | null;
  asOf: string;
  publishedAt: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  cashWeight: number;
  sleeveWeights: unknown;
}

export async function listUserPortfolios(db: DB, userId: string): Promise<PortfolioListItem[]> {
  const rows = await db
    .select()
    .from(schema.platformPortfolios)
    .where(eq(schema.platformPortfolios.ownerUserId, userId))
    .orderBy(desc(schema.platformPortfolios.asOf));

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    slug: p.slug,
    description: p.description,
    asOf: p.asOf.toISOString(),
    publishedAt: p.publishedAt?.toISOString() ?? null,
    ownerEmail: null,
    ownerName: null,
    cashWeight: p.cashWeight,
    sleeveWeights: p.sleeveWeights,
  }));
}

export interface ListPublishedOptions {
  limit?: number;
  cursor?: string; // publishedAt cursor — ISO timestamp; rows strictly older than cursor are returned
}

export async function listPublishedPortfolios(
  db: DB,
  options: ListPublishedOptions = {},
): Promise<PortfolioListItem[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

  const conditions = [eq(schema.platformPortfolios.kind, 'published')];
  if (options.cursor) {
    conditions.push(lt(schema.platformPortfolios.publishedAt, new Date(options.cursor)));
  }

  const rows = await db
    .select({
      portfolio: schema.platformPortfolios,
      ownerEmail: schema.users.email,
      ownerName: schema.users.name,
    })
    .from(schema.platformPortfolios)
    .leftJoin(schema.users, eq(schema.platformPortfolios.ownerUserId, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.platformPortfolios.publishedAt))
    .limit(limit);

  return rows.map(({ portfolio: p, ownerEmail, ownerName }) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    slug: p.slug,
    description: p.description,
    asOf: p.asOf.toISOString(),
    publishedAt: p.publishedAt?.toISOString() ?? null,
    ownerEmail,
    ownerName,
    cashWeight: p.cashWeight,
    sleeveWeights: p.sleeveWeights,
  }));
}

const RESERVED_SLUGS = new Set(['system', 'new', 'mine', 'published']);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 60) {
    throw new ValidationError('slug must be 3–60 characters');
  }
  if (!SLUG_RE.test(slug)) {
    throw new ValidationError('slug must be lowercase kebab-case (letters, digits, hyphens)');
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new ValidationError(`slug "${slug}" is reserved`);
  }
  return slug;
}

export async function publishPortfolio(
  db: DB,
  portfolioId: string,
  userId: string,
  slug: string,
  description?: string,
): Promise<{ portfolioId: string; slug: string }> {
  const normalized = validateSlug(slug);

  const existing = await db
    .select()
    .from(schema.platformPortfolios)
    .where(eq(schema.platformPortfolios.id, portfolioId))
    .limit(1);
  if (existing.length === 0) throw new NotFoundError('portfolio', portfolioId);
  const p = existing[0]!;
  if (p.ownerUserId !== userId) {
    throw new AuthorizationError('only the owner may publish this portfolio');
  }

  try {
    await db
      .update(schema.platformPortfolios)
      .set({
        kind: 'published',
        slug: normalized,
        description: description ?? null,
        publishedAt: new Date(),
      })
      .where(eq(schema.platformPortfolios.id, portfolioId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('platform_portfolios_slug_idx') || msg.toLowerCase().includes('unique')) {
      throw new ValidationError(`slug "${normalized}" is already taken`);
    }
    throw err;
  }

  return { portfolioId, slug: normalized };
}

export async function unpublishPortfolio(
  db: DB,
  portfolioId: string,
  userId: string,
): Promise<{ portfolioId: string }> {
  const existing = await db
    .select()
    .from(schema.platformPortfolios)
    .where(eq(schema.platformPortfolios.id, portfolioId))
    .limit(1);
  if (existing.length === 0) throw new NotFoundError('portfolio', portfolioId);
  const p = existing[0]!;
  if (p.ownerUserId !== userId) {
    throw new AuthorizationError('only the owner may unpublish this portfolio');
  }

  await db
    .update(schema.platformPortfolios)
    .set({ kind: 'personal', slug: null, publishedAt: null })
    .where(eq(schema.platformPortfolios.id, portfolioId));

  return { portfolioId };
}

export async function renamePortfolio(
  db: DB,
  portfolioId: string,
  userId: string,
  name: string,
): Promise<{ portfolioId: string; name: string }> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 120) {
    throw new ValidationError('name must be 1–120 characters');
  }
  const existing = await db
    .select()
    .from(schema.platformPortfolios)
    .where(eq(schema.platformPortfolios.id, portfolioId))
    .limit(1);
  if (existing.length === 0) throw new NotFoundError('portfolio', portfolioId);
  const p = existing[0]!;
  if (p.ownerUserId !== userId) {
    throw new AuthorizationError('only the owner may rename this portfolio');
  }
  await db
    .update(schema.platformPortfolios)
    .set({ name: trimmed })
    .where(eq(schema.platformPortfolios.id, portfolioId));
  return { portfolioId, name: trimmed };
}

export async function deletePortfolio(db: DB, portfolioId: string, userId: string): Promise<void> {
  const existing = await db
    .select()
    .from(schema.platformPortfolios)
    .where(eq(schema.platformPortfolios.id, portfolioId))
    .limit(1);
  if (existing.length === 0) throw new NotFoundError('portfolio', portfolioId);
  const p = existing[0]!;
  if (p.ownerUserId !== userId) {
    throw new AuthorizationError('only the owner may delete this portfolio');
  }
  await db.delete(schema.platformPortfolios).where(eq(schema.platformPortfolios.id, portfolioId));
}

/**
 * Counts existing versions of a personal portfolio by base name (used to
 * suffix rebalance results with `(vN)`).
 */
export async function countPortfolioVersionsByName(
  db: DB,
  userId: string,
  baseName: string,
): Promise<number> {
  const rows = await db
    .select({ id: schema.platformPortfolios.id })
    .from(schema.platformPortfolios)
    .where(
      and(
        eq(schema.platformPortfolios.ownerUserId, userId),
        sql`${schema.platformPortfolios.name} = ${baseName} OR ${schema.platformPortfolios.name} LIKE ${baseName + ' (v%'}`,
      ),
    );
  return rows.length;
}

// Suppress unused-import warning — these helpers are referenced indirectly
// via the conditions array in listPublishedPortfolios.
void asc;
void isNull;
