-- Migration 0009: evidence quality, source reputation, reasoning paths.
--
-- Three new tables, all additive. No existing tables are modified.
-- Existing platform_decisions and platform_signals rows are preserved as-is.
-- reasoning_paths and evidence_quality are populated going forward by the
-- updated API jobs; historical decisions remain readable in their current form.

-- ── 1. evidence_sources ───────────────────────────────────────────────────
-- Registry of known data sources. One row per source_key (canonical string
-- like 'fmp:market_data', 'news:reuters', 'sec:10k').
-- credibility_score is updated by the reputation decay job after each graded
-- decision. It starts at a seed value from INITIAL_CREDIBILITY in config.ts
-- and converges toward the empirical hit rate over time.

CREATE TABLE evidence_sources (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key        TEXT        NOT NULL UNIQUE,
  source_type       TEXT        NOT NULL,   -- 'market_data'|'news_wire'|'sec_filing'|'analyst_estimate'|'alt_data'|'ml_model'
  display_name      TEXT        NOT NULL,
  credibility_score NUMERIC(6,5) NOT NULL DEFAULT 0.70000,
  decay_rate        NUMERIC(6,5) NOT NULL DEFAULT 0.05000,
  sample_count      INTEGER      NOT NULL DEFAULT 0,
  correct_count     INTEGER      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed well-known sources so reputation decay has a starting point.
INSERT INTO evidence_sources (source_key, source_type, display_name, credibility_score) VALUES
  ('fmp:market_data',         'market_data',       'FMP Market Data',          0.85),
  ('fmp:earnings',            'market_data',       'FMP Earnings',             0.80),
  ('fmp:analyst_estimate',    'analyst_estimate',  'FMP Analyst Estimates',    0.65),
  ('fmp:estimate_consensus',  'analyst_estimate',  'FMP Estimate Consensus',   0.62),
  ('sec:10k',                 'sec_filing',        'SEC 10-K Filing',          0.88),
  ('sec:10q',                 'sec_filing',        'SEC 10-Q Filing',          0.85),
  ('sec:8k',                  'sec_filing',        'SEC 8-K Filing',           0.80),
  ('news:reuters',            'news_wire',         'Reuters',                  0.68),
  ('news:bloomberg',          'news_wire',         'Bloomberg',                0.70),
  ('news:wire',               'news_wire',         'Wire (generic)',            0.60),
  ('news:blog',               'news_wire',         'Blog / unverified',        0.38),
  ('alt_data:web_traffic',    'alt_data',          'Web Traffic',              0.55),
  ('alt_data:ip_filings',     'alt_data',          'IP Filings',               0.58),
  ('alt_data:app_activity',   'alt_data',          'App Activity',             0.52),
  ('alt_data:domain_rank',    'alt_data',          'Domain Rank',              0.48),
  ('ml:adjustment',           'ml_model',          'ML Score Adjustment',      0.50);


-- ── 2. evidence_quality ───────────────────────────────────────────────────
-- One row per harmonized platform_signal. Records the five quality components
-- and the composite score at the time the signal was ingested.
-- Retains the weight_config snapshot so the composite can be reproduced even
-- if weights are later changed.

CREATE TABLE evidence_quality (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id              UUID        NOT NULL REFERENCES platform_signals(id) ON DELETE CASCADE,
  source_key             TEXT        NOT NULL,
  source_credibility     NUMERIC(6,5) NOT NULL,
  recency_score          NUMERIC(6,5) NOT NULL,
  independence_score     NUMERIC(6,5) NOT NULL,
  methodological_strength NUMERIC(6,5) NOT NULL,
  historical_reliability NUMERIC(6,5) NOT NULL,
  composite_score        NUMERIC(6,5) NOT NULL,
  weight_config          JSONB        NOT NULL,
  scored_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evidence_quality_signal ON evidence_quality(signal_id);
CREATE INDEX idx_evidence_quality_source ON evidence_quality(source_key);
CREATE INDEX idx_evidence_quality_composite ON evidence_quality(composite_score);


-- ── 3. reasoning_paths ────────────────────────────────────────────────────
-- One row per layer per decision. A composite divergence signal fires three
-- layers (egs, nis, nhs) plus one composite row. A classification fires a
-- classification row plus optionally the composite.
-- input_signal_ids: JSONB array of platform_signals UUIDs (Postgres UUID[]
-- not used directly to avoid type headaches with jsonb).
-- sensitivity: { signal_uuid → abs_delta_if_removed }

CREATE TABLE reasoning_paths (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id               UUID        NOT NULL REFERENCES platform_decisions(id) ON DELETE CASCADE,
  entity                    TEXT        NOT NULL,
  layer                     TEXT        NOT NULL,   -- 'egs'|'nis'|'nhs'|'composite'|'classification'
  layer_score               NUMERIC(8,5),
  threshold_key             TEXT,
  threshold_value           NUMERIC(8,5),
  fired                     BOOLEAN      NOT NULL DEFAULT FALSE,
  input_signal_ids          JSONB        NOT NULL DEFAULT '[]',
  quality_scores            JSONB        NOT NULL DEFAULT '{}',
  composite_quality         NUMERIC(6,5),
  sensitivity               JSONB        NOT NULL DEFAULT '{}',
  max_sensitivity_signal_id TEXT,
  max_sensitivity_delta     NUMERIC(10,7),
  captured_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reasoning_paths_decision ON reasoning_paths(decision_id);
CREATE INDEX idx_reasoning_paths_entity   ON reasoning_paths(entity);
CREATE INDEX idx_reasoning_paths_layer    ON reasoning_paths(layer);
