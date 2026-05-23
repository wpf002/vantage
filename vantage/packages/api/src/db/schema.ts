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
  primaryKey,
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
export const portfolioKindEnum = pgEnum('portfolio_kind', ['system', 'personal', 'published']);
// Phase 10 — watchlists & alerts.
export const watchlistKindEnum = pgEnum('watchlist_kind', ['system', 'personal']);
export const alertRuleTypeEnum = pgEnum('alert_rule_type', [
  'label_change',
  'score_move',
  'classification_transition',
  'morning_digest',
]);

// ── Auth tables ───────────────────────────────────────────────────────────
//
// Mirrors @auth/drizzle-adapter's expected shape for NextAuth v5. The UI
// package duplicates these four table definitions in
// packages/ui/src/lib/auth-schema.ts so the Drizzle adapter can run without
// pulling in the api package (single source of truth lives HERE; the UI
// copy is annotated). lastSeenAt is a Vantage extension on top of the
// adapter contract.

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    emailVerified: timestamp('email_verified', { withTimezone: true }),
    name: text('name'),
    image: text('image'),
    // Phase 5.1 — credentials auth. bcrypt hash; null for accounts created
    // via the old magic-link path (legacy / never used in prod yet).
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expires),
  }),
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

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
    // Phase 9 — the screener filters and sorts by sector across the whole
    // public universe.
    sectorIdx: index('platform_companies_sector_idx').on(t.sector),
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

export const platformClassifications = pgTable(
  'platform_classifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: text('entity').notNull(),
    assetClass: assetClassEnum('asset_class').notNull(),
    confidence: real('confidence').notNull(),
    rationale: text('rationale').notNull(),
    contributingSignals: jsonb('contributing_signals').notNull(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  },
  (t) => ({
    // Phase 9 — the screener and daily board both resolve the latest
    // classification per entity (DISTINCT ON entity ORDER BY as_of DESC).
    entityAsOfIdx: index('platform_classifications_entity_asof_idx').on(t.entity, t.asOf),
  }),
);

export const platformPortfolios = pgTable(
  'platform_portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    constraints: jsonb('constraints').notNull(),
    sleeveWeights: jsonb('sleeve_weights').notNull(),
    cashWeight: real('cash_weight').notNull(),
    warnings: jsonb('warnings').notNull(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    // Phase 5 — sharing model. `kind` discriminates the three modes; system
    // rows have ownerUserId=NULL, personal & published rows have an owner.
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: portfolioKindEnum('kind').notNull().default('personal'),
    slug: text('slug'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    description: text('description'),
  },
  (t) => ({
    ownerIdx: index('platform_portfolios_owner_idx').on(t.ownerUserId),
    kindIdx: index('platform_portfolios_kind_idx').on(t.kind),
    // Slug is only populated for kind='published' — partial unique index keeps
    // null rows out of the constraint while guaranteeing publish-time uniqueness.
    slugIdx: uniqueIndex('platform_portfolios_slug_idx')
      .on(t.slug)
      .where(sql`${t.slug} IS NOT NULL`),
  }),
);

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

// ── Phase 10 — Watchlists, Alerts, Narrative Tags ───────────────────────────

/**
 * A per-user (or system-curated) subset of entities the user cares about.
 * `kind='system'` rows have a null owner and are read-only for users —
 * analogous to The Default portfolio.
 */
export const platformWatchlists = pgTable(
  'platform_watchlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: watchlistKindEnum('kind').notNull().default('personal'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('platform_watchlists_owner_idx').on(t.ownerUserId),
    kindIdx: index('platform_watchlists_kind_idx').on(t.kind),
    // System watchlists are seeded idempotently on (kind, name) — see
    // infra/seeds/system-watchlists.ts. Partial unique index keeps personal
    // rows (which may share a name across users) out of the constraint.
    systemNameIdx: uniqueIndex('platform_watchlists_system_name_idx')
      .on(t.name)
      .where(sql`${t.kind} = 'system'`),
  }),
);

export const platformWatchlistItems = pgTable(
  'platform_watchlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    watchlistId: uuid('watchlist_id')
      .notNull()
      .references(() => platformWatchlists.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(), // ticker for public, companyId for private
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    watchlistIdx: index('platform_watchlist_items_watchlist_idx').on(t.watchlistId),
    // No duplicate items in a single watchlist.
    uniqItem: uniqueIndex('platform_watchlist_items_uniq').on(t.watchlistId, t.entity),
  }),
);

/**
 * Alert rules attached to a watchlist. config is rule-specific (see
 * AlertRuleConfig in @vantage/shared). When triggered, fan out per `channels`.
 */
export const platformAlertRules = pgTable(
  'platform_alert_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    watchlistId: uuid('watchlist_id')
      .notNull()
      .references(() => platformWatchlists.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ruleType: alertRuleTypeEnum('rule_type').notNull(),
    config: jsonb('config').notNull(),
    active: boolean('active').notNull().default(true),
    channels: jsonb('channels').notNull().default(sql`'{"web":true,"email":false}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index('platform_alert_rules_owner_idx').on(t.ownerUserId),
    watchlistIdx: index('platform_alert_rules_watchlist_idx').on(t.watchlistId),
    activeIdx: index('platform_alert_rules_active_idx').on(t.active),
  }),
);

/**
 * One row per dispatched alert. (ruleId, triggerSignalId) is the logical
 * idempotency key — the evaluator checks before insert so a worker restart
 * mid-process can't double-fire.
 */
export const platformAlertEvents = pgTable(
  'platform_alert_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => platformAlertRules.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    triggerSignalId: uuid('trigger_signal_id').references(() => platformSignals.id),
    payload: jsonb('payload').notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
    channels: jsonb('channels').notNull(),
    channelResults: jsonb('channel_results').notNull().default(sql`'{}'::jsonb`),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  },
  (t) => ({
    ownerDispatchedIdx: index('platform_alert_events_owner_dispatched_idx').on(
      t.ownerUserId,
      t.dispatchedAt.desc(),
    ),
    acknowledgedIdx: index('platform_alert_events_acknowledged_idx').on(t.acknowledgedAt),
    // Idempotency lookup — one event per (rule, triggering signal).
    ruleSignalIdx: index('platform_alert_events_rule_signal_idx').on(t.ruleId, t.triggerSignalId),
  }),
);

export const platformPushSubscriptions = pgTable(
  'platform_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    keys: jsonb('keys').notNull(), // { p256dh, auth }
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqEndpoint: uniqueIndex('platform_push_subscriptions_uniq').on(t.userId, t.endpoint),
  }),
);

/**
 * News-assisted narrative segment tags (Phase 10, Part 4). Written by the
 * narrative-tag worker during universe re-scoring; read by core-public's NIS
 * computation, which falls back to the rule-based heuristic when absent.
 */
export const publicNarrativeTags = pgTable(
  'public_narrative_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticker: text('ticker').notNull(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    narrativeSegments: jsonb('narrative_segments').notNull(), // [{ name, confidence }]
    rationale: text('rationale'),
    modelVersion: text('model_version').notNull(),
    source: text('source').notNull(), // 'news' | 'fallback'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tickerIdx: index('public_narrative_tags_ticker_idx').on(t.ticker),
    uniqTickerAsOf: uniqueIndex('public_narrative_tags_ticker_asof_uniq').on(t.ticker, t.asOf),
  }),
);
