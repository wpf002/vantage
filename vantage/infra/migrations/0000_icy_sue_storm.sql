CREATE TYPE "public"."asset_class" AS ENUM('CORE', 'HIGH_ASYMMETRY', 'TACTICAL', 'AVOID');--> statement-breakpoint
CREATE TYPE "public"."life_stage" AS ENUM('seed', 'series_a', 'series_b', 'series_c_plus', 'pre_ipo', 'public_early', 'public_mature');--> statement-breakpoint
CREATE TYPE "public"."market_type" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "public"."signal_direction" AS ENUM('bullish', 'neutral', 'bearish');--> statement-breakpoint
CREATE TYPE "public"."sleeve" AS ENUM('core', 'growth', 'defensive', 'tactical', 'none');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"sector" text NOT NULL,
	"sleeve" "sleeve" NOT NULL,
	"weight" real NOT NULL,
	"asset_class" "asset_class" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"op" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"weight" real,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"confidence" real NOT NULL,
	"rationale" text NOT NULL,
	"contributing_signals" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"market_type" "market_type" NOT NULL,
	"ticker" text,
	"sector" text NOT NULL,
	"life_stage" "life_stage" NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"decision_type" text NOT NULL,
	"decision_payload" jsonb NOT NULL,
	"outcome_payload" jsonb,
	"outcome_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"constraints" jsonb NOT NULL,
	"sleeve_weights" jsonb NOT NULL,
	"cash_weight" real NOT NULL,
	"warnings" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"signal_type" text NOT NULL,
	"direction" "signal_direction" NOT NULL,
	"magnitude" real NOT NULL,
	"confidence" real NOT NULL,
	"source_version" text NOT NULL,
	"rationale" text NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_simulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid,
	"kind" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"seed" integer,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "private_alt_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "private_comps_peers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"peer_set" jsonb NOT NULL,
	"illiquidity_discount" real NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "private_dcf_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "private_lbo_assumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_egs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"payload" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"period" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_nhs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"payload" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_nis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"payload" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"score" real NOT NULL,
	"label" text NOT NULL,
	"direction" "signal_direction" NOT NULL,
	"components" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_allocations" ADD CONSTRAINT "platform_allocations_portfolio_id_platform_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."platform_portfolios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_signal_id_platform_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."platform_signals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_simulations" ADD CONSTRAINT "platform_simulations_portfolio_id_platform_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."platform_portfolios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "private_alt_data" ADD CONSTRAINT "private_alt_data_company_id_platform_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."platform_companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "private_comps_peers" ADD CONSTRAINT "private_comps_peers_company_id_platform_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."platform_companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "private_dcf_inputs" ADD CONSTRAINT "private_dcf_inputs_company_id_platform_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."platform_companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "private_lbo_assumptions" ADD CONSTRAINT "private_lbo_assumptions_company_id_platform_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."platform_companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_allocations_portfolio_idx" ON "platform_allocations" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_audit_signal_step_idx" ON "platform_audit" USING btree ("signal_id","step");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_companies_ticker_idx" ON "platform_companies" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_companies_name_idx" ON "platform_companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_decisions_entity_type_idx" ON "platform_decisions" USING btree ("entity","decision_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_signals_entity_type_idx" ON "platform_signals" USING btree ("entity","signal_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_signals_ts_idx" ON "platform_signals" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "private_alt_data_company_source_idx" ON "private_alt_data" USING btree ("company_id","source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_scores_ticker_asof_idx" ON "public_scores" USING btree ("ticker","as_of");