CREATE TABLE "score_points" (
	"key" text PRIMARY KEY NOT NULL,
	"points" integer NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "business_leads" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "business_leads" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "business_leads" ADD COLUMN "score_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "business_leads" ADD COLUMN "set_aside_reason" text;--> statement-breakpoint
ALTER TABLE "business_leads" ADD COLUMN "set_aside_by_hand" boolean DEFAULT false NOT NULL;