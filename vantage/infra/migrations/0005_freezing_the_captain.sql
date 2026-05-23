CREATE TYPE "public"."alert_rule_type" AS ENUM('label_change', 'score_move', 'classification_transition', 'morning_digest');--> statement-breakpoint
CREATE TYPE "public"."watchlist_kind" AS ENUM('system', 'personal');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"trigger_signal_id" uuid,
	"payload" jsonb NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channels" jsonb NOT NULL,
	"channel_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"rule_type" "alert_rule_type" NOT NULL,
	"config" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"channels" jsonb DEFAULT '{"web":true,"email":false}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid,
	"kind" "watchlist_kind" DEFAULT 'personal' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_narrative_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"narrative_segments" jsonb NOT NULL,
	"rationale" text,
	"model_version" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_alert_events" ADD CONSTRAINT "platform_alert_events_rule_id_platform_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."platform_alert_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_alert_events" ADD CONSTRAINT "platform_alert_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_alert_events" ADD CONSTRAINT "platform_alert_events_trigger_signal_id_platform_signals_id_fk" FOREIGN KEY ("trigger_signal_id") REFERENCES "public"."platform_signals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_alert_rules" ADD CONSTRAINT "platform_alert_rules_watchlist_id_platform_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."platform_watchlists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_alert_rules" ADD CONSTRAINT "platform_alert_rules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_push_subscriptions" ADD CONSTRAINT "platform_push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_watchlist_items" ADD CONSTRAINT "platform_watchlist_items_watchlist_id_platform_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."platform_watchlists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_watchlists" ADD CONSTRAINT "platform_watchlists_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_alert_events_owner_dispatched_idx" ON "platform_alert_events" USING btree ("owner_user_id","dispatched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_alert_events_acknowledged_idx" ON "platform_alert_events" USING btree ("acknowledged_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_alert_events_rule_signal_idx" ON "platform_alert_events" USING btree ("rule_id","trigger_signal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_alert_rules_owner_idx" ON "platform_alert_rules" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_alert_rules_watchlist_idx" ON "platform_alert_rules" USING btree ("watchlist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_alert_rules_active_idx" ON "platform_alert_rules" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_push_subscriptions_uniq" ON "platform_push_subscriptions" USING btree ("user_id","endpoint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_watchlist_items_watchlist_idx" ON "platform_watchlist_items" USING btree ("watchlist_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_watchlist_items_uniq" ON "platform_watchlist_items" USING btree ("watchlist_id","entity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_watchlists_owner_idx" ON "platform_watchlists" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_watchlists_kind_idx" ON "platform_watchlists" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_watchlists_system_name_idx" ON "platform_watchlists" USING btree ("name") WHERE "platform_watchlists"."kind" = 'system';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_narrative_tags_ticker_idx" ON "public_narrative_tags" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_narrative_tags_ticker_asof_uniq" ON "public_narrative_tags" USING btree ("ticker","as_of");