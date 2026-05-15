import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  numeric,
  integer,
  real,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Vantage database schema.
 *
 * Three logical modules, segregated by table prefix:
 *   - platform_*  : harmonized signals, classifications, portfolios, audit
 *   - private_*   : DCF / Comps / LBO inputs, alt-data observations
 *   - public_*    : EGS / NIS / NHS components and assembled scores
 */

// ── Enums ─────────────────────────────────────────────────────────────────
export const marketTypeEnum = pgEnum('market_type', ['private', 'public']);
export const lifeStageEnum = pgEnum('life_stage', [
  'seed',
  'series_a',
  'series_b',
  'series_c_plus',
  'pre_ipo',
  'public_early',
  'public_mature',
]);
export const assetClassEnum = pgEnum('asset_class', [
  'CORE',
  'HIGH_ASYMMETRY',
  'TACTICAL',
  'AVOID',
]);
export const sleeveEnum = pgEnum('sleeve', ['core', 'growth', 'defensive', 'tactical', 'none']);
export const signalDirectionEnum = pgEnum('signal_direction', ['bullish', 'neutral', 'bearish']);

// ── Platform tables ───────────────────────────────────────────────────────
export const platformCompanies = pgTable(
  'platform_companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    marketType: marketTypeEnum('market_type').notNull(),
    ticker: text('ticker'), // public only
    sector: text('sector').notNull(),
    lifeStage: lifeStageEnum('life_stage').notNull(),
    country: text('country').notNull().default('US'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Partial unique index — public tickers are unique; private rows have no
    // ticker and are excluded. Keeps db:seed and ensureCompany idempotent.
    tickerIdx: uniqueIndex('platform_companies_ticker_idx')
      .on(t.ticker)
      .where(sql`${t.ticker} IS NOT NULL`),
    nameIdx: index('platform_companies_name_idx').on(t.name),
  }),
);

export const platformSignals = pgTable(
  'platform_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: text('entity').notNull(), // ticker or company UUID
    signalType: text('signal_type').notNull(),
    direction: signalDirectionEnum('direction').notNull(),
    magnitude: real('magnitude').notNull(),
    confidence: real('confidence').notNull(),
    sourceVersion: text('source_version').notNull(),
    rationale: text('rationale').notNull(),
    metadata: jsonb('metadata'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityTypeIdx: index('platform_signals_entity_type_idx').on(t.entity, t.signalType),
    tsIdx: index('platform_signals_ts_idx').on(t.timestamp),
  }),
);

/**
 * Per-signal audit lineage — flattened from `transformChain`.
 * One row per transform step. Joins back to platform_signals by signal_id.
 */
export const platformAudit = pgTable(
  'platform_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    signalId: uuid('signal_id').notNull().references(() => platformSignals.id, { onDelete: 'cascade' }),
    step: integer('step').notNull(),
    op: text('op').notNull(),
    inputs: jsonb('inputs').notNull(),
    output: jsonb('output').notNull(),
    weight: real('weight'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  },
  (t) => ({
    signalStepIdx: index('platform_audit_signal_step_idx').on(t.signalId, t.step),
  }),
);

export const platformClassifications = pgTable('platform_classifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity: text('entity').notNull(),
  assetClass: assetClassEnum('asset_class').notNull(),
  confidence: real('confidence').notNull(),
  rationale: text('rationale').notNull(),
  contributingSignals: jsonb('contributing_signals').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
});

export const platformPortfolios = pgTable('platform_portfolios', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  constraints: jsonb('constraints').notNull(),
  sleeveWeights: jsonb('sleeve_weights').notNull(),
  cashWeight: real('cash_weight').notNull(),
  warnings: jsonb('warnings').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
});

export const platformAllocations = pgTable(
  'platform_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id').notNull().references(() => platformPortfolios.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    name: text('name').notNull(),
    sector: text('sector').notNull(),
    sleeve: sleeveEnum('sleeve').notNull(),
    weight: real('weight').notNull(),
    assetClass: assetClassEnum('asset_class').notNull(),
  },
  (t) => ({
    portfolioIdx: index('platform_allocations_portfolio_idx').on(t.portfolioId),
  }),
);

export const platformSimulations = pgTable('platform_simulations', {
  id: uuid('id').primaryKey().defaultRandom(),
  portfolioId: uuid('portfolio_id').references(() => platformPortfolios.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(), // monte_carlo | scenario_tree | regime_switching
  inputs: jsonb('inputs').notNull(),
  outputs: jsonb('outputs').notNull(),
  seed: integer('seed'),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Decision log — every classification, allocation, and simulation gets logged
 * against eventual outcomes. After ~12 months, the meta-learning interface
 * activates and starts surfacing model-tuning suggestions.
 */
export const platformDecisions = pgTable(
  'platform_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: text('entity').notNull(),
    decisionType: text('decision_type').notNull(), // classification | allocation | simulation
    decisionPayload: jsonb('decision_payload').notNull(),
    outcomePayload: jsonb('outcome_payload'), // filled in later as outcomes land
    outcomeAt: timestamp('outcome_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityTypeIdx: index('platform_decisions_entity_type_idx').on(t.entity, t.decisionType),
  }),
);

// ── Private tables ────────────────────────────────────────────────────────
export const privateDcfInputs = pgTable('private_dcf_inputs', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => platformCompanies.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
});

export const privateCompsPeers = pgTable('private_comps_peers', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => platformCompanies.id, { onDelete: 'cascade' }),
  peerSet: jsonb('peer_set').notNull(),
  illiquidityDiscount: real('illiquidity_discount').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
});

export const privateLboAssumptions = pgTable('private_lbo_assumptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => platformCompanies.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
});

export const privateAltData = pgTable(
  'private_alt_data',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => platformCompanies.id, { onDelete: 'cascade' }),
    source: text('source').notNull(), // sec_edgar | github | uspto | google_trends | builtwith | tranco
    payload: jsonb('payload').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    companySourceIdx: index('private_alt_data_company_source_idx').on(t.companyId, t.source),
  }),
);

// ── Public tables ─────────────────────────────────────────────────────────
export const publicScores = pgTable(
  'public_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticker: text('ticker').notNull(),
    score: real('score').notNull(),
    label: text('label').notNull(),
    direction: signalDirectionEnum('direction').notNull(),
    components: jsonb('components').notNull(),
    confidence: real('confidence').notNull(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  },
  (t) => ({
    tickerAsOfIdx: index('public_scores_ticker_asof_idx').on(t.ticker, t.asOf),
  }),
);

export const publicEgs = pgTable('public_egs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticker: text('ticker').notNull(),
  payload: jsonb('payload').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
});

export const publicNis = pgTable('public_nis', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticker: text('ticker').notNull(),
  payload: jsonb('payload').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
});

export const publicNhs = pgTable('public_nhs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticker: text('ticker').notNull(),
  payload: jsonb('payload').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
});

export const publicSegments = pgTable('public_segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticker: text('ticker').notNull(),
  kind: text('kind').notNull(), // product | geographic
  payload: jsonb('payload').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
});

export const publicEstimates = pgTable('public_estimates', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticker: text('ticker').notNull(),
  period: text('period').notNull(),
  payload: jsonb('payload').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});
