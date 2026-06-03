CREATE TABLE IF NOT EXISTS "scoring_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL,
	"egs_weight" real NOT NULL,
	"nis_weight" real NOT NULL,
	"nhs_weight" real NOT NULL,
	"sample_size" integer NOT NULL,
	"method" text NOT NULL,
	"metadata" jsonb
);
