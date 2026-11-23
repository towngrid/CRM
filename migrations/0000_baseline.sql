CREATE TABLE "activities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"contact_id" varchar,
	"deal_id" varchar,
	"task_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "commission_monthly_payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_id" varchar NOT NULL,
	"deal_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"period_number" integer NOT NULL,
	"paid_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"plan_name" text NOT NULL,
	"upfront_amount" numeric(10, 2) NOT NULL,
	"monthly_amount" numeric(10, 2) NOT NULL,
	"confirmed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"group_id" varchar,
	"first_name" text,
	"last_name" text,
	"use_business_name_for_email" text DEFAULT 'No',
	"email" text,
	"phone" text,
	"phone_cell" text,
	"phone_work" text,
	"phone_other" text,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"company" text,
	"job_title" text,
	"uses_software" text,
	"lead_list" text,
	"lead_type" text,
	"has_website" text,
	"website_url" text,
	"contact_request_form_url" text,
	"facebook_url" text,
	"instagram_handle" text,
	"secondary_first_name" text,
	"secondary_last_name" text,
	"lead_source" text,
	"current_software" text,
	"booking_software_url" text,
	"number_of_employees" integer,
	"number_of_locations" integer,
	"pain_points" text,
	"interest_level" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"business_type" text DEFAULT 'salon',
	"sequence_track" text,
	"last_contact_date" timestamp,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "deal_activities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"activity_type" text NOT NULL,
	"created_by" varchar NOT NULL,
	"notes" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price" numeric(10, 2),
	"billing" text DEFAULT 'monthly' NOT NULL,
	"kind" text DEFAULT 'plan' NOT NULL,
	"note" text,
	"active" text DEFAULT 'true' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" varchar NOT NULL,
	"contact_id" varchar,
	"title" text NOT NULL,
	"task_type" text DEFAULT 'other' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_date" timestamp,
	"due_time" text,
	"assigned_to" varchar,
	"assigned_email" text,
	"reminder_timing" text DEFAULT 'none',
	"reminder_datetime" timestamp,
	"reminder_sent" text DEFAULT 'false',
	"notes" text,
	"auto_followup" text DEFAULT 'false',
	"followup_title" text,
	"followup_days_out" integer,
	"completed" text DEFAULT 'false' NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"contact_id" varchar,
	"value" numeric(10, 2),
	"plan" text,
	"stage" text DEFAULT 'new_lead_unqualified' NOT NULL,
	"stage_changed_at" timestamp,
	"probability" integer DEFAULT 0,
	"expected_close_date" timestamp,
	"demo_scheduled_date" timestamp,
	"demo_completed_date" timestamp,
	"won_date" timestamp,
	"description" text,
	"approved" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_sequence_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"sequence_id" varchar NOT NULL,
	"sequence_track" text DEFAULT 'salon_no_software' NOT NULL,
	"sequence_number" integer NOT NULL,
	"sent_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"email_response_received" text DEFAULT 'false',
	"last_checked_at" timestamp,
	"processing_started_at" timestamp,
	"scheduled_send_at" timestamp,
	"custom_subject" text,
	"custom_body" text,
	"error_message" text,
	"brevo_message_id" text,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_sequences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"strategy" text DEFAULT 'legacy' NOT NULL,
	"sequence_track" text DEFAULT 'salon_no_software' NOT NULL,
	"sequence_number" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"scheduled_date" timestamp,
	"scheduled_time" text,
	"days_after_no_reply" integer,
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"contact_id" varchar,
	"email_sequence_log_id" varchar,
	"from" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text,
	"body_html" text,
	"is_read" text DEFAULT 'false' NOT NULL,
	"received_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_discovery_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_key" text NOT NULL,
	"queries_per_zip" integer DEFAULT 2 NOT NULL,
	"max_zips_per_run" integer DEFAULT 3 NOT NULL,
	"max_runs_per_day" integer DEFAULT 1 NOT NULL,
	"max_serp_calls_per_hour" integer DEFAULT 5 NOT NULL,
	"enable_third_query" text DEFAULT 'false',
	"plan_type" text DEFAULT 'free' NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "lead_discovery_config_config_key_unique" UNIQUE("config_key")
);
--> statement-breakpoint
CREATE TABLE "lead_discovery_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"national_job_id" varchar,
	"state" text NOT NULL,
	"zip_codes" text NOT NULL,
	"search_engines" text DEFAULT 'google,bing' NOT NULL,
	"max_results_per_zip" integer DEFAULT 20,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_zip_codes" integer DEFAULT 0,
	"processed_zip_codes" integer DEFAULT 0,
	"total_businesses_found" integer DEFAULT 0,
	"duplicates_removed" integer DEFAULT 0,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_discovery_results" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"company" text,
	"job_title" text,
	"uses_software" text,
	"current_software" text,
	"booking_software_url" text,
	"has_website" text,
	"website_url" text,
	"contact_request_form_url" text,
	"lead_source" text,
	"notes" text,
	"zip_code" text,
	"search_query" text,
	"google_business_profile_url" text,
	"is_duplicate" text DEFAULT 'false',
	"is_imported" text DEFAULT 'false',
	"imported_contact_id" varchar,
	"crawl_status" text DEFAULT 'pending',
	"crawl_error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"code_hash" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "national_search_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"states_total" integer DEFAULT 50 NOT NULL,
	"states_completed" integer DEFAULT 0 NOT NULL,
	"leads_found" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"target_states" text,
	"max_per_state" integer DEFAULT 3 NOT NULL,
	"no_software_only" text DEFAULT 'false' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payroll_line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_period_id" varchar NOT NULL,
	"commission_id" varchar,
	"monthly_payment_id" varchar,
	"type" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"deal_title" text NOT NULL,
	"plan_name" text NOT NULL,
	"original_amount" text NOT NULL,
	"adjusted_amount" text NOT NULL,
	"date" timestamp NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"created_by_admin_id" varchar,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"total_amount" text DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"sent_at" timestamp,
	"sent_to_emails" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "salon_enrichment_batches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"file_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"enriched_rows" integer DEFAULT 0 NOT NULL,
	"needs_review_rows" integer DEFAULT 0 NOT NULL,
	"approved_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"pilot_limit" integer DEFAULT 100 NOT NULL,
	"concurrency" integer DEFAULT 2 NOT NULL,
	"estimated_serp_calls" integer DEFAULT 0 NOT NULL,
	"used_serp_calls" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"research_progress" jsonb,
	"started_at" timestamp,
	"paused_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "salon_enrichment_rows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"row_number" integer NOT NULL,
	"source_data" jsonb NOT NULL,
	"place_id" text,
	"business_name" text NOT NULL,
	"address" text,
	"address_1" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"latitude" text,
	"longitude" text,
	"business_status" text,
	"website_url" text,
	"email" text,
	"phone" text,
	"contact_request_form_url" text,
	"contact_form_status" text DEFAULT 'unknown' NOT NULL,
	"booking_url" text,
	"current_software" text,
	"uses_software" text DEFAULT 'Unknown',
	"has_website" text DEFAULT 'Unknown',
	"audience_track" text DEFAULT 'directory_general',
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"identity_match_status" text DEFAULT 'pending',
	"status" text DEFAULT 'pending' NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"duplicate_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_contact_id" varchar,
	"serp_calls_used" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "salon_form_outreach" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"salon_row_id" varchar NOT NULL,
	"strategy" text NOT NULL,
	"sequence_track" text NOT NULL,
	"sequence_id" varchar NOT NULL,
	"sequence_number" integer DEFAULT 1 NOT NULL,
	"form_url" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"due_at" timestamp DEFAULT now() NOT NULL,
	"acted_at" timestamp,
	"acted_by" varchar,
	"note" text,
	"submitted_count" integer DEFAULT 0 NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "salon_form_outreach_salon_row_id_unique" UNIQUE("salon_row_id")
);
--> statement-breakpoint
CREATE TABLE "serp_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zip_code" text NOT NULL,
	"query_template" text NOT NULL,
	"state" text NOT NULL,
	"results_json" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "serp_call_reservations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serp_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_year" text NOT NULL,
	"monthly_quota" integer DEFAULT 250 NOT NULL,
	"used_credits" integer DEFAULT 0 NOT NULL,
	"hard_stop_at" integer DEFAULT 200 NOT NULL,
	"last_reset_date" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "serp_usage_month_year_unique" UNIQUE("month_year")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"contact_id" varchar,
	"deal_id" varchar,
	"due_date" timestamp,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"work_email" varchar,
	"reply_to_email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"phone" varchar,
	"profile_image_url" varchar,
	"role" text DEFAULT 'salesperson' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_monthly_payments" ADD CONSTRAINT "commission_monthly_payments_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_monthly_payments" ADD CONSTRAINT "commission_monthly_payments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_monthly_payments" ADD CONSTRAINT "commission_monthly_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contact_groups" ADD CONSTRAINT "contact_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_group_id_contact_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."contact_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_activities" ADD CONSTRAINT "deal_activities_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_activities" ADD CONSTRAINT "deal_activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_activities" ADD CONSTRAINT "deal_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_tasks" ADD CONSTRAINT "deal_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_logs" ADD CONSTRAINT "email_sequence_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "email_sequence_logs" ADD CONSTRAINT "email_sequence_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_logs" ADD CONSTRAINT "email_sequence_logs_sequence_id_email_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."email_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequences" ADD CONSTRAINT "email_sequences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_email_sequence_log_id_email_sequence_logs_id_fk" FOREIGN KEY ("email_sequence_log_id") REFERENCES "public"."email_sequence_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_discovery_jobs" ADD CONSTRAINT "lead_discovery_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lead_discovery_jobs" ADD CONSTRAINT "lead_discovery_jobs_national_job_id_national_search_jobs_id_fk" FOREIGN KEY ("national_job_id") REFERENCES "public"."national_search_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_discovery_results" ADD CONSTRAINT "lead_discovery_results_job_id_lead_discovery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."lead_discovery_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_discovery_results" ADD CONSTRAINT "lead_discovery_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "national_search_jobs" ADD CONSTRAINT "national_search_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_monthly_payment_id_commission_monthly_payments_id_fk" FOREIGN KEY ("monthly_payment_id") REFERENCES "public"."commission_monthly_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_admin_id_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_enrichment_batches" ADD CONSTRAINT "salon_enrichment_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salon_enrichment_rows" ADD CONSTRAINT "salon_enrichment_rows_batch_id_salon_enrichment_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."salon_enrichment_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_enrichment_rows" ADD CONSTRAINT "salon_enrichment_rows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salon_enrichment_rows" ADD CONSTRAINT "salon_enrichment_rows_imported_contact_id_contacts_id_fk" FOREIGN KEY ("imported_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_form_outreach" ADD CONSTRAINT "salon_form_outreach_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salon_form_outreach" ADD CONSTRAINT "salon_form_outreach_salon_row_id_salon_enrichment_rows_id_fk" FOREIGN KEY ("salon_row_id") REFERENCES "public"."salon_enrichment_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_form_outreach" ADD CONSTRAINT "salon_form_outreach_sequence_id_email_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."email_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salon_form_outreach" ADD CONSTRAINT "salon_form_outreach_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_sequences_owner_strategy_track_step_unique" ON "email_sequences" USING btree ("user_id","strategy","sequence_track","sequence_number");--> statement-breakpoint
CREATE INDEX "IDX_login_codes_email" ON "login_codes" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "salon_enrichment_rows_batch_row_unique" ON "salon_enrichment_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "salon_enrichment_rows_batch_status_idx" ON "salon_enrichment_rows" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "salon_enrichment_rows_batch_review_idx" ON "salon_enrichment_rows" USING btree ("batch_id","review_status");--> statement-breakpoint
CREATE INDEX "salon_form_outreach_user_due_idx" ON "salon_form_outreach" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");