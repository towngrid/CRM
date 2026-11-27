import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, index, uniqueIndex, jsonb, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// From Replit Auth blueprint - Session storage table
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// From Replit Auth blueprint - User storage table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  workEmail: varchar("work_email"), // Professional email for sending sequences (e.g., seann@towngrid.contact)
  replyToEmail: varchar("reply_to_email"), // Reply-to address for inbound parse (e.g., seann@towngrid.contact)
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  phone: varchar("phone"),
  profileImageUrl: varchar("profile_image_url"),
  role: text("role").notNull().default("salesperson"), // salesperson, admin
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const contactGroups = pgTable("contact_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  groupId: varchar("group_id").references(() => contactGroups.id),
  firstName: text("first_name"),
  lastName: text("last_name"),
  useBusinessNameForEmail: text("use_business_name_for_email").default("No"), // Yes, No
  email: text("email"),
  phone: text("phone"),
  phoneCell: text("phone_cell"),
  phoneWork: text("phone_work"),
  phoneOther: text("phone_other"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  company: text("company"),
  jobTitle: text("job_title"),
  usesSoftware: text("uses_software"), // ESyCRM leftover, no longer shown; kept so old data isn't dropped
  leadList: text("lead_list"), // get_seen, ordering (shared/leadTypes.ts)
  leadType: text("lead_type"), // shared/leadTypes.ts
  industryGroup: text("industry_group"), // shared/industries.ts, e.g. "Home services"
  industryType: text("industry_type"), // e.g. "Landscapers"
  research: jsonb("research"), // Pre-visit research fields and the hand checklist (shared/research.ts)
  hasWebsite: text("has_website"), // Yes, No, Unknown
  websiteUrl: text("website_url"),
  contactRequestFormUrl: text("contact_request_form_url"),
  facebookUrl: text("facebook_url"),
  instagramHandle: text("instagram_handle"),
  secondaryFirstName: text("secondary_first_name"),
  secondaryLastName: text("secondary_last_name"),
  leadSource: text("lead_source"), // Inbound, Outbound, Cold Call, Facebook Ad, Referral, Event, TownGrid Website Form, Google Search
  currentSoftware: text("current_software"),
  bookingSoftwareUrl: text("booking_software_url"),
  numberOfEmployees: integer("number_of_employees"),
  numberOfLocations: integer("number_of_locations"),
  painPoints: text("pain_points"),
  interestLevel: text("interest_level"), // Low, Medium, High
  notes: text("notes"),
  status: text("status").notNull().default("active"), // active, inactive, pipeline
  businessType: text("business_type").default("salon"), // salon, mobile
  sequenceTrack: text("sequence_track"), // salon_no_software, salon_uses_competitor, mobile_no_software, mobile_uses_competitor - assigned when qualified
  lastContactDate: timestamp("last_contact_date"),
  archivedAt: timestamp("archived_at"),
});

export const deals = pgTable("deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  title: text("title").notNull(),
  contactId: varchar("contact_id").references(() => contacts.id),
  value: decimal("value", { precision: 10, scale: 2 }),
  plan: text("plan"), // Solo - $79/mo or $2 / Appoint, Salon - $149/mo or $3 / Appoint, Signature - $229/mo
  stage: text("stage").notNull().default("new_lead_unqualified"), // values: shared/dealStages.ts
  stageChangedAt: timestamp("stage_changed_at"),
  probability: integer("probability").default(0), // 0-100
  expectedCloseDate: timestamp("expected_close_date"),
  demoScheduledDate: timestamp("demo_scheduled_date"),
  demoCompletedDate: timestamp("demo_completed_date"),
  wonDate: timestamp("won_date"),
  description: text("description"),
  approved: text("approved").default("pending"), // pending, approved, rejected - for commission approval by admin
  createdAt: timestamp("created_at").defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  contactId: varchar("contact_id").references(() => contacts.id),
  dealId: varchar("deal_id").references(() => deals.id),
  dueDate: timestamp("due_date"),
  priority: text("priority").notNull().default("medium"), // low, medium, high
  status: text("status").notNull().default("pending"), // pending, completed
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const activities = pgTable("activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  type: text("type").notNull(), // contact_added, deal_created, task_completed, etc.
  description: text("description").notNull(),
  contactId: varchar("contact_id").references(() => contacts.id),
  dealId: varchar("deal_id").references(() => deals.id),
  taskId: varchar("task_id").references(() => tasks.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dealActivities = pgTable("deal_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dealId: varchar("deal_id").notNull().references(() => deals.id),
  contactId: varchar("contact_id").notNull().references(() => contacts.id),
  activityType: text("activity_type").notNull(), // 'call', 'email_note', 'note', 'site_visit', 'stage_change', 'task_created', 'task_completed', 'sequence_step'
  createdBy: varchar("created_by").notNull().references(() => users.id, { onUpdate: "cascade" }),
  notes: text("notes"),
  metadata: text("metadata"), // JSON blob for type-specific fields
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailSequences = pgTable("email_sequences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  strategy: text("strategy").notNull().default("legacy"), // legacy, directory_first
  sequenceTrack: text("sequence_track").notNull().default("salon_no_software"), // salon_no_software, salon_uses_competitor, salon_custom, mobile_no_software, mobile_uses_competitor, mobile_custom
  sequenceNumber: integer("sequence_number").notNull(), // 1-5
  subject: text("subject").notNull(),
  body: text("body").notNull(), // Email content with placeholders like [Contact_First_Name], [Sales_Person], [Business_Name]
  scheduledDate: timestamp("scheduled_date"), // Only for sequence 1
  scheduledTime: text("scheduled_time"), // Only for sequence 1, e.g., "09:00"
  daysAfterNoReply: integer("days_after_no_reply"), // For sequences 2-5
  isActive: text("is_active").notNull().default("true"), // true, false
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("email_sequences_owner_strategy_track_step_unique").on(
    table.userId,
    table.strategy,
    table.sequenceTrack,
    table.sequenceNumber,
  ),
]);

export const emailSequenceLogs = pgTable("email_sequence_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id),
  sequenceId: varchar("sequence_id").notNull().references(() => emailSequences.id),
  sequenceTrack: text("sequence_track").notNull().default("salon_no_software"), // salon_no_software, salon_uses_competitor, salon_custom, mobile_no_software, mobile_uses_competitor, mobile_custom
  sequenceNumber: integer("sequence_number").notNull(), // 1-5
  sentAt: timestamp("sent_at"),
  status: text("status").notNull().default("pending"), // pending, processing, sent, failed, replied
  emailResponseReceived: text("email_response_received").default("false"), // true, false
  lastCheckedAt: timestamp("last_checked_at"),
  processingStartedAt: timestamp("processing_started_at"), // Track when log transitions to "processing"
  scheduledSendAt: timestamp("scheduled_send_at"), // Per-log override: don't send until this time (Eastern Time interpreted)
  customSubject: text("custom_subject"), // Per-contact email subject override (used for "custom" track)
  customBody: text("custom_body"),       // Per-contact email body override (used for "custom" track)
  errorMessage: text("error_message"),   // Stores the SendGrid error if status = failed
  brevoMessageId: text("brevo_message_id"), // Brevo messageId returned after sending (for open/click tracking)
  openedAt: timestamp("opened_at"),         // First time the email was opened (from Brevo events API)
  clickedAt: timestamp("clicked_at"),       // First time a link was clicked (from Brevo events API)
  createdAt: timestamp("created_at").defaultNow(),
});

export const inboxMessages = pgTable("inbox_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  contactId: varchar("contact_id").references(() => contacts.id),
  emailSequenceLogId: varchar("email_sequence_log_id").references(() => emailSequenceLogs.id),
  from: text("from").notNull(),
  subject: text("subject").notNull(),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  isRead: text("is_read").notNull().default("false"), // true, false
  receivedAt: timestamp("received_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dealTasks = pgTable("deal_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dealId: varchar("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => contacts.id),
  title: text("title").notNull(),
  taskType: text("task_type").notNull().default("other"), // call, email, demo, follow_up, site_visit, other
  priority: text("priority").notNull().default("medium"), // high, medium, low
  dueDate: timestamp("due_date"),
  dueTime: text("due_time"), // e.g. "09:00"
  assignedTo: varchar("assigned_to").references(() => users.id),
  assignedEmail: text("assigned_email"),
  reminderTiming: text("reminder_timing").default("none"), // none, 15min, 1hour, 1day, custom
  reminderDatetime: timestamp("reminder_datetime"),
  reminderSent: text("reminder_sent").default("false"),
  notes: text("notes"),
  autoFollowup: text("auto_followup").default("false"),
  followupTitle: text("followup_title"),
  followupDaysOut: integer("followup_days_out"),
  completed: text("completed").notNull().default("false"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export type DealTask = typeof dealTasks.$inferSelect;
export const insertDealTaskSchema = createInsertSchema(dealTasks).omit({
  id: true,
  completedAt: true,
  reminderSent: true,
  createdAt: true,
}).extend({
  title: z.string().min(1, "Title is required"),
  dueDate: z.string().optional().nullable(),
  reminderDatetime: z.string().optional().nullable(),
});
export type InsertDealTask = z.infer<typeof insertDealTaskSchema>;

export const insertContactGroupSchema = createInsertSchema(contactGroups).omit({
  id: true,
  userId: true,
  createdAt: true,
}).extend({
  name: z.string().min(1, "Group name is required"),
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  userId: true,
  lastContactDate: true,
}).extend({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  leadList: z.enum(["get_seen", "ordering", ""]).optional().nullable(),
  leadType: z.string().max(60).optional().nullable(),
  useBusinessNameForEmail: z.string().optional().nullable(),
});

export const insertDealSchema = createInsertSchema(deals).omit({
  id: true,
  userId: true,
  createdAt: true,
}).extend({
  value: z.string().optional().nullable(),
  expectedCloseDate: z.string().optional().nullable(),
  demoScheduledDate: z.string().optional().nullable(),
  demoCompletedDate: z.string().optional().nullable(),
  wonDate: z.string().optional().nullable(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  userId: true,
  completedAt: true,
  createdAt: true,
}).extend({
  dueDate: z.string().optional().nullable(),
});

export const insertActivitySchema = createInsertSchema(activities).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export const insertDealActivitySchema = createInsertSchema(dealActivities).omit({
  id: true,
  createdBy: true,
  createdAt: true,
});

export type DealActivity = typeof dealActivities.$inferSelect;
export type InsertDealActivity = z.infer<typeof insertDealActivitySchema>;

export const insertEmailSequenceSchema = createInsertSchema(emailSequences).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Email body is required"),
  scheduledDate: z.string().optional().nullable(),
  scheduledTime: z.string().optional().nullable(),
  daysAfterNoReply: z.number().optional().nullable(),
});

export const insertEmailSequenceLogSchema = createInsertSchema(emailSequenceLogs).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export const insertInboxMessageSchema = createInsertSchema(inboxMessages).omit({
  id: true,
  userId: true,
  createdAt: true,
  receivedAt: true,
});

// SERP API Usage Tracking
export const serpUsage = pgTable("serp_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  monthYear: text("month_year").notNull().unique(), // Format: "2025-01"
  monthlyQuota: integer("monthly_quota").notNull().default(250),
  usedCredits: integer("used_credits").notNull().default(0),
  hardStopAt: integer("hard_stop_at").notNull().default(200), // 80% of quota
  lastResetDate: timestamp("last_reset_date").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// SERP Query Cache (30-day caching)
export const serpCache = pgTable("serp_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  zipCode: text("zip_code").notNull(),
  queryTemplate: text("query_template").notNull(), // e.g., "Dog Groomer in {STATE}, Zip code {ZIP}"
  state: text("state").notNull(),
  resultsJson: jsonb("results_json").notNull(), // Cached SERP results
  createdAt: timestamp("created_at").defaultNow(),
});

export const serpCallReservations = pgTable("serp_call_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Lead Discovery Config (per-user or global settings)
export const leadDiscoveryConfig = pgTable("lead_discovery_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  configKey: text("config_key").notNull().unique(), // e.g., "global" or userId
  queriesPerZip: integer("queries_per_zip").notNull().default(2), // 2 default, 3 with admin toggle
  maxZipsPerRun: integer("max_zips_per_run").notNull().default(3),
  maxRunsPerDay: integer("max_runs_per_day").notNull().default(1),
  maxSerpCallsPerHour: integer("max_serp_calls_per_hour").notNull().default(5),
  enableThirdQuery: text("enable_third_query").default("false"), // Admin toggle for 3rd query
  planType: text("plan_type").notNull().default("free"), // free, developer
  updatedAt: timestamp("updated_at").defaultNow(),
});

// National Search Jobs — orchestrate 50-state searches
export const nationalSearchJobs = pgTable("national_search_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, cancelled
  statesTotal: integer("states_total").notNull().default(50),
  statesCompleted: integer("states_completed").notNull().default(0),
  leadsFound: integer("leads_found").notNull().default(0),
  errorMessage: text("error_message"),
  // Targeted search fields — null means "all 50 states" (full national search)
  targetStates: text("target_states"), // comma-separated state codes, e.g. "MA,MI,MN" — null = all 50
  maxPerState: integer("max_per_state").notNull().default(3), // 1, 2, or 3 results per state
  noSoftwareOnly: text("no_software_only").notNull().default("false"), // "true" = skip leads where usesSoftware=Yes
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Lead Discovery Module
export const leadDiscoveryJobs = pgTable("lead_discovery_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  nationalJobId: varchar("national_job_id").references(() => nationalSearchJobs.id, { onDelete: "cascade" }),
  state: text("state").notNull(), // e.g., "NY", "CA"
  zipCodes: text("zip_codes").notNull(), // Comma-separated ZIP codes
  searchEngines: text("search_engines").notNull().default("google,bing"), // Comma-separated: google, bing, yahoo
  maxResultsPerZip: integer("max_results_per_zip").default(20),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, cancelled
  totalZipCodes: integer("total_zip_codes").default(0),
  processedZipCodes: integer("processed_zip_codes").default(0),
  totalBusinessesFound: integer("total_businesses_found").default(0),
  duplicatesRemoved: integer("duplicates_removed").default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const leadDiscoveryResults = pgTable("lead_discovery_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => leadDiscoveryJobs.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  // Core business info
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  company: text("company"),
  jobTitle: text("job_title"),
  // Software qualification
  usesSoftware: text("uses_software"), // Yes, No, Unknown
  currentSoftware: text("current_software"),
  bookingSoftwareUrl: text("booking_software_url"),
  // Website info
  hasWebsite: text("has_website"), // Yes, No, Unknown
  websiteUrl: text("website_url"),
  contactRequestFormUrl: text("contact_request_form_url"),
  // Source tracking
  leadSource: text("lead_source"), // Google Search, Bing Search, etc.
  notes: text("notes"),
  // Discovery metadata
  zipCode: text("zip_code"),
  searchQuery: text("search_query"),
  googleBusinessProfileUrl: text("google_business_profile_url"),
  isDuplicate: text("is_duplicate").default("false"), // true, false
  isImported: text("is_imported").default("false"), // true, false
  importedContactId: varchar("imported_contact_id"),
  crawlStatus: text("crawl_status").default("pending"), // pending, completed, failed
  crawlError: text("crawl_error"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Uploaded salon-list enrichment batches. Rows remain separate from lead discovery
// so fixed-list imports can be reviewed and resumed without changing legacy jobs.
export const salonEnrichmentBatches = pgTable("salon_enrichment_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  name: text("name").notNull(),
  fileName: text("file_name"),
  status: text("status").notNull().default("pending"), // pending, running, paused, completed, cancelled, failed
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  enrichedRows: integer("enriched_rows").notNull().default(0),
  needsReviewRows: integer("needs_review_rows").notNull().default(0),
  approvedRows: integer("approved_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  pilotLimit: integer("pilot_limit").notNull().default(100),
  concurrency: integer("concurrency").notNull().default(2),
  estimatedSerpCalls: integer("estimated_serp_calls").notNull().default(0),
  usedSerpCalls: integer("used_serp_calls").notNull().default(0),
  errorMessage: text("error_message"),
  researchProgress: jsonb("research_progress"),
  startedAt: timestamp("started_at"),
  pausedAt: timestamp("paused_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const salonEnrichmentRows = pgTable("salon_enrichment_rows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").notNull().references(() => salonEnrichmentBatches.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  sourceData: jsonb("source_data").notNull(),
  placeId: text("place_id"),
  businessName: text("business_name").notNull(),
  address: text("address"),
  address1: text("address_1"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  businessStatus: text("business_status"),
  websiteUrl: text("website_url"),
  email: text("email"),
  phone: text("phone"),
  contactRequestFormUrl: text("contact_request_form_url"),
  contactFormStatus: text("contact_form_status").notNull().default("unknown"), // unknown, candidate, verified, unusable
  bookingUrl: text("booking_url"),
  currentSoftware: text("current_software"),
  usesSoftware: text("uses_software").default("Unknown"),
  hasWebsite: text("has_website").default("Unknown"),
  audienceTrack: text("audience_track").default("directory_general"),
  evidence: jsonb("evidence").notNull().default(sql`'{}'::jsonb`),
  confidence: jsonb("confidence").notNull().default(sql`'{}'::jsonb`),
  identityMatchStatus: text("identity_match_status").default("pending"), // pending, strong, ambiguous, unmatched
  status: text("status").notNull().default("pending"), // pending, processing, enriched, failed, rejected, imported
  reviewStatus: text("review_status").notNull().default("pending"), // pending, needs_review, approved, rejected
  duplicateMetadata: jsonb("duplicate_metadata").notNull().default(sql`'{}'::jsonb`),
  importedContactId: varchar("imported_contact_id").references(() => contacts.id),
  serpCallsUsed: integer("serp_calls_used").notNull().default(0),
  lastError: text("last_error"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("salon_enrichment_rows_batch_row_unique").on(table.batchId, table.rowNumber),
  index("salon_enrichment_rows_batch_status_idx").on(table.batchId, table.status),
  index("salon_enrichment_rows_batch_review_idx").on(table.batchId, table.reviewStatus),
]);

export const insertSerpUsageSchema = createInsertSchema(serpUsage).omit({
  id: true,
  createdAt: true,
});

// Separate from email sequence logs: these are copyable drafts for manually
// submitted third-party forms, never an instruction to the email scheduler.
export const salonFormOutreach = pgTable("salon_form_outreach", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  salonRowId: varchar("salon_row_id").notNull().references(() => salonEnrichmentRows.id, { onDelete: "cascade" }).unique(),
  strategy: text("strategy").notNull(),
  sequenceTrack: text("sequence_track").notNull(),
  sequenceId: varchar("sequence_id").notNull().references(() => emailSequences.id),
  sequenceNumber: integer("sequence_number").notNull().default(1),
  formUrl: text("form_url").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("due"), // due, scheduled, blocked, skipped, replied, opted_out, completed
  dueAt: timestamp("due_at").notNull().defaultNow(),
  actedAt: timestamp("acted_at"),
  actedBy: varchar("acted_by").references(() => users.id, { onUpdate: "cascade" }),
  note: text("note"),
  submittedCount: integer("submitted_count").notNull().default(0),
  history: jsonb("history").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, table => [index("salon_form_outreach_user_due_idx").on(table.userId, table.dueAt)]);

export const insertSerpCacheSchema = createInsertSchema(serpCache).omit({
  id: true,
  createdAt: true,
});

export const insertLeadDiscoveryConfigSchema = createInsertSchema(leadDiscoveryConfig).omit({
  id: true,
  updatedAt: true,
});

export const insertNationalSearchJobSchema = createInsertSchema(nationalSearchJobs).omit({
  id: true,
  userId: true,
  createdAt: true,
  completedAt: true,
});

export const insertLeadDiscoveryJobSchema = createInsertSchema(leadDiscoveryJobs).omit({
  id: true,
  userId: true,
  nationalJobId: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
}).extend({
  state: z.string().min(1, "State is required"),
  zipCodes: z.string().min(1, "At least one ZIP code is required"),
});

export const insertLeadDiscoveryResultSchema = createInsertSchema(leadDiscoveryResults).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export const insertSalonEnrichmentBatchSchema = createInsertSchema(salonEnrichmentBatches).omit({
  id: true, userId: true, createdAt: true, updatedAt: true, startedAt: true,
  pausedAt: true, completedAt: true,
}).extend({
  name: z.string().min(1),
  pilotLimit: z.number().int().min(1).max(50000).optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
});

export const insertSalonEnrichmentRowSchema = createInsertSchema(salonEnrichmentRows).omit({
  id: true, createdAt: true, updatedAt: true,
}).extend({
  businessName: z.string().min(1),
  rowNumber: z.number().int().min(1),
  sourceData: z.record(z.unknown()),
});

export type ContactGroup = typeof contactGroups.$inferSelect;
export type InsertContactGroup = z.infer<typeof insertContactGroupSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Deal = typeof deals.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Activity = typeof activities.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type EmailSequence = typeof emailSequences.$inferSelect;
export type InsertEmailSequence = z.infer<typeof insertEmailSequenceSchema>;
export type EmailSequenceLog = typeof emailSequenceLogs.$inferSelect;
export type InsertEmailSequenceLog = z.infer<typeof insertEmailSequenceLogSchema>;
export type InboxMessage = typeof inboxMessages.$inferSelect;
export type InsertInboxMessage = z.infer<typeof insertInboxMessageSchema>;
export type NationalSearchJob = typeof nationalSearchJobs.$inferSelect;
export type InsertNationalSearchJob = z.infer<typeof insertNationalSearchJobSchema>;
export type LeadDiscoveryJob = typeof leadDiscoveryJobs.$inferSelect;
export type InsertLeadDiscoveryJob = z.infer<typeof insertLeadDiscoveryJobSchema>;
export type LeadDiscoveryResult = typeof leadDiscoveryResults.$inferSelect;
export type InsertLeadDiscoveryResult = z.infer<typeof insertLeadDiscoveryResultSchema>;
export type SalonEnrichmentBatch = typeof salonEnrichmentBatches.$inferSelect;
export type InsertSalonEnrichmentBatch = z.infer<typeof insertSalonEnrichmentBatchSchema>;
export type SalonEnrichmentRow = typeof salonEnrichmentRows.$inferSelect;
export type InsertSalonEnrichmentRow = z.infer<typeof insertSalonEnrichmentRowSchema>;
export type SalonFormOutreach = typeof salonFormOutreach.$inferSelect;
export type SerpUsage = typeof serpUsage.$inferSelect;
export type InsertSerpUsage = z.infer<typeof insertSerpUsageSchema>;
export type SerpCache = typeof serpCache.$inferSelect;
export type InsertSerpCache = z.infer<typeof insertSerpCacheSchema>;
export type LeadDiscoveryConfig = typeof leadDiscoveryConfig.$inferSelect;
export type InsertLeadDiscoveryConfig = z.infer<typeof insertLeadDiscoveryConfigSchema>;
// Commission records — created when a deal is confirmed as Won
export const commissions = pgTable("commissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dealId: varchar("deal_id").notNull().references(() => deals.id),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  planName: text("plan_name").notNull(),
  upfrontAmount: decimal("upfront_amount", { precision: 10, scale: 2 }).notNull(),
  monthlyAmount: decimal("monthly_amount", { precision: 10, scale: 2 }).notNull(),
  confirmedAt: timestamp("confirmed_at").defaultNow(),
});

export const insertCommissionSchema = createInsertSchema(commissions).omit({ id: true, confirmedAt: true });
export type Commission = typeof commissions.$inferSelect;
export type InsertCommission = z.infer<typeof insertCommissionSchema>;

// Monthly recurring commission payments — added every 30 days after the initial won date
export const commissionMonthlyPayments = pgTable("commission_monthly_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commissionId: varchar("commission_id").notNull().references(() => commissions.id),
  dealId: varchar("deal_id").notNull().references(() => deals.id),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  periodNumber: integer("period_number").notNull(),
  paidAt: timestamp("paid_at").notNull(),
});

export const insertCommissionMonthlyPaymentSchema = createInsertSchema(commissionMonthlyPayments).omit({ id: true });
export type CommissionMonthlyPayment = typeof commissionMonthlyPayments.$inferSelect;
export type InsertCommissionMonthlyPayment = z.infer<typeof insertCommissionMonthlyPaymentSchema>;

// Payroll periods — admin-created pay period reports sent to salespeople
export const payrollPeriods = pgTable("payroll_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  createdByAdminId: varchar("created_by_admin_id").references(() => users.id),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  totalAmount: text("total_amount").notNull().default("0"),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  sentAt: timestamp("sent_at"),
  sentToEmails: text("sent_to_emails"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPayrollPeriodSchema = createInsertSchema(payrollPeriods).omit({ id: true, createdAt: true });
export type InsertPayrollPeriod = z.infer<typeof insertPayrollPeriodSchema>;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;

// Payroll line items — individual earnings within a pay period
export const payrollLineItems = pgTable("payroll_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollPeriodId: varchar("payroll_period_id").notNull().references(() => payrollPeriods.id, { onDelete: "cascade" }),
  commissionId: varchar("commission_id").references(() => commissions.id),
  monthlyPaymentId: varchar("monthly_payment_id").references(() => commissionMonthlyPayments.id),
  type: text("type").notNull(),
  contactName: text("contact_name").notNull().default(""),
  dealTitle: text("deal_title").notNull(),
  planName: text("plan_name").notNull(),
  originalAmount: text("original_amount").notNull(),
  adjustedAmount: text("adjusted_amount").notNull(),
  date: timestamp("date").notNull(),
  notes: text("notes"),
});

export const insertPayrollLineItemSchema = createInsertSchema(payrollLineItems).omit({ id: true });
export type InsertPayrollLineItem = z.infer<typeof insertPayrollLineItemSchema>;
export type PayrollLineItem = typeof payrollLineItems.$inferSelect;

export type User = typeof users.$inferSelect;
export type UpsertUser = typeof users.$inferInsert;

// Emailed sign-in codes. Only a hash of the code is stored; each code works once
// and expires after 10 minutes (see server/auth.ts).
export const loginCodes = pgTable(
  "login_codes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    email: varchar("email").notNull(),
    codeHash: varchar("code_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("IDX_login_codes_email").on(table.email)],
);

export type LoginCode = typeof loginCodes.$inferSelect;

// TownGrid plans and add-ons, edited by an admin in Settings (see shared/dealPlans.ts).
export const dealPlans = pgTable("deal_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }),
  billing: text("billing").notNull().default("monthly"), // monthly, one_time, none
  kind: text("kind").notNull().default("plan"), // plan, add_on
  note: text("note"),
  active: text("active").notNull().default("true"),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Business Search (Step 3a). One row per search Seann runs (shared/businessSearch.ts).
export const businessSearches = pgTable("business_searches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  businessType: text("business_type").notNull(), // BUSINESS_TYPES value or "other"
  businessTypeOther: text("business_type_other"),
  leadList: text("lead_list").notNull(), // get_seen, ordering
  places: jsonb("places").notNull().$type<string[]>(), // zip codes or town names
  pagesPerPlace: integer("pages_per_place").notNull().default(1),
  status: text("status").notNull().default("queued"), // queued, running, done, stopped, failed
  estimate: jsonb("estimate"), // CreditEstimate shown before it ran
  creditsUsed: integer("credits_used").notNull().default(0), // SerpAPI calls billed by this search
  cachedCalls: integer("cached_calls").notNull().default(0), // answered from the 30-day cache (free)
  businessesFound: integer("businesses_found").notNull().default(0),
  businessesChecked: integer("businesses_checked").notNull().default(0),
  outsideArea: integer("outside_area").notNull().default(0),
  duplicatesRemoved: integer("duplicates_removed").notNull().default(0),
  alreadyFound: integer("already_found").notNull().default(0), // found in an earlier search: skipped, 0 credits
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
}, table => [index("business_searches_user_idx").on(table.userId, table.createdAt)]);

// One row per business a search found, with its Pass 1 findings and lead type.
export const businessLeads = pgTable("business_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  searchId: varchar("search_id").notNull().references(() => businessSearches.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  town: text("town"),
  zip: text("zip"),
  phone: text("phone"),
  rating: real("rating"),
  reviewCount: integer("review_count"),
  googleCategory: text("google_category"),
  googleUrl: text("google_url"),
  googlePlaceId: text("google_place_id"),
  googleDataId: text("google_data_id"), // needed by Pass 2 (reviews, posts, photos)
  websiteUrl: text("website_url"),
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  deliveryApps: text("delivery_apps"), // "DoorDash, Grubhub" (labels)
  ownOrdering: text("own_ordering"), // yes, no, unknown, no_website
  sendsToApps: text("sends_to_apps"), // yes, no, unknown, no_website
  stillOpenFlag: boolean("still_open_flag").notNull().default(false),
  googleStatus: text("google_status"), // open, permanently_closed, temporarily_closed, unknown
  leadList: text("lead_list").notNull(),
  leadType: text("lead_type"),
  industryGroup: text("industry_group"), // from the search type (shared/industries.ts)
  industryType: text("industry_type"),
  checkStatus: text("check_status").notNull().default("pending"), // pending, checked, failed
  checkError: text("check_error"),
  findings: jsonb("findings"), // website, social, ordering, stillOpen details (shared/businessSearch.ts)
  mapsResult: jsonb("maps_result"), // the Google Maps result as SerpAPI returned it
  // Seann's hand check of social accounts (never read from code)
  handChecked: boolean("hand_checked").notNull().default(false),
  facebookFollowers: integer("facebook_followers"),
  instagramFollowers: integer("instagram_followers"),
  lastPostDate: text("last_post_date"),
  handCheckNotes: text("hand_check_notes"),
  // Approval into Contacts and Pipeline
  // Opportunity score (Step 3b, shared/leadScore.ts). Null score = set aside (knock-out).
  score: integer("score"),
  tier: text("tier"), // A, B, C
  scoreReasons: jsonb("score_reasons"), // [{ key, points, text }]
  setAsideReason: text("set_aside_reason"), // closed, chain, or Seann's own reason
  setAsideByHand: boolean("set_aside_by_hand").notNull().default(false),
  approvedAt: timestamp("approved_at"),
  contactId: varchar("contact_id"),
  dealId: varchar("deal_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  checkedAt: timestamp("checked_at"),
}, table => [
  index("business_leads_search_idx").on(table.searchId),
  index("business_leads_user_idx").on(table.userId),
]);

export type BusinessSearch = typeof businessSearches.$inferSelect;
export type BusinessLead = typeof businessLeads.$inferSelect;

// Opportunity score point values edited by an admin (Settings). Missing keys use the
// starting values in shared/leadScore.ts.
export const scorePoints = pgTable("score_points", {
  key: text("key").primaryKey(),
  points: integer("points").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Industry list (Snap spec Part 2), edited by an admin in Settings next to Plans & prices.
export const industries = pgTable("industries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupName: text("group_name").notNull(),
  typeName: text("type_name").notNull(),
  searchType: text("search_type"), // matching Business Search type, if any
  sortOrder: integer("sort_order").notNull().default(0),
  active: text("active").notNull().default("true"),
});
