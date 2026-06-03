CREATE TABLE IF NOT EXISTS "classification_thresholds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL,
	"core_confidence_floor" real NOT NULL,
	"avoid_confidence_floor" real NOT NULL,
	"sample_size" integer NOT NULL,
	"method" text NOT NULL,
	"metadata" jsonb
);
