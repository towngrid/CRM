CREATE TABLE "business_leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"town" text,
	"zip" text,
	"phone" text,
	"rating" real,
	"review_count" integer,
	"google_category" text,
	"google_url" text,
	"google_place_id" text,
	"google_data_id" text,
	"website_url" text,
	"facebook_url" text,
	"instagram_url" text,
	"delivery_apps" text,
	"own_ordering" text,
	"sends_to_apps" text,
	"still_open_flag" boolean DEFAULT false NOT NULL,
	"google_status" text,
	"lead_list" text NOT NULL,
	"lead_type" text,
	"check_status" text DEFAULT 'pending' NOT NULL,
	"check_error" text,
	"findings" jsonb,
	"maps_result" jsonb,
	"hand_checked" boolean DEFAULT false NOT NULL,
	"facebook_followers" integer,
	"instagram_followers" integer,
	"last_post_date" text,
	"hand_check_notes" text,
	"approved_at" timestamp,
	"contact_id" varchar,
	"deal_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"checked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "business_searches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"business_type" text NOT NULL,
	"business_type_other" text,
	"lead_list" text NOT NULL,
	"places" jsonb NOT NULL,
	"pages_per_place" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"estimate" jsonb,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"cached_calls" integer DEFAULT 0 NOT NULL,
	"businesses_found" integer DEFAULT 0 NOT NULL,
	"businesses_checked" integer DEFAULT 0 NOT NULL,
	"outside_area" integer DEFAULT 0 NOT NULL,
	"duplicates_removed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "business_leads" ADD CONSTRAINT "business_leads_search_id_business_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."business_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_leads" ADD CONSTRAINT "business_leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "business_searches" ADD CONSTRAINT "business_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "business_leads_search_idx" ON "business_leads" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "business_leads_user_idx" ON "business_leads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "business_searches_user_idx" ON "business_searches" USING btree ("user_id","created_at");--> statement-breakpoint
-- TownGrid's SerpAPI Starter plan (1,000 searches a month, Nov 23): stop at 900, up to 100 an hour.
UPDATE "serp_usage" SET "monthly_quota" = 1000, "hard_stop_at" = 900 WHERE "monthly_quota" = 250 AND "hard_stop_at" = 200;--> statement-breakpoint
UPDATE "lead_discovery_config" SET "max_serp_calls_per_hour" = 100 WHERE "max_serp_calls_per_hour" = 5;
