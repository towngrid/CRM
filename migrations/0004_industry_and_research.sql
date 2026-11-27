CREATE TABLE "industries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_name" text NOT NULL,
	"type_name" text NOT NULL,
	"search_type" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" text DEFAULT 'true' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_leads" ADD COLUMN "industry_group" text;--> statement-breakpoint
ALTER TABLE "business_leads" ADD COLUMN "industry_type" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "industry_group" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "industry_type" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "research" jsonb;