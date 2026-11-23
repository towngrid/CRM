// From Replit Auth and Database blueprints
import { CONTACT_OWNER_LOOKUP_PURPOSE, contactOwnerLookupIdentity, contactOwnerLookupMatches } from "@shared/contactOwnerLookup";
import { 
  type Contact, 
  type InsertContact,
  type ContactGroup,
  type InsertContactGroup,
  type Deal, 
  type InsertDeal, 
  type Task, 
  type InsertTask, 
  type Activity, 
  type InsertActivity,
  type DealActivity,
  type InsertDealActivity,
  type User,
  type UpsertUser,
  type EmailSequence,
  type InsertEmailSequence,
  type EmailSequenceLog,
  type InsertEmailSequenceLog,
  type DealTask,
  type InsertDealTask,
  type InboxMessage,
  type InsertInboxMessage,
  type NationalSearchJob,
  type LeadDiscoveryJob,
  type InsertLeadDiscoveryJob,
  type LeadDiscoveryResult,
  type InsertLeadDiscoveryResult,
  type SerpUsage,
  type SerpCache,
  type LeadDiscoveryConfig,
  type SalonEnrichmentBatch,
  type InsertSalonEnrichmentBatch,
  type SalonEnrichmentRow,
  type InsertSalonEnrichmentRow,
  type Commission,
  type InsertCommission,
  type CommissionMonthlyPayment,
  type InsertCommissionMonthlyPayment,
  type PayrollPeriod,
  type InsertPayrollPeriod,
  type PayrollLineItem,
  type InsertPayrollLineItem,
  users,
  contacts,
  contactGroups,
  deals,
  tasks,
  activities,
  dealActivities,
  emailSequences,
  emailSequenceLogs,
  inboxMessages,
  nationalSearchJobs,
  leadDiscoveryJobs,
  leadDiscoveryResults,
  serpUsage,
  serpCache,
  serpCallReservations,
  leadDiscoveryConfig,
  salonEnrichmentBatches,
  salonEnrichmentRows,
  dealTasks,
  commissions,
  commissionMonthlyPayments,
  payrollPeriods,
  payrollLineItems,
} from "@shared/schema";
import { normalizePhoneNumber, normalizeName, normalizeEmail } from "@shared/utils";
import { db } from "./db";
import { reserveRecipientLog } from "./recipientOutreach";
import type { RecipientEnrollmentOptions } from "./recipientPolicy";
import { eq, desc, and, sql, gte, lte, lt, or, ne, inArray, isNull } from "drizzle-orm";
import { savedSerpBudget } from "@shared/serpBudget";
import { importableSalonEmail } from "./bookingPageEmail";
import { salonReportSendRejection } from "./salonSearchReport";
import { directoryEligibility } from "@shared/directoryEligibility";
import { isRetryableStagedSalonRow } from "./salonListStaging";
import { salonCrmDuplicates } from "./salonCrmDuplicates";
import { deleteContactSafely } from "./contactDeletion";
import { createDealRecord } from "./dealCreation";
import { deleteSalonReviewRowSafely } from "./salonReviewDeletion";
import { loadPipelineEmailSummaries } from "./pipelineEmailSummary";
import type { PipelineEmailSummaries } from "@shared/pipelineEmailSummary";
import {
  EMPTY_OWNER_NAME_RESULT,
  hasStrongOwnerNameEvidence,
  isStrongApprovedOwnerCandidate,
  salonOwnerNameForImport,
  type OwnerNameResult,
} from "@shared/salonOwnerName";
import {
  contactHasManualName,
  contactNameMatchesOwnerApplication,
  mergeBundledOwnerNameEvidence,
  mergeSalonOwnerNameMetadata,
  ownerNameLookupStarted,
  resetSalonOwnerNameForIdentityChange,
  salonIdentityEditBlocked,
  salonIdentityFieldsChanged,
  salonOwnerNameLookupBlockedByRowStatus,
  salonOwnerNameImportBlocked,
  salonOwnerNameMutationBlocked,
  shouldStageBundledOwnerNameOnRow,
  type SalonOwnerNameContactApplication,
} from "./salonOwnerNameMutationPolicy";

export type SalonOwnerNameMutationResult = {
  row?: SalonEnrichmentRow;
  contact?: Contact;
  error?: { status: 404 | 409; message: string };
};

export type SalonOwnerNameReviewInput = {
  candidateId: string;
  decision: "approved" | "rejected";
  usePersonalName: boolean;
};

export type SalonOwnerNameApplyInput = {
  overwriteExisting: boolean;
  usePersonalName: boolean;
};

export class SalonOwnerNameStorageConflict extends Error {
  status = 409;
}

function salonRowEvidence(row: SalonEnrichmentRow): Record<string, unknown> {
  return row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
    ? row.evidence as Record<string, unknown>
    : {};
}

function ownerNameFromRow(row: SalonEnrichmentRow): OwnerNameResult {
  const value = salonRowEvidence(row).ownerName as Partial<OwnerNameResult> | undefined;
  return value && typeof value === "object"
    ? {
      ...EMPTY_OWNER_NAME_RESULT,
      ...value,
      candidates: Array.isArray(value.candidates) ? value.candidates : [],
    }
    : { ...EMPTY_OWNER_NAME_RESULT };
}

function parseContactNotes(contact: Contact): Record<string, unknown> {
  try {
    const parsed = contact.notes ? JSON.parse(contact.notes) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { legacyNotes: contact.notes };
  } catch {
    return { legacyNotes: contact.notes };
  }
}

async function revokeOwnerNameContactInTransaction(
  tx: any,
  row: SalonEnrichmentRow,
  ownerName: OwnerNameResult,
  contact: Contact | undefined,
): Promise<Contact | undefined> {
  if (!contact || !row.importedContactId) return contact;
  const notes = parseContactNotes(contact);
  const applied = notes.salonOwnerNameApplication as SalonOwnerNameContactApplication | undefined;
  if (!applied || applied.rowId !== row.id) return contact;
  const provenanceMatches = contactNameMatchesOwnerApplication(
    contact,
    applied,
    row.id,
    ownerName.selectedCandidateId,
  );
  delete notes.salonOwnerNameApplication;
  const [updated] = await tx.update(contacts).set({
    ...(provenanceMatches ? {
      firstName: null,
      lastName: null,
      useBusinessNameForEmail: "Yes",
    } : {}),
    notes: JSON.stringify(notes),
  }).where(and(eq(contacts.id, contact.id), eq(contacts.userId, row.userId))).returning();
  return updated || contact;
}

export type PayrollPreviewItem = {
  tempId: string;
  commissionId: string | null;
  monthlyPaymentId: string | null;
  type: "upfront" | "recurring";
  date: string;
  contactName: string;
  dealTitle: string;
  planName: string;
  originalAmount: string;
};

export type PayrollLineItemInput = {
  commissionId?: string | null;
  monthlyPaymentId?: string | null;
  type: string;
  contactName: string;
  dealTitle: string;
  planName: string;
  originalAmount: string;
  adjustedAmount: string;
  date: Date;
  notes?: string | null;
};

export type PayrollPeriodFull = PayrollPeriod & {
  items: PayrollLineItem[];
  salespersonName: string;
  salespersonEmail: string;
};

export interface IStorage {
  // User operations - From Replit Auth blueprint
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  createUser(userData: { email: string; firstName?: string; lastName?: string; phone?: string; workEmail?: string; replyToEmail?: string; role?: string }): Promise<User>;
  updateUserProfile(id: string, profile: Partial<Pick<User, 'workEmail' | 'replyToEmail' | 'firstName' | 'lastName' | 'phone'>>): Promise<User | undefined>;
  updateUserAdmin(id: string, userData: { email?: string; firstName?: string; lastName?: string; phone?: string; workEmail?: string; replyToEmail?: string; role?: string }): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  forceDeleteUser(id: string): Promise<boolean>;

  // Commissions
  createCommission(data: InsertCommission): Promise<Commission>;
  getCommissions(userId: string | null): Promise<Commission[]>;
  // Payroll
  previewPayroll(userId: string, startDate: Date, endDate: Date): Promise<PayrollPreviewItem[]>;
  createPayrollPeriod(data: Omit<InsertPayrollPeriod, "totalAmount">, lineItems: PayrollLineItemInput[]): Promise<{ period: PayrollPeriod; items: PayrollLineItem[] }>;
  getPayrollPeriods(userId: string | null): Promise<PayrollPeriodFull[]>;
  getPayrollPeriod(id: string): Promise<PayrollPeriodFull | null>;
  updatePayrollLineItem(id: string, adjustedAmount: string, notes?: string): Promise<PayrollLineItem>;
  updatePayrollPeriod(id: string, data: Partial<Pick<PayrollPeriod, "status" | "notes" | "sentAt" | "sentToEmails" | "totalAmount">>): Promise<PayrollPeriod>;
  createMonthlyPayment(data: InsertCommissionMonthlyPayment): Promise<CommissionMonthlyPayment>;
  getMonthlyPaymentsForCommission(commissionId: string): Promise<CommissionMonthlyPayment[]>;
  getMonthlyPayments(userId: string | null): Promise<CommissionMonthlyPayment[]>;

  // Deal Tasks
  getDealTasks(dealId: string): Promise<DealTask[]>;
  getDealTask(id: string): Promise<DealTask | undefined>;
  createDealTask(task: Omit<InsertDealTask, 'dueDate' | 'reminderDatetime'> & { dueDate?: Date | null; reminderDatetime?: Date | null }): Promise<DealTask>;
  updateDealTask(id: string, updates: Partial<DealTask>): Promise<DealTask | undefined>;
  deleteDealTask(id: string): Promise<boolean>;
  getPendingReminderTasks(): Promise<(DealTask & { dealTitle: string; contactFirstName: string | null; contactLastName: string | null; contactPhone: string | null; assignedUserFirstName: string | null; assignedUserLastName: string | null; })[]>;

  // Contact Groups (userId can be null for admins to get all data)
  getContactGroups(userId: string | null): Promise<ContactGroup[]>;
  getContactGroup(id: string, userId: string | null): Promise<ContactGroup | undefined>;
  createContactGroup(group: InsertContactGroup, userId: string): Promise<ContactGroup>;
  updateContactGroup(id: string, group: Partial<InsertContactGroup>, userId: string | null): Promise<ContactGroup | undefined>;
  deleteContactGroup(id: string, userId: string | null): Promise<boolean>;
  
  // Contacts (userId can be null for admins to get all data)
  getContacts(userId: string | null, showArchived?: boolean): Promise<Contact[]>;
  getContact(id: string, userId: string | null): Promise<Contact | undefined>;
  createContact(contact: InsertContact, userId: string): Promise<Contact>;
  bulkCreateContacts(contacts: Array<{ row: number, data: InsertContact }>, userId: string): Promise<{ successful: Contact[], failed: Array<{ row: number, error: string, data: any }> }>;
  updateContact(id: string, contact: Partial<InsertContact>, userId: string | null): Promise<Contact | undefined>;
  assignContact(id: string, newUserId: string): Promise<Contact | undefined>;
  archiveContact(id: string, userId: string | null): Promise<Contact | undefined>;
  unarchiveContact(id: string, userId: string | null): Promise<Contact | undefined>;
  deleteContact(id: string, userId: string | null): Promise<boolean>;
  deleteSalonSearchReportRow(id: string, userId: string): Promise<boolean>;
  searchContacts(query: string, userId: string | null): Promise<Contact[]>;
  findDuplicateContacts(contact: InsertContact, userId: string, excludeId?: string): Promise<Contact[]>;

  // Deals (userId can be null for admins to get all data)
  getDeals(userId: string | null): Promise<Deal[]>;
  getDeal(id: string, userId: string | null): Promise<Deal | undefined>;
  createDeal(deal: InsertDeal, userId: string): Promise<Deal>;
  updateDeal(id: string, deal: Partial<InsertDeal>, userId: string | null): Promise<Deal | undefined>;
  deleteDeal(id: string, userId: string | null): Promise<boolean>;
  getDealsByStage(stage: string, userId: string | null): Promise<Deal[]>;
  getPipelineEmailSummaries(userId: string | null, stage?: string): Promise<PipelineEmailSummaries>;

  // Tasks (userId can be null for admins to get all data)
  getTasks(userId: string | null): Promise<Task[]>;
  getTask(id: string, userId: string | null): Promise<Task | undefined>;
  createTask(task: InsertTask, userId: string): Promise<Task>;
  updateTask(id: string, task: Partial<InsertTask>, userId: string | null): Promise<Task | undefined>;
  deleteTask(id: string, userId: string | null): Promise<boolean>;
  getTasksByStatus(status: string, userId: string | null): Promise<Task[]>;
  getTasksByDealId(dealId: string, userId: string | null): Promise<Task[]>;
  getUpcomingTasks(userId: string | null): Promise<Task[]>;
  getDealActivities(dealId: string, userId: string | null): Promise<DealActivity[]>;
  createDealActivity(activity: InsertDealActivity, createdBy: string): Promise<DealActivity>;

  // Activities (userId can be null for admins to get all data)
  getActivities(userId: string | null): Promise<Activity[]>;
  createActivity(activity: InsertActivity, userId: string): Promise<Activity>;
  getRecentActivities(limit: number, userId: string | null): Promise<Activity[]>;

  // Email Sequences (userId can be null for admins to get all data)
  getEmailSequences(userId: string | null): Promise<EmailSequence[]>;
  getEmailSequencesByTrack(userId: string | null, track: string): Promise<EmailSequence[]>;
  getEmailSequence(id: string, userId: string | null): Promise<EmailSequence | undefined>;
  createEmailSequence(sequence: InsertEmailSequence, userId: string): Promise<EmailSequence>;
  updateEmailSequence(id: string, sequence: Partial<InsertEmailSequence>, userId: string | null): Promise<EmailSequence | undefined>;
  deleteEmailSequence(id: string, userId: string | null): Promise<boolean>;
  
  // Email Sequence Logs
  getEmailSequenceLogs(userId: string | null, contactId?: string): Promise<EmailSequenceLog[]>;
  getEmailSequenceLogById(id: string, userId: string | null): Promise<EmailSequenceLog | undefined>;
  createEmailSequenceLog(log: InsertEmailSequenceLog, userId: string, expectedRecipient?: string, options?: RecipientEnrollmentOptions): Promise<EmailSequenceLog>;
  bulkCreateEmailSequenceLogs(sequenceId: string, contactIds: string[], userId: string | null, scheduledSendAt?: Date | null, customSubject?: string, customBody?: string, expectedRecipients?: Record<string,string>, options?: RecipientEnrollmentOptions): Promise<{ successful: EmailSequenceLog[], failed: Array<{ contactId: string, error: string }> }>;
  updateEmailSequenceLog(id: string, log: Partial<InsertEmailSequenceLog>, userId: string | null): Promise<EmailSequenceLog | undefined>;
  deleteEmailSequenceLog(id: string, userId: string | null): Promise<boolean>;
  
  // Inbox Messages (userId can be null for admins to get all data)
  getInboxMessages(userId: string | null, contactId?: string): Promise<InboxMessage[]>;
  getInboxMessage(id: string, userId: string | null): Promise<InboxMessage | undefined>;
  createInboxMessage(message: InsertInboxMessage, userId: string): Promise<InboxMessage>;
  updateInboxMessage(id: string, message: Partial<InsertInboxMessage>, userId: string | null): Promise<InboxMessage | undefined>;
  deleteInboxMessage(id: string, userId: string | null): Promise<boolean>;
  getUnreadCount(userId: string | null): Promise<number>;
  getDealsWithUnreadReplies(userId: string | null): Promise<string[]>;
  markRepliesReadForDeal(dealId: string, userId: string | null): Promise<void>;

  // National Search Jobs
  createNationalSearchJob(userId: string, opts?: { targetStates?: string[]; maxPerState?: number; noSoftwareOnly?: boolean }): Promise<NationalSearchJob | null>;
  getNationalSearchJob(id: string, userId: string | null): Promise<NationalSearchJob | undefined>;
  getNationalSearchJobs(userId: string | null): Promise<NationalSearchJob[]>;
  updateNationalSearchJob(id: string, updates: Partial<NationalSearchJob>): Promise<NationalSearchJob | undefined>;
  /** Same as updateNationalSearchJob but silently skips the write if the current status is 'cancelled'. */
  updateNationalSearchJobIfNotCancelled(id: string, updates: Partial<NationalSearchJob>): Promise<NationalSearchJob | undefined>;
  getActiveNationalSearchJob(userId: string): Promise<NationalSearchJob | undefined>;
  getNationalJobResults(nationalJobId: string, userId: string | null): Promise<Array<LeadDiscoveryResult & { state: string }>>;

  // Lead Discovery
  getLeadDiscoveryJobs(userId: string | null): Promise<LeadDiscoveryJob[]>;
  getLeadDiscoveryJob(id: string, userId: string | null): Promise<LeadDiscoveryJob | undefined>;
  createLeadDiscoveryJob(job: InsertLeadDiscoveryJob, userId: string, nationalJobId?: string): Promise<LeadDiscoveryJob>;
  updateLeadDiscoveryJob(id: string, job: Partial<LeadDiscoveryJob>, userId: string | null): Promise<LeadDiscoveryJob | undefined>;
  deleteLeadDiscoveryJob(id: string, userId: string | null): Promise<boolean>;
  getLeadDiscoveryResults(jobId: string, userId: string | null): Promise<LeadDiscoveryResult[]>;
  getAllLeadDiscoveryResults(userId: string | null): Promise<LeadDiscoveryResult[]>;
  getLeadDiscoveryResultById(id: string): Promise<LeadDiscoveryResult | undefined>;
  deleteLeadDiscoveryResult(id: string, userId: string | null): Promise<boolean>;
  createLeadDiscoveryResult(result: InsertLeadDiscoveryResult, userId: string): Promise<LeadDiscoveryResult>;
  bulkCreateLeadDiscoveryResults(results: InsertLeadDiscoveryResult[], userId: string): Promise<LeadDiscoveryResult[]>;
  updateLeadDiscoveryResult(id: string, result: Partial<LeadDiscoveryResult>, userId: string | null): Promise<LeadDiscoveryResult | undefined>;
  markResultsAsImported(resultIds: string[], contactIds: string[], userId: string | null): Promise<void>;

  // Uploaded salon enrichment
  getSalonEnrichmentBatches(userId: string | null): Promise<SalonEnrichmentBatch[]>;
  getContactOwnerNameRow(contactId: string, userId: string): Promise<SalonEnrichmentRow | undefined>;
  ensureContactOwnerNameRow(contactId: string, userId: string): Promise<SalonEnrichmentRow | undefined>;
  getSalonEnrichmentBatch(id: string, userId: string | null): Promise<SalonEnrichmentBatch | undefined>;
  prepareSalonReportBatchForVerification(id: string, userId: string, callsPerRow: number, retryUnverified?: boolean, expectedEligibleRows?: number): Promise<{
    batch: SalonEnrichmentBatch;
    eligibleRows: number;
    estimatedSerpCalls: number;
  } | null>;
  createSalonEnrichmentBatch(data: InsertSalonEnrichmentBatch, rows: InsertSalonEnrichmentRow[], userId: string): Promise<SalonEnrichmentBatch>;
  createSalonSearchReportBatch(data: InsertSalonEnrichmentBatch, rows: InsertSalonEnrichmentRow[], userId: string, allowExisting: boolean, deduplicateBusinessPhone?: boolean): Promise<{
    batch: SalonEnrichmentBatch | null;
    existingBatches: SalonEnrichmentBatch[];
    duplicatePlaceIds: string[];
    duplicateNaturalKeys: string[];
    existing: boolean;
  }>;
  updateSalonEnrichmentBatch(id: string, data: Partial<SalonEnrichmentBatch>, userId: string | null): Promise<SalonEnrichmentBatch | undefined>;
  getSalonEnrichmentRows(batchId: string, userId: string | null, filters?: { status?: string; reviewStatus?: string; search?: string; limit?: number; offset?: number }): Promise<SalonEnrichmentRow[]>;
  getSalonEnrichmentRow(id: string, userId: string | null): Promise<SalonEnrichmentRow | undefined>;
  seedSalonReportOwnerNames(seeds: Record<string, OwnerNameResult>, userId: string): Promise<number>;
  beginSalonOwnerNameLookup(rowId: string, userId: string, lookupToken: string): Promise<SalonEnrichmentRow | undefined>;
  completeSalonOwnerNameLookup(rowId: string, userId: string, lookupToken: string, ownerName: OwnerNameResult): Promise<boolean>;
  reviewSalonOwnerName(rowId: string, userId: string, input: SalonOwnerNameReviewInput): Promise<SalonOwnerNameMutationResult>;
  applySalonOwnerName(rowId: string, userId: string, input: SalonOwnerNameApplyInput): Promise<SalonOwnerNameMutationResult>;
  revokeSalonOwnerName(rowId: string, userId: string): Promise<SalonOwnerNameMutationResult>;
  getSalonSearchReportLinks(contactIds: string[], userId: string): Promise<Record<string, { dealId: string | null; dealStage: string | null; sequenceStatus: string | null }>>;
  getSalonReportSendRejection(contactId: string, ownerId: string, contactOwnerId: string, contactEmail: string | null): Promise<string | null>;
  updateSalonEnrichmentRow(
    id: string,
    data: Partial<SalonEnrichmentRow>,
    userId: string | null,
    options?: { rejectIdentityDuringEnrichment?: boolean },
  ): Promise<SalonEnrichmentRow | undefined>;
  markSalonRowsForReview(ids: string[], decision: "approved" | "rejected", userId: string | null): Promise<number>;
  resetSalonRowsForRetry(ids: string[], userId: string | null): Promise<number>;
  importApprovedSalonRows(batchId: string, rowIds: string[] | undefined, userId: string | null): Promise<{ imported: SalonEnrichmentRow[]; skipped: Array<{ rowId: string; reason: string }> }>;
  refreshSalonEnrichmentBatchCounts(batchId: string, userId: string | null): Promise<SalonEnrichmentBatch | undefined>;
  
  // SERP Usage Tracking
  getSerpUsage(monthYear: string): Promise<SerpUsage | undefined>;
  getOrCreateSerpUsage(monthYear: string): Promise<SerpUsage>;
  incrementSerpUsage(monthYear: string): Promise<SerpUsage>;
  reserveSerpCall(monthYear: string, maxCallsPerHour: number): Promise<string | null>;
  getNextSerpCallAt(maxCallsPerHour: number): Promise<string>;
  releaseSerpCall(reservationId: string, monthYear: string): Promise<void>;
  updateSerpQuota(monthYear: string, quota: number, hardStopAt: number): Promise<SerpUsage | undefined>;
  
  // SERP Cache
  getSerpCache(zipCode: string, queryTemplate: string, state: string, maxAgeDays?: number): Promise<SerpCache | undefined>;
  createSerpCache(zipCode: string, queryTemplate: string, state: string, results: any): Promise<SerpCache>;
  clearOldSerpCache(maxAgeDays: number): Promise<number>;
  
  // Lead Discovery Config
  getLeadDiscoveryConfig(configKey: string): Promise<LeadDiscoveryConfig | undefined>;
  getOrCreateLeadDiscoveryConfig(configKey: string): Promise<LeadDiscoveryConfig>;
  updateLeadDiscoveryConfig(configKey: string, updates: Partial<LeadDiscoveryConfig>): Promise<LeadDiscoveryConfig | undefined>;
  getRunsToday(userId: string): Promise<number>;
  getSerpCallsInLastHour(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  // User operations - From Replit Auth blueprint
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    if (userData.email) {
      const existingByEmail = await this.getUserByEmail(userData.email);
      if (existingByEmail && existingByEmail.id !== userData.id) {
        // Manual user exists with different ID - need to migrate to auth ID
        // Use raw SQL to update PK since ON UPDATE CASCADE is in place
        const oldId = existingByEmail.id;
        const newId = userData.id!;
        
        // Update user ID - foreign keys will cascade automatically due to ON UPDATE CASCADE
        await db.execute(sql`
          UPDATE users 
          SET id = ${newId},
              first_name = COALESCE(${userData.firstName ?? null}, first_name),
              last_name = COALESCE(${userData.lastName ?? null}, last_name),
              profile_image_url = COALESCE(${userData.profileImageUrl ?? null}, profile_image_url),
              updated_at = NOW()
          WHERE id = ${oldId}
        `);
        
        // Fetch and return the updated user
        const [updatedUser] = await db.select().from(users).where(eq(users.id, newId));
        return updatedUser;
      }
    }
    
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async createUser(userData: { email: string; firstName?: string; lastName?: string; phone?: string; workEmail?: string; replyToEmail?: string; role?: string }): Promise<User> {
    const id = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [user] = await db
      .insert(users)
      .values({
        id,
        email: userData.email,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        phone: userData.phone || null,
        workEmail: userData.workEmail || null,
        replyToEmail: userData.replyToEmail || null,
        role: userData.role || "salesperson",
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async updateUserProfile(id: string, profile: Partial<Pick<User, 'workEmail' | 'replyToEmail' | 'firstName' | 'lastName' | 'phone'>>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        ...profile,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserAdmin(id: string, userData: { email?: string; firstName?: string; lastName?: string; phone?: string; workEmail?: string; replyToEmail?: string; role?: string }): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        ...userData,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async forceDeleteUser(id: string): Promise<boolean> {
    // Step 1: Collect all IDs owned by this user so we can clean up cross-user FK references
    const ownedContacts = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, id));
    const contactIds = ownedContacts.map((c) => c.id);

    const ownedDeals = await db.select({ id: deals.id }).from(deals).where(eq(deals.userId, id));
    const dealIds = ownedDeals.map((d) => d.id);

    const ownedTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, id));
    const taskIds = ownedTasks.map((t) => t.id);

    const ownedSequences = await db.select({ id: emailSequences.id }).from(emailSequences).where(eq(emailSequences.userId, id));
    const sequenceIds = ownedSequences.map((s) => s.id);

    // Step 2: deal_activities — references deals, contacts, createdBy (users)
    if (dealIds.length > 0) await db.delete(dealActivities).where(inArray(dealActivities.dealId, dealIds));
    if (contactIds.length > 0) await db.delete(dealActivities).where(inArray(dealActivities.contactId, contactIds));
    await db.delete(dealActivities).where(eq(dealActivities.createdBy, id));

    // Step 3: inbox_messages — references users and contacts
    //         Must come before email_sequence_logs (inboxMessages.emailSequenceLogId → emailSequenceLogs.id)
    await db.delete(inboxMessages).where(eq(inboxMessages.userId, id));
    if (contactIds.length > 0) await db.delete(inboxMessages).where(inArray(inboxMessages.contactId, contactIds));

    // Step 4: email_sequence_logs — references users, contacts, emailSequences
    await db.delete(emailSequenceLogs).where(eq(emailSequenceLogs.userId, id));
    if (contactIds.length > 0) await db.delete(emailSequenceLogs).where(inArray(emailSequenceLogs.contactId, contactIds));
    if (sequenceIds.length > 0) await db.delete(emailSequenceLogs).where(inArray(emailSequenceLogs.sequenceId, sequenceIds));

    // Step 5: email_sequences — references users
    await db.delete(emailSequences).where(eq(emailSequences.userId, id));

    // Step 6: lead discovery — references users (results cascade from jobs)
    await db.delete(leadDiscoveryResults).where(eq(leadDiscoveryResults.userId, id));
    await db.delete(leadDiscoveryJobs).where(eq(leadDiscoveryJobs.userId, id));

    // Step 6b: uploaded salon enrichment (rows reference both users and contacts)
    await db.delete(salonEnrichmentRows).where(eq(salonEnrichmentRows.userId, id));
    await db.delete(salonEnrichmentBatches).where(eq(salonEnrichmentBatches.userId, id));

    // Step 7: activities — references users, contacts, deals, AND tasks
    //         Must be deleted BEFORE tasks (activities.taskId → tasks.id)
    await db.delete(activities).where(eq(activities.userId, id));
    if (contactIds.length > 0) await db.delete(activities).where(inArray(activities.contactId, contactIds));
    if (dealIds.length > 0) await db.delete(activities).where(inArray(activities.dealId, dealIds));
    if (taskIds.length > 0) await db.delete(activities).where(inArray(activities.taskId, taskIds));

    // Step 8: tasks — references users, contacts, deals
    await db.delete(tasks).where(eq(tasks.userId, id));
    if (contactIds.length > 0) await db.delete(tasks).where(inArray(tasks.contactId, contactIds));
    if (dealIds.length > 0) await db.delete(tasks).where(inArray(tasks.dealId, dealIds));

    // Step 9: deals — references users and contacts (other users' deals may reference this user's contacts)
    if (contactIds.length > 0) await db.delete(deals).where(inArray(deals.contactId, contactIds));
    await db.delete(deals).where(eq(deals.userId, id));

    // Step 10: contacts — references users and contactGroups
    await db.delete(contacts).where(eq(contacts.userId, id));

    // Step 11: contactGroups — references users
    await db.delete(contactGroups).where(eq(contactGroups.userId, id));

    // Step 12: delete the user
    const result = await db.delete(users).where(eq(users.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Contact Groups
  async getContactGroups(userId: string | null): Promise<ContactGroup[]> {
    if (userId === null) {
      // Admin: get all groups
      return await db.select().from(contactGroups);
    }
    return await db.select().from(contactGroups).where(eq(contactGroups.userId, userId));
  }

  async getContactGroup(id: string, userId: string | null): Promise<ContactGroup | undefined> {
    if (userId === null) {
      // Admin: get any group by ID
      const [group] = await db.select().from(contactGroups).where(eq(contactGroups.id, id));
      return group;
    }
    const [group] = await db.select().from(contactGroups)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, userId)));
    return group;
  }

  async createContactGroup(insertGroup: InsertContactGroup, userId: string): Promise<ContactGroup> {
    const [group] = await db
      .insert(contactGroups)
      .values({ ...insertGroup, userId })
      .returning();
    return group;
  }

  async updateContactGroup(id: string, updateData: Partial<InsertContactGroup>, userId: string | null): Promise<ContactGroup | undefined> {
    if (userId === null) {
      // Admin: update any group
      const [updated] = await db
        .update(contactGroups)
        .set(updateData)
        .where(eq(contactGroups.id, id))
        .returning();
      return updated;
    }
    const [updated] = await db
      .update(contactGroups)
      .set(updateData)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, userId)))
      .returning();
    return updated;
  }

  async deleteContactGroup(id: string, userId: string | null): Promise<boolean> {
    if (userId === null) {
      // Admin: clear groupId for all contacts in this group, then delete group
      await db.update(contacts)
        .set({ groupId: null })
        .where(eq(contacts.groupId, id));
      
      const result = await db.delete(contactGroups).where(eq(contactGroups.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
    
    // Salesperson: verify ownership first, then clear groupId only for user's contacts, then delete
    const [group] = await db.select().from(contactGroups)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, userId)));
    
    if (!group) {
      return false; // Group not found or user doesn't own it
    }
    
    // Only clear groupId for contacts owned by this user
    await db.update(contacts)
      .set({ groupId: null })
      .where(and(eq(contacts.groupId, id), eq(contacts.userId, userId)));
    
    const result = await db.delete(contactGroups)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, userId)));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Contacts
  async getContacts(userId: string | null, showArchived = false): Promise<Contact[]> {
    const archivedFilter = showArchived
      ? sql`${contacts.archivedAt} IS NOT NULL`
      : sql`${contacts.archivedAt} IS NULL`;
    if (userId === null) {
      return await db.select().from(contacts).where(archivedFilter);
    }
    return await db.select().from(contacts)
      .where(and(eq(contacts.userId, userId), archivedFilter));
  }

  async getContact(id: string, userId: string | null): Promise<Contact | undefined> {
    if (userId === null) {
      // Admin: get any contact by ID
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
      return contact;
    }
    const [contact] = await db.select().from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
    return contact;
  }

  async createContact(insertContact: InsertContact, userId: string): Promise<Contact> {
    const [contact] = await db
      .insert(contacts)
      .values({ ...insertContact, userId, lastContactDate: new Date() })
      .returning();
    
    // Create activity
    await this.createActivity({
      type: "contact_added",
      description: `New contact ${contact.firstName} ${contact.lastName} added`,
      contactId: contact.id,
    }, userId);
    
    return contact;
  }

  async bulkCreateContacts(contactsData: Array<{ row: number, data: InsertContact }>, userId: string): Promise<{ successful: Contact[], failed: Array<{ row: number, error: string, data: any }> }> {
    const successful: Contact[] = [];
    const failed: Array<{ row: number, error: string, data: any }> = [];
    
    for (const { row, data } of contactsData) {
      try {
        const contact = await this.createContact(data, userId);
        successful.push(contact);
      } catch (error) {
        failed.push({
          row,
          error: error instanceof Error ? error.message : "Unknown error",
          data
        });
      }
    }
    
    return { successful, failed };
  }

  async updateContact(id: string, updateData: Partial<InsertContact>, userId: string | null): Promise<Contact | undefined> {
    if (userId === null) {
      // Admin: update any contact
      const [updated] = await db
        .update(contacts)
        .set({ ...updateData, lastContactDate: new Date() })
        .where(eq(contacts.id, id))
        .returning();
      return updated;
    }
    const [updated] = await db
      .update(contacts)
      .set({ ...updateData, lastContactDate: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
      .returning();
    return updated;
  }

  async assignContact(id: string, newUserId: string): Promise<Contact | undefined> {
    const [updated] = await db
      .update(contacts)
      .set({ userId: newUserId })
      .where(eq(contacts.id, id))
      .returning();
    return updated;
  }

  async archiveContact(id: string, userId: string | null): Promise<Contact | undefined> {
    const where = userId === null
      ? eq(contacts.id, id)
      : and(eq(contacts.id, id), eq(contacts.userId, userId));
    const [updated] = await db
      .update(contacts)
      .set({ archivedAt: new Date() })
      .where(where)
      .returning();
    return updated;
  }

  async unarchiveContact(id: string, userId: string | null): Promise<Contact | undefined> {
    const where = userId === null
      ? eq(contacts.id, id)
      : and(eq(contacts.id, id), eq(contacts.userId, userId));
    const [updated] = await db
      .update(contacts)
      .set({ archivedAt: null })
      .where(where)
      .returning();
    return updated;
  }

  async deleteContact(id: string, userId: string | null): Promise<boolean> {
    return deleteContactSafely(db, id, userId);
  }

  async deleteSalonSearchReportRow(id: string, userId: string): Promise<boolean> {
    return deleteSalonReviewRowSafely(db, id, userId);
  }

  async searchContacts(query: string, userId: string | null): Promise<Contact[]> {
    const lowercaseQuery = `%${query.toLowerCase()}%`;
    if (userId === null) {
      // Admin: search all contacts
      return await db.select().from(contacts)
        .where(sql`(
          LOWER(${contacts.firstName}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.lastName}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.email}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.company}) LIKE ${lowercaseQuery}
        )`);
    }
    return await db.select().from(contacts)
      .where(and(
        eq(contacts.userId, userId),
        sql`(
          LOWER(${contacts.firstName}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.lastName}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.email}) LIKE ${lowercaseQuery} OR 
          LOWER(${contacts.company}) LIKE ${lowercaseQuery}
        )`
      ));
  }

  async findDuplicateContacts(contact: InsertContact, userId: string, excludeId?: string): Promise<Contact[]> {
    const normalizedPhone = normalizePhoneNumber(contact.phone);
    const normalizedEmail = normalizeEmail(contact.email);
    const normalizedFirstName = normalizeName(contact.firstName);
    const normalizedLastName = normalizeName(contact.lastName);
    
    // Get all contacts for the user
    const userContacts = await db.select().from(contacts).where(eq(contacts.userId, userId));
    
    // Filter for potential duplicates
    const duplicates = userContacts.filter(existing => {
      // Exclude the contact being updated (if applicable)
      if (excludeId && existing.id === excludeId) {
        return false;
      }
      
      // Check phone number match (normalized)
      if (normalizedPhone && existing.phone) {
        const existingNormalizedPhone = normalizePhoneNumber(existing.phone);
        if (existingNormalizedPhone === normalizedPhone) {
          return true;
        }
      }
      
      // Check email match (case-insensitive)
      if (normalizedEmail && existing.email) {
        const existingNormalizedEmail = normalizeEmail(existing.email);
        if (existingNormalizedEmail === normalizedEmail) {
          return true;
        }
      }
      
      // Check first and last name match (case-insensitive)
      if (normalizedFirstName && normalizedLastName) {
        const existingNormalizedFirstName = normalizeName(existing.firstName);
        const existingNormalizedLastName = normalizeName(existing.lastName);
        if (existingNormalizedFirstName === normalizedFirstName && 
            existingNormalizedLastName === normalizedLastName) {
          return true;
        }
      }
      
      return false;
    });
    
    return duplicates;
  }

  // Deals
  async getDeals(userId: string | null): Promise<Deal[]> {
    if (userId === null) {
      // Admin: get all deals
      return await db.select().from(deals);
    }
    return await db.select().from(deals).where(eq(deals.userId, userId));
  }

  async getPipelineEmailSummaries(userId: string | null, stage?: string): Promise<PipelineEmailSummaries> {
    return loadPipelineEmailSummaries(userId, stage, {
      getDeals: (scope, stageFilter) => stageFilter
        ? this.getDealsByStage(stageFilter, scope) : this.getDeals(scope),
      getContacts: (ids, scope) => db.select({
        id: contacts.id, userId: contacts.userId, email: contacts.email,
      }).from(contacts).where(and(
        inArray(contacts.id, ids),
        scope === null ? undefined : eq(contacts.userId, scope),
      )),
      getLogs: (ids, scope) => db.select({
        id: emailSequenceLogs.id, userId: emailSequenceLogs.userId, contactId: emailSequenceLogs.contactId,
        status: emailSequenceLogs.status, sentAt: emailSequenceLogs.sentAt,
        scheduledSendAt: emailSequenceLogs.scheduledSendAt,
        emailResponseReceived: emailSequenceLogs.emailResponseReceived, brevoMessageId: emailSequenceLogs.brevoMessageId,
      }).from(emailSequenceLogs).innerJoin(contacts, eq(contacts.id, emailSequenceLogs.contactId)).where(and(
        inArray(emailSequenceLogs.contactId, ids),
        scope === null ? undefined : eq(emailSequenceLogs.userId, scope),
        scope === null ? undefined : eq(contacts.userId, scope),
      )),
    });
  }

  async getDeal(id: string, userId: string | null): Promise<Deal | undefined> {
    if (userId === null) {
      // Admin: get any deal by ID
      const [deal] = await db.select().from(deals).where(eq(deals.id, id));
      return deal;
    }
    const [deal] = await db.select().from(deals)
      .where(and(eq(deals.id, id), eq(deals.userId, userId)));
    return deal;
  }

  async createDeal(insertDeal: InsertDeal, userId: string): Promise<Deal> {
    return createDealRecord(db, insertDeal, userId);
  }

  async updateDeal(id: string, updateData: Partial<InsertDeal>, userId: string | null): Promise<Deal | undefined> {
    const existing = await this.getDeal(id, userId);
    if (!existing) return undefined;

    const dealUpdateData: any = {
      ...updateData,
      value: updateData.value !== undefined ? (updateData.value && updateData.value.trim() ? updateData.value : null) : undefined,
      expectedCloseDate: updateData.expectedCloseDate ? new Date(updateData.expectedCloseDate) : undefined,
      demoScheduledDate: updateData.demoScheduledDate ? new Date(updateData.demoScheduledDate) : undefined,
      demoCompletedDate: updateData.demoCompletedDate ? new Date(updateData.demoCompletedDate) : undefined,
      wonDate: updateData.wonDate ? new Date(updateData.wonDate) : undefined,
      contactId: updateData.contactId !== undefined ? (updateData.contactId && updateData.contactId.trim() ? updateData.contactId : null) : undefined,
    };

    // Set stageChangedAt timestamp if stage is being changed
    if (updateData.stage && updateData.stage !== existing.stage) {
      dealUpdateData.stageChangedAt = new Date();
    }

    const whereClause = userId === null 
      ? eq(deals.id, id)
      : and(eq(deals.id, id), eq(deals.userId, userId));

    const [updated] = await db
      .update(deals)
      .set(dealUpdateData)
      .where(whereClause)
      .returning();
    
    // Create activity if stage changed (use the deal's actual userId for activity)
    if (updateData.stage && updateData.stage !== existing.stage) {
      await this.createActivity({
        type: "deal_stage_changed",
        description: `Deal "${updated.title}" moved to ${updateData.stage}`,
        dealId: id,
        contactId: updated.contactId || undefined,
      }, updated.userId);
    }
    
    return updated;
  }

  async deleteDeal(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null
      ? eq(deals.id, id)
      : and(eq(deals.id, id), eq(deals.userId, userId));

    // Verify the deal exists (and belongs to user if not admin)
    const [deal] = await db.select({ id: deals.id }).from(deals).where(whereClause);
    if (!deal) return false;

    // 1. Get commission IDs for this deal (needed to clean payroll line items)
    const dealCommissions = await db.select({ id: commissions.id })
      .from(commissions).where(eq(commissions.dealId, id));
    const commissionIds = dealCommissions.map(c => c.id);

    // 2. Get monthly payment IDs for this deal
    const monthlyPayments = await db.select({ id: commissionMonthlyPayments.id })
      .from(commissionMonthlyPayments).where(eq(commissionMonthlyPayments.dealId, id));
    const monthlyPaymentIds = monthlyPayments.map(p => p.id);

    // 3. Nullify FK references in payroll_line_items (preserve payroll history, just unlink)
    if (commissionIds.length > 0) {
      await db.update(payrollLineItems)
        .set({ commissionId: null })
        .where(inArray(payrollLineItems.commissionId, commissionIds));
    }
    if (monthlyPaymentIds.length > 0) {
      await db.update(payrollLineItems)
        .set({ monthlyPaymentId: null })
        .where(inArray(payrollLineItems.monthlyPaymentId, monthlyPaymentIds));
    }

    // 4. Delete commission monthly payments for this deal
    await db.delete(commissionMonthlyPayments).where(eq(commissionMonthlyPayments.dealId, id));

    // 5. Delete commissions for this deal
    await db.delete(commissions).where(eq(commissions.dealId, id));

    // 6. Delete deal activities
    await db.delete(dealActivities).where(eq(dealActivities.dealId, id));

    // 7. Nullify dealId on tasks (keep tasks but unlink from deal)
    await db.update(tasks).set({ dealId: null }).where(eq(tasks.dealId, id));

    // 8. Nullify dealId on activities (keep audit trail but unlink)
    await db.update(activities).set({ dealId: null }).where(eq(activities.dealId, id));

    // 9. Delete the deal
    const result = await db.delete(deals).where(eq(deals.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getDealsByStage(stage: string, userId: string | null): Promise<Deal[]> {
    if (userId === null) {
      // Admin: get all deals in this stage
      return await db.select().from(deals).where(eq(deals.stage, stage));
    }
    return await db.select().from(deals)
      .where(and(eq(deals.stage, stage), eq(deals.userId, userId)));
  }

  // Tasks
  async getTasks(userId: string | null): Promise<Task[]> {
    if (userId === null) {
      // Admin: get all tasks
      return await db.select().from(tasks);
    }
    return await db.select().from(tasks).where(eq(tasks.userId, userId));
  }

  async getTask(id: string, userId: string | null): Promise<Task | undefined> {
    if (userId === null) {
      // Admin: get any task by ID
      const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
      return task;
    }
    const [task] = await db.select().from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    return task;
  }

  async createTask(insertTask: InsertTask, userId: string): Promise<Task> {
    const taskData = {
      ...insertTask,
      userId,
      dueDate: insertTask.dueDate ? new Date(insertTask.dueDate) : null,
    };
    
    const [task] = await db
      .insert(tasks)
      .values(taskData)
      .returning();
    
    // Create activity
    await this.createActivity({
      type: "task_created",
      description: `Task "${task.title}" created`,
      taskId: task.id,
      contactId: task.contactId || undefined,
      dealId: task.dealId || undefined,
    }, userId);
    
    return task;
  }

  async updateTask(id: string, updateData: Partial<InsertTask>, userId: string | null): Promise<Task | undefined> {
    const existing = await this.getTask(id, userId);
    if (!existing) return undefined;

    const completedAt = updateData.status === "completed" ? new Date() : existing.completedAt;
    
    const taskUpdateData = {
      ...updateData,
      dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
      completedAt,
    };
    
    const whereClause = userId === null 
      ? eq(tasks.id, id)
      : and(eq(tasks.id, id), eq(tasks.userId, userId));

    const [updated] = await db
      .update(tasks)
      .set(taskUpdateData)
      .where(whereClause)
      .returning();
    
    // Create activity if completed (use the task's actual userId for activity)
    if (updateData.status === "completed" && existing.status !== "completed") {
      await this.createActivity({
        type: "task_completed",
        description: `Task "${updated.title}" completed`,
        taskId: id,
        contactId: updated.contactId || undefined,
        dealId: updated.dealId || undefined,
      }, updated.userId);
    }
    
    return updated;
  }

  async deleteTask(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null 
      ? eq(tasks.id, id)
      : and(eq(tasks.id, id), eq(tasks.userId, userId));
    
    const result = await db.delete(tasks).where(whereClause);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getTasksByStatus(status: string, userId: string | null): Promise<Task[]> {
    if (userId === null) {
      // Admin: get all tasks with this status
      return await db.select().from(tasks).where(eq(tasks.status, status));
    }
    return await db.select().from(tasks)
      .where(and(eq(tasks.status, status), eq(tasks.userId, userId)));
  }

  async getTasksByDealId(dealId: string, userId: string | null): Promise<Task[]> {
    if (userId === null) {
      return await db.select().from(tasks)
        .where(eq(tasks.dealId, dealId))
        .orderBy(desc(tasks.createdAt));
    }
    return await db.select().from(tasks)
      .where(and(eq(tasks.dealId, dealId), eq(tasks.userId, userId)))
      .orderBy(desc(tasks.createdAt));
  }

  async getDealActivities(dealId: string, userId: string | null): Promise<DealActivity[]> {
    return await db.select().from(dealActivities)
      .where(eq(dealActivities.dealId, dealId))
      .orderBy(desc(dealActivities.createdAt));
  }

  async createDealActivity(activity: InsertDealActivity, createdBy: string): Promise<DealActivity> {
    const [result] = await db.insert(dealActivities)
      .values({ ...activity, createdBy })
      .returning();
    return result;
  }

  async getUpcomingTasks(userId: string | null): Promise<Task[]> {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    if (userId === null) {
      // Admin: get all upcoming tasks
      return await db.select().from(tasks)
        .where(and(
          eq(tasks.status, "pending"),
          gte(tasks.dueDate, now),
          lte(tasks.dueDate, weekFromNow)
        ))
        .orderBy(tasks.dueDate);
    }
    
    return await db.select().from(tasks)
      .where(and(
        eq(tasks.userId, userId),
        eq(tasks.status, "pending"),
        gte(tasks.dueDate, now),
        lte(tasks.dueDate, weekFromNow)
      ))
      .orderBy(tasks.dueDate);
  }

  // Activities
  async getActivities(userId: string | null): Promise<Activity[]> {
    if (userId === null) {
      // Admin: get all activities
      return await db.select().from(activities);
    }
    return await db.select().from(activities).where(eq(activities.userId, userId));
  }

  async createActivity(insertActivity: InsertActivity, userId: string): Promise<Activity> {
    const [activity] = await db
      .insert(activities)
      .values({ ...insertActivity, userId })
      .returning();
    return activity;
  }

  async getRecentActivities(limit: number = 10, userId: string | null): Promise<Activity[]> {
    if (userId === null) {
      // Admin: get all recent activities
      return await db.select().from(activities)
        .orderBy(desc(activities.createdAt))
        .limit(limit);
    }
    return await db.select().from(activities)
      .where(eq(activities.userId, userId))
      .orderBy(desc(activities.createdAt))
      .limit(limit);
  }

  // Email Sequences
  async getEmailSequences(userId: string | null): Promise<EmailSequence[]> {
    if (userId === null) {
      // Admin: get all sequences
      return await db.select().from(emailSequences);
    }
    return await db.select().from(emailSequences)
      .where(eq(emailSequences.userId, userId))
      .orderBy(emailSequences.sequenceNumber);
  }

  async getEmailSequencesByTrack(userId: string | null, track: string): Promise<EmailSequence[]> {
    if (userId === null) {
      // Admin: get all sequences for track
      return await db.select().from(emailSequences)
        .where(eq(emailSequences.sequenceTrack, track))
        .orderBy(emailSequences.sequenceNumber);
    }
    return await db.select().from(emailSequences)
      .where(and(eq(emailSequences.userId, userId), eq(emailSequences.sequenceTrack, track)))
      .orderBy(emailSequences.sequenceNumber);
  }

  async getEmailSequence(id: string, userId: string | null): Promise<EmailSequence | undefined> {
    if (userId === null) {
      // Admin: get any sequence by ID
      const [sequence] = await db.select().from(emailSequences).where(eq(emailSequences.id, id));
      return sequence;
    }
    const [sequence] = await db.select().from(emailSequences)
      .where(and(eq(emailSequences.id, id), eq(emailSequences.userId, userId)));
    return sequence;
  }

  async createEmailSequence(insertSequence: InsertEmailSequence, userId: string): Promise<EmailSequence> {
    const sequenceData: any = {
      ...insertSequence,
      userId,
      scheduledDate: insertSequence.scheduledDate && insertSequence.scheduledDate.trim() 
        ? new Date(insertSequence.scheduledDate) 
        : null,
    };

    const [sequence] = await db
      .insert(emailSequences)
      .values(sequenceData)
      .returning();
    
    return sequence;
  }

  async updateEmailSequence(id: string, updateData: Partial<InsertEmailSequence>, userId: string | null): Promise<EmailSequence | undefined> {
    const sequenceUpdateData: any = {
      ...updateData,
      scheduledDate: updateData.scheduledDate !== undefined 
        ? (updateData.scheduledDate && updateData.scheduledDate.trim() ? new Date(updateData.scheduledDate) : null)
        : undefined,
      updatedAt: new Date(),
    };

    const whereClause = userId === null 
      ? eq(emailSequences.id, id)
      : and(eq(emailSequences.id, id), eq(emailSequences.userId, userId));

    const [updated] = await db
      .update(emailSequences)
      .set(sequenceUpdateData)
      .where(whereClause)
      .returning();
    
    return updated;
  }

  async deleteEmailSequence(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null 
      ? eq(emailSequences.id, id)
      : and(eq(emailSequences.id, id), eq(emailSequences.userId, userId));
    
    const result = await db.delete(emailSequences).where(whereClause);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Email Sequence Logs
  async getEmailSequenceLogs(userId: string | null, contactId?: string): Promise<EmailSequenceLog[]> {
    if (userId === null) {
      // Admin: get all logs or filtered by contact
      if (contactId) {
        return await db.select().from(emailSequenceLogs)
          .where(eq(emailSequenceLogs.contactId, contactId))
          .orderBy(desc(emailSequenceLogs.createdAt));
      }
      return await db.select().from(emailSequenceLogs)
        .orderBy(desc(emailSequenceLogs.createdAt));
    }
    
    // Salesperson: get their logs or filtered by contact
    if (contactId) {
      return await db.select().from(emailSequenceLogs)
        .where(and(
          eq(emailSequenceLogs.userId, userId),
          eq(emailSequenceLogs.contactId, contactId)
        ))
        .orderBy(desc(emailSequenceLogs.createdAt));
    }
    return await db.select().from(emailSequenceLogs)
      .where(eq(emailSequenceLogs.userId, userId))
      .orderBy(desc(emailSequenceLogs.createdAt));
  }

  async getEmailSequenceLogById(id: string, userId: string | null): Promise<EmailSequenceLog | undefined> {
    if (userId === null) {
      const [log] = await db.select().from(emailSequenceLogs).where(eq(emailSequenceLogs.id, id));
      return log;
    }
    const [log] = await db.select().from(emailSequenceLogs)
      .where(and(eq(emailSequenceLogs.id, id), eq(emailSequenceLogs.userId, userId)));
    return log;
  }

  async createEmailSequenceLog(insertLog: InsertEmailSequenceLog, userId: string, expectedRecipient?:string, options: RecipientEnrollmentOptions = {}): Promise<EmailSequenceLog> {
    const contact = await this.getContact(insertLog.contactId, null);
    if (!contact) throw new Error("Contact not found");
    const rejection = await this.getSalonReportSendRejection(contact.id, userId, contact.userId, contact.email);
    if (rejection) throw new Error(rejection);
    const sequence = await this.getEmailSequence(insertLog.sequenceId, userId);
    if (!sequence || sequence.isActive !== "true") throw new Error("Select an active sequence owned by this CRM owner.");
    if (sequence.sequenceNumber !== insertLog.sequenceNumber || (insertLog.sequenceTrack && sequence.sequenceTrack !== insertLog.sequenceTrack)) {
      throw new Error("Sequence step or audience changed; refresh the enrollment preview.");
    }
    return reserveRecipientLog({ ...insertLog, sequenceTrack:sequence.sequenceTrack }, userId, expectedRecipient??contact.email, options);
  }

  async bulkCreateEmailSequenceLogs(sequenceId: string, contactIds: string[], userId: string | null, scheduledSendAt?: Date | null, customSubject?: string, customBody?: string, expectedRecipients?:Record<string,string>, options: RecipientEnrollmentOptions = {}): Promise<{ successful: EmailSequenceLog[], failed: Array<{ contactId: string, error: string }> }> {
    const successful: EmailSequenceLog[] = [];
    const failed: Array<{ contactId: string, error: string }> = [];
    
    // First verify the sequence exists (and belongs to the user if not admin)
    const sequence = await this.getEmailSequence(sequenceId, userId);
    if (!sequence) {
      // If sequence doesn't exist or doesn't belong to user, fail all
      return {
        successful: [],
        failed: contactIds.map(contactId => ({
          contactId,
          error: "Email sequence not found or you don't have access to it"
        }))
      };
    }
    
    // Use the sequence's userId for creating logs (the owner of the sequence)
    const sequenceOwnerId = sequence.userId;
    
    for (const contactId of contactIds) {
      try {
        // Verify contact exists (and belongs to the user if not admin)
        const contact = await this.getContact(contactId, userId);
        if (!contact) {
          failed.push({
            contactId,
            error: "Contact not found or you don't have access to it"
          });
          continue;
        }
        const rejection = await this.getSalonReportSendRejection(contact.id, sequenceOwnerId, contact.userId, contact.email);
        if (rejection) {
          failed.push({ contactId, error: rejection });
          continue;
        }
        
        // Enforce track matching rules:
        // - bare "custom" track → accepts any contact (full bypass)
        // - "salon_custom" / "mobile_custom" → accepts any salon/mobile contact
        //   regardless of whether they use software (these are the "General" tracks)
        // - all other tracks → contact track must match exactly
        const seqTrack = sequence.sequenceTrack;
        const bType = contact.businessType === "mobile" ? "mobile" : "salon";
        const contactTrack = contact.sequenceTrack ||
          `${bType}_${contact.usesSoftware === "Yes" ? "uses_competitor" : "no_software"}`;

        if (seqTrack === "custom") {
          // bare custom — no restriction
        } else if (seqTrack === "salon_custom" || seqTrack === "mobile_custom") {
          // Prefixed general track — only check business type prefix
          const seqBizType = seqTrack.replace("_custom", ""); // "salon" or "mobile"
          if (seqBizType !== bType) {
            failed.push({
              contactId,
              error: `This sequence is for ${seqBizType} businesses but contact is a ${bType} business`
            });
            continue;
          }
        } else if (contactTrack !== seqTrack) {
          failed.push({
            contactId,
            error: `Contact track (${contactTrack}) does not match sequence track (${seqTrack})`
          });
          continue;
        }
        
        // Check if this contact is already in the queue for this sequence
        const existingLogs = await db.select().from(emailSequenceLogs)
          .where(and(
            eq(emailSequenceLogs.contactId, contactId),
            eq(emailSequenceLogs.sequenceId, sequenceId)
          ));
        
        const newManualRun = options.manualNewSequence && sequence.sequenceNumber === 1;
        if (existingLogs.some(log => !newManualRun || ["pending", "processing", "needs_review"].includes(log.status))) {
          failed.push({
            contactId,
            error: "Contact is already in this email sequence"
          });
          continue;
        }
        
        // Create log entry with status "pending"
        // Use the sequence owner's ID for the log
        const log = await this.createEmailSequenceLog({
            contactId,
            sequenceId,
            sequenceTrack: sequence.sequenceTrack,
            sequenceNumber: sequence.sequenceNumber,
            status: "pending",
            emailResponseReceived: "false",
            ...(scheduledSendAt ? { scheduledSendAt } : {}),
            ...(customSubject ? { customSubject } : {}),
            ...(customBody ? { customBody } : {}),
          }, sequenceOwnerId,expectedRecipients?.[contactId], options);
        
        successful.push(log);
      } catch (error) {
        failed.push({
          contactId,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
    
    return { successful, failed };
  }

  async updateEmailSequenceLog(id: string, updateData: Partial<InsertEmailSequenceLog>, userId: string | null): Promise<EmailSequenceLog | undefined> {
    const whereClause = userId === null 
      ? eq(emailSequenceLogs.id, id)
      : and(eq(emailSequenceLogs.id, id), eq(emailSequenceLogs.userId, userId));

    const [updated] = await db
      .update(emailSequenceLogs)
      .set(updateData)
      .where(whereClause)
      .returning();
    
    return updated;
  }

  async deleteEmailSequenceLog(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null
      ? eq(emailSequenceLogs.id, id)
      : and(eq(emailSequenceLogs.id, id), eq(emailSequenceLogs.userId, userId));

    const result = await db.delete(emailSequenceLogs).where(whereClause).returning();
    return result.length > 0;
  }

  // Inbox Messages
  async getInboxMessages(userId: string | null, contactId?: string): Promise<InboxMessage[]> {
    const conditions = [];
    if (userId !== null) {
      conditions.push(eq(inboxMessages.userId, userId));
    }
    if (contactId) {
      conditions.push(eq(inboxMessages.contactId, contactId));
    }
    if (conditions.length > 0) {
      return await db.select().from(inboxMessages)
        .where(and(...conditions))
        .orderBy(desc(inboxMessages.receivedAt));
    }
    return await db.select().from(inboxMessages).orderBy(desc(inboxMessages.receivedAt));
  }

  async getInboxMessage(id: string, userId: string | null): Promise<InboxMessage | undefined> {
    if (userId === null) {
      // Admin: get any message by ID
      const [message] = await db.select().from(inboxMessages).where(eq(inboxMessages.id, id));
      return message;
    }
    const [message] = await db.select().from(inboxMessages)
      .where(and(eq(inboxMessages.id, id), eq(inboxMessages.userId, userId)));
    return message;
  }

  async createInboxMessage(insertMessage: InsertInboxMessage, userId: string): Promise<InboxMessage> {
    const [message] = await db
      .insert(inboxMessages)
      .values({ ...insertMessage, userId })
      .returning();
    return message;
  }

  async updateInboxMessage(id: string, updateData: Partial<InsertInboxMessage>, userId: string | null): Promise<InboxMessage | undefined> {
    const whereClause = userId === null
      ? eq(inboxMessages.id, id)
      : and(eq(inboxMessages.id, id), eq(inboxMessages.userId, userId));

    const [updated] = await db
      .update(inboxMessages)
      .set(updateData)
      .where(whereClause)
      .returning();
    
    return updated;
  }

  async deleteInboxMessage(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null
      ? eq(inboxMessages.id, id)
      : and(eq(inboxMessages.id, id), eq(inboxMessages.userId, userId));

    const result = await db
      .delete(inboxMessages)
      .where(whereClause)
      .returning();
    
    return result.length > 0;
  }

  async getUnreadCount(userId: string | null): Promise<number> {
    const whereClause = userId === null
      ? eq(inboxMessages.isRead, "false")
      : and(eq(inboxMessages.userId, userId), eq(inboxMessages.isRead, "false"));

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboxMessages)
      .where(whereClause);
    
    return result?.count || 0;
  }

  async getDealsWithUnreadReplies(userId: string | null): Promise<string[]> {
    const userDeals = userId
      ? await db.select({ id: deals.id, contactId: deals.contactId }).from(deals).where(eq(deals.userId, userId))
      : await db.select({ id: deals.id, contactId: deals.contactId }).from(deals);

    const contactToDeals = new Map<string, string[]>();
    for (const deal of userDeals) {
      if (!deal.contactId) continue;
      if (!contactToDeals.has(deal.contactId)) contactToDeals.set(deal.contactId, []);
      contactToDeals.get(deal.contactId)!.push(deal.id);
    }

    if (contactToDeals.size === 0) return [];

    const contactIds = Array.from(contactToDeals.keys());
    const unreadMsgs = await db
      .select({ contactId: inboxMessages.contactId })
      .from(inboxMessages)
      .where(and(inArray(inboxMessages.contactId, contactIds), eq(inboxMessages.isRead, "false")));

    const dealIds = new Set<string>();
    for (const msg of unreadMsgs) {
      if (!msg.contactId) continue;
      for (const dealId of (contactToDeals.get(msg.contactId) ?? [])) {
        dealIds.add(dealId);
      }
    }

    return Array.from(dealIds);
  }

  async markRepliesReadForDeal(dealId: string, userId: string | null): Promise<void> {
    const deal = await this.getDeal(dealId, userId);
    if (!deal?.contactId) return;
    await db
      .update(inboxMessages)
      .set({ isRead: "true" })
      .where(and(eq(inboxMessages.contactId, deal.contactId), eq(inboxMessages.isRead, "false")));
  }

  // National Search Job operations
  /**
   * Atomically creates a national search job — acquires a user-scoped advisory lock
   * inside a transaction so concurrent requests are serialized and only one succeeds.
   * Returns null if a job is already active (caller should respond 409).
   */
  async createNationalSearchJob(userId: string, opts?: { targetStates?: string[]; maxPerState?: number; noSoftwareOnly?: boolean }): Promise<NationalSearchJob | null> {
    return await db.transaction(async (tx) => {
      // Advisory lock scoped to this user — serializes concurrent create requests atomically.
      // The lock is automatically released when the transaction ends.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

      // Now check for an existing active job — no race possible due to the lock
      const [existing] = await tx
        .select()
        .from(nationalSearchJobs)
        .where(and(
          eq(nationalSearchJobs.userId, userId),
          or(eq(nationalSearchJobs.status, "running"), eq(nationalSearchJobs.status, "pending")),
        ))
        .limit(1);

      if (existing) return null; // caller returns 409

      const targetStates = opts?.targetStates && opts.targetStates.length > 0
        ? opts.targetStates.join(",")
        : null;
      const maxPerState = opts?.maxPerState ?? 3;
      const noSoftwareOnly = opts?.noSoftwareOnly ? "true" : "false";
      const statesTotal = opts?.targetStates && opts.targetStates.length > 0
        ? opts.targetStates.length
        : 50;

      const [job] = await tx.insert(nationalSearchJobs).values({
        userId,
        targetStates,
        maxPerState,
        noSoftwareOnly,
        statesTotal,
      }).returning();
      return job;
    });
  }

  async getNationalSearchJob(id: string, userId: string | null): Promise<NationalSearchJob | undefined> {
    const whereClause = userId === null
      ? eq(nationalSearchJobs.id, id)
      : and(eq(nationalSearchJobs.id, id), eq(nationalSearchJobs.userId, userId));
    const [job] = await db.select().from(nationalSearchJobs).where(whereClause);
    return job;
  }

  async getNationalSearchJobs(userId: string | null): Promise<NationalSearchJob[]> {
    const whereClause = userId === null ? undefined : eq(nationalSearchJobs.userId, userId);
    const query = db.select().from(nationalSearchJobs);
    if (whereClause) return await query.where(whereClause).orderBy(desc(nationalSearchJobs.createdAt));
    return await query.orderBy(desc(nationalSearchJobs.createdAt));
  }

  async updateNationalSearchJob(id: string, updates: Partial<NationalSearchJob>): Promise<NationalSearchJob | undefined> {
    const [updated] = await db.update(nationalSearchJobs).set(updates).where(eq(nationalSearchJobs.id, id)).returning();
    return updated;
  }

  async updateNationalSearchJobIfNotCancelled(id: string, updates: Partial<NationalSearchJob>): Promise<NationalSearchJob | undefined> {
    // Atomic conditional update — only writes when status is NOT already 'cancelled'
    const [updated] = await db
      .update(nationalSearchJobs)
      .set(updates)
      .where(and(eq(nationalSearchJobs.id, id), ne(nationalSearchJobs.status, "cancelled")))
      .returning();
    return updated;
  }

  async getActiveNationalSearchJob(userId: string): Promise<NationalSearchJob | undefined> {
    const [job] = await db
      .select()
      .from(nationalSearchJobs)
      .where(and(
        eq(nationalSearchJobs.userId, userId),
        or(eq(nationalSearchJobs.status, "running"), eq(nationalSearchJobs.status, "pending")),
      ))
      .limit(1);
    return job;
  }

  async getNationalJobResults(nationalJobId: string, userId: string | null): Promise<Array<LeadDiscoveryResult & { state: string }>> {
    // Fetch all sub-jobs belonging to this national job
    const subJobs = await db
      .select()
      .from(leadDiscoveryJobs)
      .where(eq(leadDiscoveryJobs.nationalJobId, nationalJobId));

    if (subJobs.length === 0) return [];

    const subJobIds = subJobs.map(j => j.id);
    const whereClause = userId === null
      ? inArray(leadDiscoveryResults.jobId, subJobIds)
      : and(inArray(leadDiscoveryResults.jobId, subJobIds), eq(leadDiscoveryResults.userId, userId));

    const results = await db
      .select()
      .from(leadDiscoveryResults)
      .where(whereClause)
      .orderBy(leadDiscoveryResults.createdAt);

    const jobStateMap = new Map(subJobs.map(j => [j.id, j.state]));
    return results.map(r => ({ ...r, state: jobStateMap.get(r.jobId) || '' }));
  }

  // Lead Discovery operations
  async getLeadDiscoveryJobs(userId: string | null): Promise<LeadDiscoveryJob[]> {
    const whereClause = userId === null
      ? undefined
      : eq(leadDiscoveryJobs.userId, userId);

    return await db
      .select()
      .from(leadDiscoveryJobs)
      .where(whereClause)
      .orderBy(desc(leadDiscoveryJobs.createdAt));
  }

  async getLeadDiscoveryJob(id: string, userId: string | null): Promise<LeadDiscoveryJob | undefined> {
    const whereClause = userId === null
      ? eq(leadDiscoveryJobs.id, id)
      : and(eq(leadDiscoveryJobs.id, id), eq(leadDiscoveryJobs.userId, userId));

    const [job] = await db
      .select()
      .from(leadDiscoveryJobs)
      .where(whereClause);
    return job;
  }

  async createLeadDiscoveryJob(job: InsertLeadDiscoveryJob, userId: string, nationalJobId?: string): Promise<LeadDiscoveryJob> {
    const zipCodeList = job.zipCodes.split(',').map(z => z.trim()).filter(z => z);
    const [newJob] = await db
      .insert(leadDiscoveryJobs)
      .values({
        ...job,
        userId,
        totalZipCodes: zipCodeList.length,
        ...(nationalJobId ? { nationalJobId } : {}),
      })
      .returning();
    return newJob;
  }

  async updateLeadDiscoveryJob(id: string, job: Partial<LeadDiscoveryJob>, userId: string | null): Promise<LeadDiscoveryJob | undefined> {
    const whereClause = userId === null
      ? eq(leadDiscoveryJobs.id, id)
      : and(eq(leadDiscoveryJobs.id, id), eq(leadDiscoveryJobs.userId, userId));

    const [updated] = await db
      .update(leadDiscoveryJobs)
      .set(job)
      .where(whereClause)
      .returning();
    return updated;
  }

  async deleteLeadDiscoveryJob(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null
      ? eq(leadDiscoveryJobs.id, id)
      : and(eq(leadDiscoveryJobs.id, id), eq(leadDiscoveryJobs.userId, userId));

    const result = await db
      .delete(leadDiscoveryJobs)
      .where(whereClause)
      .returning();
    return result.length > 0;
  }

  async getLeadDiscoveryResults(jobId: string, userId: string | null): Promise<LeadDiscoveryResult[]> {
    const whereClause = userId === null
      ? eq(leadDiscoveryResults.jobId, jobId)
      : and(eq(leadDiscoveryResults.jobId, jobId), eq(leadDiscoveryResults.userId, userId));

    return await db
      .select()
      .from(leadDiscoveryResults)
      .where(whereClause)
      .orderBy(desc(leadDiscoveryResults.createdAt));
  }

  async getAllLeadDiscoveryResults(userId: string | null): Promise<LeadDiscoveryResult[]> {
    const whereClause = userId === null
      ? undefined
      : eq(leadDiscoveryResults.userId, userId);

    const query = db.select().from(leadDiscoveryResults);
    if (whereClause) {
      return await query.where(whereClause).orderBy(desc(leadDiscoveryResults.createdAt));
    }
    return await query.orderBy(desc(leadDiscoveryResults.createdAt));
  }

  async getLeadDiscoveryResultById(id: string): Promise<LeadDiscoveryResult | undefined> {
    const [result] = await db
      .select()
      .from(leadDiscoveryResults)
      .where(eq(leadDiscoveryResults.id, id));
    return result;
  }

  async deleteLeadDiscoveryResult(id: string, userId: string | null): Promise<boolean> {
    const whereClause = userId === null
      ? eq(leadDiscoveryResults.id, id)
      : and(eq(leadDiscoveryResults.id, id), eq(leadDiscoveryResults.userId, userId));
    
    const deleted = await db
      .delete(leadDiscoveryResults)
      .where(whereClause)
      .returning();
    return deleted.length > 0;
  }

  async createLeadDiscoveryResult(result: InsertLeadDiscoveryResult, userId: string): Promise<LeadDiscoveryResult> {
    const [newResult] = await db
      .insert(leadDiscoveryResults)
      .values({
        ...result,
        userId,
      })
      .returning();
    return newResult;
  }

  async bulkCreateLeadDiscoveryResults(results: InsertLeadDiscoveryResult[], userId: string): Promise<LeadDiscoveryResult[]> {
    if (results.length === 0) return [];
    
    const resultsWithUserId = results.map(r => ({ ...r, userId }));
    return await db
      .insert(leadDiscoveryResults)
      .values(resultsWithUserId)
      .returning();
  }

  async updateLeadDiscoveryResult(id: string, result: Partial<LeadDiscoveryResult>, userId: string | null): Promise<LeadDiscoveryResult | undefined> {
    const whereClause = userId === null
      ? eq(leadDiscoveryResults.id, id)
      : and(eq(leadDiscoveryResults.id, id), eq(leadDiscoveryResults.userId, userId));

    const [updated] = await db
      .update(leadDiscoveryResults)
      .set(result)
      .where(whereClause)
      .returning();
    return updated;
  }

  async markResultsAsImported(resultIds: string[], contactIds: string[], userId: string | null): Promise<void> {
    for (let i = 0; i < resultIds.length; i++) {
      const whereClause = userId === null
        ? eq(leadDiscoveryResults.id, resultIds[i])
        : and(eq(leadDiscoveryResults.id, resultIds[i]), eq(leadDiscoveryResults.userId, userId));

      await db
        .update(leadDiscoveryResults)
        .set({ 
          isImported: "true",
          importedContactId: contactIds[i]
        })
        .where(whereClause);
    }
  }

  // Uploaded salon enrichment
  async getSalonEnrichmentBatches(userId: string | null): Promise<SalonEnrichmentBatch[]> {
    const clauses = [sql`coalesce(${salonEnrichmentBatches.researchProgress}->>'purpose', '') <> ${CONTACT_OWNER_LOOKUP_PURPOSE}`];
    if (userId !== null) clauses.push(eq(salonEnrichmentBatches.userId, userId));
    return db.select().from(salonEnrichmentBatches).where(and(...clauses)).orderBy(desc(salonEnrichmentBatches.createdAt));
  }

  async getContactOwnerNameRow(contactId: string, userId: string): Promise<SalonEnrichmentRow | undefined> {
    const [row] = await db.select().from(salonEnrichmentRows).where(and(
      eq(salonEnrichmentRows.importedContactId, contactId),
      eq(salonEnrichmentRows.userId, userId),
      sql`${salonEnrichmentRows.sourceData}->>'purpose' = ${CONTACT_OWNER_LOOKUP_PURPOSE}`,
    )).orderBy(desc(salonEnrichmentRows.createdAt)).limit(1);
    return row;
  }

  async ensureContactOwnerNameRow(contactId: string, userId: string): Promise<SalonEnrichmentRow | undefined> {
    return db.transaction(async tx => {
      // Lock the Contact before checking/creating evidence to prevent double-click
      // or multi-tab preparation from creating duplicate research records.
      const [contact] = await tx.select().from(contacts).where(and(
        eq(contacts.id, contactId), eq(contacts.userId, userId),
      )).for("update");
      if (!contact || contact.archivedAt) return undefined;
      const identity = contactOwnerLookupIdentity(contact);
      if (!identity.businessName) throw new Error("Add the business name to this Contact before searching for its owner.");
      const [existing] = await tx.select().from(salonEnrichmentRows).where(and(
        eq(salonEnrichmentRows.importedContactId, contactId), eq(salonEnrichmentRows.userId, userId),
        sql`${salonEnrichmentRows.sourceData}->>'purpose' = ${CONTACT_OWNER_LOOKUP_PURPOSE}`,
      )).limit(1);
      if (existing) {
        const changed = !contactOwnerLookupMatches(existing, contact);
        if (!changed) return existing;
        if (ownerNameFromRow(existing).status === "searching") {
          throw new SalonOwnerNameStorageConflict("Wait for the current owner lookup before changing its business details.");
        }
        const [updated] = await tx.update(salonEnrichmentRows).set({
          ...identity, evidence: { ...salonRowEvidence(existing), ownerName: { ...EMPTY_OWNER_NAME_RESULT } },
          updatedAt: new Date(),
        }).where(eq(salonEnrichmentRows.id, existing.id)).returning();
        return updated;
      }
      const [batch] = await tx.insert(salonEnrichmentBatches).values({
        userId, name: "Contact owner lookup", status: "completed", totalRows: 1,
        processedRows: 1, importedRows: 1, pilotLimit: 0, concurrency: 1,
        researchProgress: { purpose: CONTACT_OWNER_LOOKUP_PURPOSE }, completedAt: new Date(),
      }).returning();
      const [row] = await tx.insert(salonEnrichmentRows).values({
        ...identity, batchId: batch.id, userId, rowNumber: 1,
        importedContactId: contact.id, status: "imported", reviewStatus: "approved",
        sourceData: { purpose: CONTACT_OWNER_LOOKUP_PURPOSE },
        evidence: { ownerName: { ...EMPTY_OWNER_NAME_RESULT } },
      }).returning();
      return row;
    });
  }

  async getSalonEnrichmentBatch(id: string, userId: string | null): Promise<SalonEnrichmentBatch | undefined> {
    const where = userId === null
      ? eq(salonEnrichmentBatches.id, id)
      : and(eq(salonEnrichmentBatches.id, id), eq(salonEnrichmentBatches.userId, userId));
    const [batch] = await db.select().from(salonEnrichmentBatches).where(where);
    return batch;
  }

  async prepareSalonReportBatchForVerification(
    id: string,
    userId: string,
    callsPerRow: number,
    retryUnverified = false,
    expectedEligibleRows?: number,
  ): Promise<{ batch: SalonEnrichmentBatch; eligibleRows: number; estimatedSerpCalls: number } | null> {
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`salon-verify:${id}`}))`);
      const [batch] = await tx.select().from(salonEnrichmentBatches).where(and(
        eq(salonEnrichmentBatches.id, id),
        eq(salonEnrichmentBatches.userId, userId),
      ));
      if (!batch || batch.fileName !== "salon-public-web-review" ||
          (retryUnverified ? !["completed", "paused"].includes(batch.status) : batch.status !== "completed")) return null;
      const rows = await tx.select().from(salonEnrichmentRows).where(and(
        eq(salonEnrichmentRows.batchId, id),
        eq(salonEnrichmentRows.userId, userId),
      ));
      const eligible = retryUnverified
        ? rows.filter(isRetryableStagedSalonRow)
        : rows.every(row => {
          const data = row.sourceData as Record<string, unknown> | null;
          return data?.stagingState === "staged_unverified" &&
            row.email === null && row.importedContactId === null &&
            row.reviewStatus !== "approved" && row.reviewStatus !== "rejected";
        }) ? rows : [];
      if (!eligible.length || rows.some(row => row.status === "processing")) return null;
      if (retryUnverified && expectedEligibleRows !== eligible.length) return null;
      const eligibleIds = new Set(eligible.map(row => row.id));
      for (const row of eligible) {
        const sourceData = row.sourceData as Record<string, unknown>;
        await tx.update(salonEnrichmentRows).set({
          status: "pending",
          reviewStatus: "needs_review",
          identityMatchStatus: "unmatched",
          email: null,
          sourceData: { ...sourceData, stagingState: "verification_attempted" },
          processedAt: null,
          lastError: null,
          updatedAt: new Date(),
        }).where(and(eq(salonEnrichmentRows.id, row.id), eq(salonEnrichmentRows.userId, userId)));
      }
      const eligibleRows = eligible.length;
      const estimatedSerpCalls = eligibleRows * callsPerRow;
      const [updated] = await tx.update(salonEnrichmentBatches).set({
        status: "running",
        processedRows: rows.filter(row => !eligibleIds.has(row.id) && ["enriched", "failed", "rejected", "imported"].includes(row.status)).length,
        enrichedRows: rows.filter(row => !eligibleIds.has(row.id) && ["enriched", "imported"].includes(row.status)).length,
        needsReviewRows: rows.filter(row => row.reviewStatus === "needs_review").length,
        approvedRows: rows.filter(row => row.reviewStatus === "approved").length,
        importedRows: rows.filter(row => row.importedContactId !== null).length,
        estimatedSerpCalls: batch.estimatedSerpCalls + estimatedSerpCalls,
        usedSerpCalls: rows.reduce((total, row) => total + row.serpCallsUsed, 0),
        startedAt: new Date(),
        pausedAt: null,
        completedAt: null,
        errorMessage: null,
        updatedAt: new Date(),
      }).where(and(
        eq(salonEnrichmentBatches.id, id),
        eq(salonEnrichmentBatches.userId, userId),
      )).returning();
      return updated ? { batch: updated, eligibleRows, estimatedSerpCalls } : null;
    });
  }

  async createSalonEnrichmentBatch(data: InsertSalonEnrichmentBatch, rows: InsertSalonEnrichmentRow[], userId: string): Promise<SalonEnrichmentBatch> {
    return await db.transaction(async (tx) => {
      const [batch] = await tx.insert(salonEnrichmentBatches).values({
        ...data,
        userId,
        totalRows: rows.length,
        pilotLimit: data.pilotLimit ?? 100,
        concurrency: data.concurrency ?? 2,
      }).returning();
      if (rows.length) {
        // Keep the upload atomic, but stay well below PostgreSQL's bind
        // parameter limit for a 13,000+ row spreadsheet.
        for (let offset = 0; offset < rows.length; offset += 500) {
          await tx.insert(salonEnrichmentRows).values(rows.slice(offset, offset + 500).map(row => ({
            ...row,
            batchId: batch.id,
            userId,
            sourceData: row.sourceData ?? {},
          })));
        }
      }
      return batch;
    });
  }

  async createSalonSearchReportBatch(
    data: InsertSalonEnrichmentBatch,
    rows: InsertSalonEnrichmentRow[],
    userId: string,
    allowExisting: boolean,
    deduplicateBusinessPhone = false,
  ): Promise<{
    batch: SalonEnrichmentBatch | null;
    existingBatches: SalonEnrichmentBatch[];
    duplicatePlaceIds: string[];
    duplicateNaturalKeys: string[];
    existing: boolean;
  }> {
    return await db.transaction(async tx => {
      // Serialize owner-scoped report uploads from duplicate detection through
      // batch+row insertion so concurrent requests cannot both pass the check.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`salon-search-report:${userId}`}))`);
      const priorBatches = await tx.select().from(salonEnrichmentBatches).where(and(
        eq(salonEnrichmentBatches.userId, userId),
        eq(salonEnrichmentBatches.fileName, "salon-public-web-review"),
      ));
      const priorIds = priorBatches.map(batch => batch.id);
      const priorRows = priorIds.length
        ? await tx.select().from(salonEnrichmentRows).where(and(
          eq(salonEnrichmentRows.userId, userId),
          inArray(salonEnrichmentRows.batchId, priorIds),
        ))
        : [];
      const existingPlaceIds = priorRows.map(row => row.placeId?.trim().toLowerCase()).filter((id): id is string => !!id);
      const existingSet = new Set(existingPlaceIds);
      const incomingPlaceIds = rows.map(row => row.placeId?.trim().toLowerCase()).filter((id): id is string => !!id);
      const duplicatePlaceIds = Array.from(new Set(incomingPlaceIds.filter(id => existingSet.has(id))));
      const naturalKey = (businessName: string, phone: string | null | undefined) => {
        const name = businessName.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
        const digits = (phone || "").replace(/\D/g, "");
        const normalizedPhone = digits.length > 10 && digits.startsWith("1") ? digits.slice(1) : digits;
        return name && normalizedPhone.length >= 7 ? `${name}:${normalizedPhone}` : null;
      };
      const duplicateNaturalKeys = deduplicateBusinessPhone
        ? Array.from(new Set(rows.map(row => naturalKey(row.businessName, row.phone))
          .filter((key): key is string => !!key)
          .filter(key => priorRows.some(row => naturalKey(row.businessName, row.phone) === key))))
        : [];
      if (duplicateNaturalKeys.length) {
        return { batch: null, existingBatches: [], duplicatePlaceIds: [], duplicateNaturalKeys, existing: false };
      }
      if (duplicatePlaceIds.length) {
        const allExist = incomingPlaceIds.length > 0 && incomingPlaceIds.every(id => existingSet.has(id));
        if (allowExisting && allExist) {
          const incomingSet = new Set(incomingPlaceIds);
          const existingBatches = priorBatches.filter(batch =>
            priorRows.some(row => row.batchId === batch.id && row.placeId && incomingSet.has(row.placeId.trim().toLowerCase()))
          );
          const exactBatch = existingBatches.find(batch => {
            const ids = priorRows.filter(row => row.batchId === batch.id && row.placeId)
              .map(row => row.placeId!.trim().toLowerCase());
            const uniqueIds = new Set(ids);
            return uniqueIds.size === incomingSet.size && Array.from(incomingSet).every(id => uniqueIds.has(id));
          }) || null;
          return { batch: exactBatch, existingBatches, duplicatePlaceIds: [], duplicateNaturalKeys: [], existing: true };
        }
        return { batch: null, existingBatches: [], duplicatePlaceIds, duplicateNaturalKeys: [], existing: false };
      }

      const [batch] = await tx.insert(salonEnrichmentBatches).values({
        ...data,
        userId,
        totalRows: rows.length,
        completedAt: new Date(),
        pilotLimit: data.pilotLimit ?? 100,
        concurrency: data.concurrency ?? 1,
      }).returning();
      if (rows.length) {
        for (let offset = 0; offset < rows.length; offset += 500) {
          await tx.insert(salonEnrichmentRows).values(rows.slice(offset, offset + 500).map(row => ({
            ...row,
            batchId: batch.id,
            userId,
            sourceData: row.sourceData ?? {},
          })));
        }
      }
      return { batch, existingBatches: [], duplicatePlaceIds: [], duplicateNaturalKeys: [], existing: false };
    });
  }

  async updateSalonEnrichmentBatch(id: string, data: Partial<SalonEnrichmentBatch>, userId: string | null): Promise<SalonEnrichmentBatch | undefined> {
    const where = userId === null
      ? eq(salonEnrichmentBatches.id, id)
      : and(eq(salonEnrichmentBatches.id, id), eq(salonEnrichmentBatches.userId, userId));
    const [updated] = await db.update(salonEnrichmentBatches).set({ ...data, updatedAt: new Date() }).where(where).returning();
    return updated;
  }

  async getSalonEnrichmentRows(batchId: string, userId: string | null, filters: { status?: string; reviewStatus?: string; search?: string; limit?: number; offset?: number } = {}): Promise<SalonEnrichmentRow[]> {
    const clauses = [eq(salonEnrichmentRows.batchId, batchId)];
    if (userId !== null) clauses.push(eq(salonEnrichmentRows.userId, userId));
    if (filters.status) clauses.push(eq(salonEnrichmentRows.status, filters.status));
    if (filters.reviewStatus) clauses.push(eq(salonEnrichmentRows.reviewStatus, filters.reviewStatus));
    if (filters.search) {
      const term = `%${filters.search.replace(/[%_]/g, "\\$&").toLowerCase()}%`;
      clauses.push(sql`(lower(${salonEnrichmentRows.businessName}) like ${term} or lower(coalesce(${salonEnrichmentRows.city}, '')) like ${term} or lower(coalesce(${salonEnrichmentRows.email}, '')) like ${term})`);
    }
    const query = db.select().from(salonEnrichmentRows).where(and(...clauses)).orderBy(salonEnrichmentRows.rowNumber);
    if (filters.limit !== undefined) {
      return await query.limit(filters.limit).offset(filters.offset ?? 0);
    }
    return await query;
  }

  async getSalonEnrichmentRow(id: string, userId: string | null): Promise<SalonEnrichmentRow | undefined> {
    const where = userId === null ? eq(salonEnrichmentRows.id, id) : and(eq(salonEnrichmentRows.id, id), eq(salonEnrichmentRows.userId, userId));
    const [row] = await db.select().from(salonEnrichmentRows).where(where);
    return row;
  }

  async beginSalonOwnerNameLookup(
    rowId: string,
    userId: string,
    lookupToken: string,
  ): Promise<SalonEnrichmentRow | undefined> {
    return db.transaction(async tx => {
      const [row] = await tx.select().from(salonEnrichmentRows).where(and(
        eq(salonEnrichmentRows.id, rowId),
        eq(salonEnrichmentRows.userId, userId),
      )).for("update");
      if (!row) return undefined;
      const evidence = salonRowEvidence(row);
      const ownerName = ownerNameFromRow(row);
      if (salonOwnerNameLookupBlockedByRowStatus(row.status)) {
        throw new SalonOwnerNameStorageConflict("Wait for row enrichment to complete before starting owner-name lookup");
      }
      if (salonOwnerNameMutationBlocked(ownerName)) return undefined;
      let contact: Contact | undefined;
      if (row.importedContactId) {
        const [linked] = await tx.select().from(contacts).where(and(
          eq(contacts.id, row.importedContactId),
          eq(contacts.userId, userId),
        )).for("update");
        contact = linked;
        if ((row.sourceData as any)?.purpose === CONTACT_OWNER_LOOKUP_PURPOSE &&
            (!contact || contact.archivedAt || !contactOwnerLookupMatches(row, contact))) {
          throw new SalonOwnerNameStorageConflict("The Contact's business details changed. Search again before saving this name.");
        }
        // A legacy Contact's repeat search is evidence gathering, not an
        // instruction to erase its previously saved name or greeting choice.
        if ((row.sourceData as any)?.purpose !== CONTACT_OWNER_LOOKUP_PURPOSE) {
          await revokeOwnerNameContactInTransaction(tx, row, ownerName, contact);
        }
      }
      const searching = ownerNameLookupStarted(ownerName);
      const [updated] = await tx.update(salonEnrichmentRows).set({
        evidence: { ...evidence, ownerName: searching, ownerNameLookupToken: lookupToken },
        updatedAt: new Date(),
      }).where(eq(salonEnrichmentRows.id, row.id)).returning();
      return updated;
    });
  }

  async completeSalonOwnerNameLookup(
    rowId: string,
    userId: string,
    lookupToken: string,
    ownerName: OwnerNameResult,
  ): Promise<boolean> {
    return db.transaction(async tx => {
      const [row] = await tx.select().from(salonEnrichmentRows).where(and(
        eq(salonEnrichmentRows.id, rowId),
        eq(salonEnrichmentRows.userId, userId),
      )).for("update");
      if (!row) return false;
      const evidence = salonRowEvidence(row);
      if (evidence.ownerNameLookupToken !== lookupToken) return false;
      const updatedEvidence: Record<string, unknown> = { ...evidence, ownerName };
      delete updatedEvidence.ownerNameLookupToken;
      await tx.update(salonEnrichmentRows).set({
        evidence: updatedEvidence,
        serpCallsUsed: row.serpCallsUsed + Math.max(0, ownerName.providerCalls || 0),
        updatedAt: new Date(),
      }).where(eq(salonEnrichmentRows.id, row.id));
      return true;
    });
  }

  async reviewSalonOwnerName(
    rowId: string,
    userId: string,
    input: SalonOwnerNameReviewInput,
  ): Promise<SalonOwnerNameMutationResult> {
    return db.transaction(async tx => {
      const [row] = await tx.select().from(salonEnrichmentRows).where(and(
        eq(salonEnrichmentRows.id, rowId),
        eq(salonEnrichmentRows.userId, userId),
      )).for("update");
      if (!row) return { error: { status: 404, message: "Salon row not found or not owned by you" } };
      const ownerName = ownerNameFromRow(row);
      if (salonOwnerNameMutationBlocked(ownerName)) {
        return { error: { status: 409, message: "Owner-name search is still in progress; retry review after it finishes" } };
      }
      const candidate = ownerName.candidates.find(item => item.id === input.candidateId);
      if (!candidate) return { error: { status: 404, message: "Owner-name candidate was not found" } };
      if (input.decision === "approved" && !hasStrongOwnerNameEvidence(candidate)) {
        return { error: { status: 409, message: "Only a candidate with explicit owner-role evidence on a fetched page matching this business and location can be approved" } };
      }
      let contact: Contact | undefined;
      if (row.importedContactId) {
        const [linked] = await tx.select().from(contacts).where(and(
          eq(contacts.id, row.importedContactId),
          eq(contacts.userId, userId),
        )).for("update");
        contact = linked;
      }
      const switchingCandidate = input.decision === "rejected" ||
        (!!ownerName.selectedCandidateId && ownerName.selectedCandidateId !== candidate.id);
      if ((row.sourceData as any)?.purpose === CONTACT_OWNER_LOOKUP_PURPOSE &&
          (!contact || contact.archivedAt || !contactOwnerLookupMatches(row, contact))) {
        return { error: { status: 409, message: "The Contact's business details changed. Search again before saving this name." } };
      }
      if (switchingCandidate) {
        contact = await revokeOwnerNameContactInTransaction(tx, row, ownerName, contact);
      }
      const reviewed: OwnerNameResult = input.decision === "approved"
        ? {
          ...ownerName,
          status: "needs_review",
          selectedCandidateId: candidate.id,
          approvedAt: new Date().toISOString(),
          usePersonalName: input.usePersonalName,
          error: undefined,
        }
        : {
          ...ownerName,
          status: "excluded",
          selectedCandidateId: null,
          approvedAt: null,
          usePersonalName: false,
        };
      const evidence = salonRowEvidence(row);
      const [updated] = await tx.update(salonEnrichmentRows).set({
        evidence: { ...evidence, ownerName: reviewed },
        updatedAt: new Date(),
      }).where(eq(salonEnrichmentRows.id, row.id)).returning();
      return { row: updated, contact };
    });
  }

  async applySalonOwnerName(
    rowId: string,
    userId: string,
    input: SalonOwnerNameApplyInput,
  ): Promise<SalonOwnerNameMutationResult> {
    return db.transaction(async tx => {
      const [row] = await tx.select().from(salonEnrichmentRows).where(and(
        eq(salonEnrichmentRows.id, rowId),
        eq(salonEnrichmentRows.userId, userId),
      )).for("update");
      if (!row) return { error: { status: 404, message: "Salon row not found or not owned by you" } };
      const ownerName = ownerNameFromRow(row);
      if (salonOwnerNameMutationBlocked(ownerName)) {
        return { error: { status: 409, message: "Owner-name search is still in progress; retry apply after it finishes" } };
      }
      if (!row.importedContactId) {
        return { error: { status: 409, message: "Import the row before applying owner names to a contact" } };
      }
      const [contact] = await tx.select().from(contacts).where(and(
        eq(contacts.id, row.importedContactId),
        eq(contacts.userId, userId),
      )).for("update");
      if (!contact) return { error: { status: 404, message: "The linked contact is not owned by you" } };
      if ((row.sourceData as any)?.purpose === CONTACT_OWNER_LOOKUP_PURPOSE &&
          (contact.archivedAt || !contactOwnerLookupMatches(row, contact))) {
        return { error: { status: 409, message: "The Contact's business details changed. Search again before saving this name." } };
      }
      const candidate = isStrongApprovedOwnerCandidate(ownerName);
      if (!candidate) return { error: { status: 409, message: "Approve a strongly matched owner-role candidate before applying it" } };
      const notes = parseContactNotes(contact);
      const priorApplication = notes.salonOwnerNameApplication as SalonOwnerNameContactApplication | undefined;
      const hasExistingManualName = contactHasManualName(contact, priorApplication, row.id, candidate.id);
      if (hasExistingManualName && !input.overwriteExisting) {
        return { error: { status: 409, message: "The linked contact already has a manual name. Confirm overwriteExisting to replace it." } };
      }
      notes.salonOwnerNameApplication = {
        rowId: row.id,
        candidateId: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
      };
      const [updatedContact] = await tx.update(contacts).set({
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        useBusinessNameForEmail: input.usePersonalName ? "No" : "Yes",
        notes: JSON.stringify(notes),
      }).where(and(eq(contacts.id, contact.id), eq(contacts.userId, userId))).returning();
      const updatedOwnerName = { ...ownerName, usePersonalName: input.usePersonalName };
      const evidence = salonRowEvidence(row);
      const [updatedRow] = await tx.update(salonEnrichmentRows).set({
        evidence: { ...evidence, ownerName: updatedOwnerName },
        updatedAt: new Date(),
      }).where(eq(salonEnrichmentRows.id, row.id)).returning();
      return { row: updatedRow, contact: updatedContact };
    });
  }

  async revokeSalonOwnerName(rowId: string, userId: string): Promise<SalonOwnerNameMutationResult> {
    return db.transaction(async tx => {
      const [row] = await tx.select().from(salonEnrichmentRows).where(and(
        eq(salonEnrichmentRows.id, rowId),
        eq(salonEnrichmentRows.userId, userId),
      )).for("update");
      if (!row) return { error: { status: 404, message: "Salon row not found or not owned by you" } };
      const ownerName = ownerNameFromRow(row);
      if (salonOwnerNameMutationBlocked(ownerName)) {
        return { error: { status: 409, message: "Owner-name search is still in progress; retry revoke after it finishes" } };
      }
      let contact: Contact | undefined;
      if (row.importedContactId) {
        const [linked] = await tx.select().from(contacts).where(and(
          eq(contacts.id, row.importedContactId),
          eq(contacts.userId, userId),
        )).for("update");
        contact = await revokeOwnerNameContactInTransaction(tx, row, ownerName, linked);
      }
      const updatedOwnerName: OwnerNameResult = {
        ...ownerName,
        status: ownerName.candidates.length ? "needs_review" : "not_found",
        selectedCandidateId: null,
        approvedAt: null,
        usePersonalName: false,
      };
      const evidence = salonRowEvidence(row);
      const [updatedRow] = await tx.update(salonEnrichmentRows).set({
        evidence: { ...evidence, ownerName: updatedOwnerName },
        updatedAt: new Date(),
      }).where(eq(salonEnrichmentRows.id, row.id)).returning();
      return { row: updatedRow, contact };
    });
  }

  async seedSalonReportOwnerNames(seeds: Record<string, OwnerNameResult>, userId: string): Promise<number> {
    const seedByPlaceId = new Map(Object.entries(seeds).map(([id, seed]) => [id.trim().toLowerCase(), seed]));
    const placeIds = Array.from(seedByPlaceId.keys()).filter(Boolean);
    if (!placeIds.length) return 0;
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`salon-owner-seed:${userId}`}))`);
      const batches = await tx.select({ id: salonEnrichmentBatches.id })
        .from(salonEnrichmentBatches)
        .where(and(
          eq(salonEnrichmentBatches.userId, userId),
          eq(salonEnrichmentBatches.fileName, "salon-public-web-review"),
        ));
      if (!batches.length) return 0;
      const rows = await tx.select().from(salonEnrichmentRows).where(and(
        eq(salonEnrichmentRows.userId, userId),
        inArray(salonEnrichmentRows.batchId, batches.map(batch => batch.id)),
      )).for("update");
      let updatedCount = 0;
      for (const row of rows) {
        const evidence = row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
          ? row.evidence as Record<string, unknown>
          : {};
        const seed = seedByPlaceId.get(row.placeId?.trim().toLowerCase() || "");
        if (!shouldStageBundledOwnerNameOnRow(row, !!seed) || !seed) continue;
        // Bundled report evidence is reviewable but never treated as an
        // approval, nor as an opt-in to personalize an imported contact.
        const staged: OwnerNameResult = {
          ...seed,
          status: seed.candidates.length ? "needs_review" : "not_found",
          selectedCandidateId: null,
          approvedAt: null,
          usePersonalName: false,
          providerCalls: 0,
        };
        await tx.update(salonEnrichmentRows).set({
          evidence: mergeBundledOwnerNameEvidence(evidence, staged),
          updatedAt: new Date(),
        }).where(eq(salonEnrichmentRows.id, row.id));
        updatedCount++;
      }
      return updatedCount;
    });
  }

  async getSalonSearchReportLinks(
    contactIds: string[],
    userId: string,
  ): Promise<Record<string, { dealId: string | null; dealStage: string | null; sequenceStatus: string | null }>> {
    const ids = Array.from(new Set(contactIds.filter(Boolean)));
    const result: Record<string, { dealId: string | null; dealStage: string | null; sequenceStatus: string | null }> = {};
    for (const id of ids) result[id] = { dealId: null, dealStage: null, sequenceStatus: null };
    if (!ids.length) return result;

    const linkedDeals = await db.select({
      contactId: deals.contactId,
      dealId: deals.id,
      dealStage: deals.stage,
    }).from(deals)
      .innerJoin(contacts, eq(deals.contactId, contacts.id))
      .where(and(
        eq(deals.userId, userId),
        eq(contacts.userId, userId),
        inArray(deals.contactId, ids),
      ))
      .orderBy(desc(deals.createdAt));
    for (const deal of linkedDeals) {
      if (!deal.contactId || !result[deal.contactId] || result[deal.contactId].dealId) continue;
      result[deal.contactId].dealId = deal.dealId;
      result[deal.contactId].dealStage = deal.dealStage;
    }

    const sequenceLogs = await db.select({
      contactId: emailSequenceLogs.contactId,
      status: emailSequenceLogs.status,
    }).from(emailSequenceLogs)
      .innerJoin(contacts, eq(emailSequenceLogs.contactId, contacts.id))
      .where(and(
        eq(emailSequenceLogs.userId, userId),
        eq(contacts.userId, userId),
        inArray(emailSequenceLogs.contactId, ids),
      ))
      .orderBy(desc(emailSequenceLogs.createdAt));
    for (const log of sequenceLogs) {
      if (!result[log.contactId] || result[log.contactId].sequenceStatus) continue;
      result[log.contactId].sequenceStatus = log.status;
    }
    return result;
  }

  async getSalonReportSendRejection(
    contactId: string,
    ownerId: string,
    contactOwnerId: string,
    contactEmail: string | null,
  ): Promise<string | null> {
    const reportRows = await db.select({
      row: salonEnrichmentRows,
      batchUserId: salonEnrichmentBatches.userId,
      fileName: salonEnrichmentBatches.fileName,
    }).from(salonEnrichmentRows)
      .innerJoin(salonEnrichmentBatches, eq(salonEnrichmentRows.batchId, salonEnrichmentBatches.id))
      .where(eq(salonEnrichmentRows.importedContactId, contactId));
    for (const result of reportRows) {
      if (result.batchUserId !== ownerId) return "Salon report batch is no longer owned by the sequence owner";
      if (directoryEligibility(result.row).blocked) return "Grooming suitability is unconfirmed or this business was excluded";
      if (result.fileName !== "salon-public-web-review") {
        if (result.row.reviewStatus !== "approved" || result.row.identityMatchStatus !== "strong" ||
          !importableSalonEmail(result.row) || normalizeEmail(importableSalonEmail(result.row)) !== normalizeEmail(contactEmail)) {
          return "Lead email approval or attribution no longer matches the linked contact's current address.";
        }
        continue;
      }
      const rejection = salonReportSendRejection(
        result.row,
        { userId: contactOwnerId, email: contactEmail },
        ownerId,
      );
      if (rejection) return rejection;
    }
    const discovered = await db.select().from(leadDiscoveryResults)
      .where(eq(leadDiscoveryResults.importedContactId, contactId));
    if (discovered.some(row => row.userId !== ownerId || directoryEligibility(row).blocked)) {
      return "Source listing grooming suitability is unconfirmed or excluded";
    }
    return null;
  }

  async updateSalonEnrichmentRow(
    id: string,
    data: Partial<SalonEnrichmentRow>,
    userId: string | null,
    options: { rejectIdentityDuringEnrichment?: boolean } = {},
  ): Promise<SalonEnrichmentRow | undefined> {
    return db.transaction(async tx => {
      const where = userId === null
        ? eq(salonEnrichmentRows.id, id)
        : and(eq(salonEnrichmentRows.id, id), eq(salonEnrichmentRows.userId, userId));
      const [row] = await tx.select().from(salonEnrichmentRows).where(where).for("update");
      if (!row) return undefined;

      const identityChanged = salonIdentityFieldsChanged(row, data);
      const ownerName = ownerNameFromRow(row);
      if (salonIdentityEditBlocked(
        row.status,
        ownerName,
        identityChanged,
        options.rejectIdentityDuringEnrichment ?? false,
      )) {
        throw new SalonOwnerNameStorageConflict(
          ownerName.status === "searching"
            ? "Business identity cannot be edited while owner-name lookup is in progress"
            : "Business identity cannot be edited while salon enrichment is in progress",
        );
      }

      if (identityChanged && row.importedContactId) {
        const contactWhere = userId === null
          ? eq(contacts.id, row.importedContactId)
          : and(eq(contacts.id, row.importedContactId), eq(contacts.userId, row.userId));
        const [linked] = await tx.select().from(contacts).where(contactWhere).for("update");
        await revokeOwnerNameContactInTransaction(tx, row, ownerName, linked);
      }

      const updates: Partial<SalonEnrichmentRow> = { ...data, updatedAt: new Date() };
      const currentEvidence = salonRowEvidence(row);
      if (data.evidence !== undefined) {
        const incomingEvidence = data.evidence && typeof data.evidence === "object" && !Array.isArray(data.evidence)
          ? data.evidence as Record<string, unknown>
          : {};
        updates.evidence = mergeSalonOwnerNameMetadata(incomingEvidence, currentEvidence);
      }
      if (identityChanged) {
        const evidence = updates.evidence && typeof updates.evidence === "object" && !Array.isArray(updates.evidence)
          ? updates.evidence as Record<string, unknown>
          : currentEvidence;
        updates.evidence = resetSalonOwnerNameForIdentityChange(evidence);
      }

      const [updated] = await tx.update(salonEnrichmentRows).set(updates).where(eq(salonEnrichmentRows.id, row.id)).returning();
      return updated;
    });
  }

  async markSalonRowsForReview(ids: string[], decision: "approved" | "rejected", userId: string | null): Promise<number> {
    if (!ids.length) return 0;
    const owner = userId === null ? undefined : eq(salonEnrichmentRows.userId, userId);
    const where = owner ? and(inArray(salonEnrichmentRows.id, ids), owner) : inArray(salonEnrichmentRows.id, ids);
    const result = await db.update(salonEnrichmentRows).set({
      reviewStatus: decision,
      updatedAt: new Date(),
    }).where(where);
    return result.rowCount ?? 0;
  }

  async resetSalonRowsForRetry(ids: string[], userId: string | null): Promise<number> {
    if (!ids.length) return 0;
    return db.transaction(async tx => {
      const owner = userId === null ? undefined : eq(salonEnrichmentRows.userId, userId);
      const where = owner ? and(inArray(salonEnrichmentRows.id, ids), owner) : inArray(salonEnrichmentRows.id, ids);
      const rows = await tx.select().from(salonEnrichmentRows).where(where).for("update");
      if (rows.some(row => salonOwnerNameMutationBlocked(ownerNameFromRow(row)))) {
        throw new SalonOwnerNameStorageConflict("An owner-name lookup is still in progress; retry after it finishes");
      }
      let updatedCount = 0;
      for (const row of rows) {
        const ownerName = ownerNameFromRow(row);
        let contact: Contact | undefined;
        if (row.importedContactId) {
          const [linked] = await tx.select().from(contacts).where(and(
            eq(contacts.id, row.importedContactId),
            eq(contacts.userId, row.userId),
          )).for("update");
          contact = linked;
          await revokeOwnerNameContactInTransaction(tx, row, ownerName, contact);
        }
        const evidence = salonRowEvidence(row);
        const resetOwnerName: OwnerNameResult = ownerName.selectedCandidateId || ownerName.approvedAt
          ? {
            ...ownerName,
            status: ownerName.candidates.length ? "needs_review" : "not_searched",
            selectedCandidateId: null,
            approvedAt: null,
            usePersonalName: false,
          }
          : ownerName;
        await tx.update(salonEnrichmentRows).set({
          ...(row.importedContactId ? {} : {
            status: "pending",
            reviewStatus: "pending",
            lastError: null,
            processedAt: null,
          }),
          evidence: { ...evidence, ownerName: resetOwnerName },
          updatedAt: new Date(),
        }).where(eq(salonEnrichmentRows.id, row.id));
        updatedCount++;
      }
      return updatedCount;
    });
  }

  async refreshSalonEnrichmentBatchCounts(batchId: string, userId: string | null): Promise<SalonEnrichmentBatch | undefined> {
    const batch = await this.getSalonEnrichmentBatch(batchId, userId);
    if (!batch) return undefined;
    const ownerClause = userId === null ? undefined : eq(salonEnrichmentRows.userId, userId);
    const where = ownerClause
      ? and(eq(salonEnrichmentRows.batchId, batchId), ownerClause)
      : eq(salonEnrichmentRows.batchId, batchId);
    const [counts] = await db.select({
      totalRows: sql<number>`count(*)::int`,
      processedRows: sql<number>`count(*) filter (where ${salonEnrichmentRows.status} in ('enriched','failed','rejected','imported'))::int`,
      enrichedRows: sql<number>`count(*) filter (where ${salonEnrichmentRows.status} in ('enriched','imported'))::int`,
      needsReviewRows: sql<number>`count(*) filter (where ${salonEnrichmentRows.reviewStatus} = 'needs_review')::int`,
      approvedRows: sql<number>`count(*) filter (where ${salonEnrichmentRows.reviewStatus} = 'approved')::int`,
      importedRows: sql<number>`count(*) filter (where ${salonEnrichmentRows.status} = 'imported')::int`,
      usedSerpCalls: sql<number>`coalesce(sum(${salonEnrichmentRows.serpCallsUsed}), 0)::int`,
    }).from(salonEnrichmentRows).where(where);
    return await this.updateSalonEnrichmentBatch(batchId, {
      ...counts,
    }, userId);
  }

  async importApprovedSalonRows(batchId: string, rowIds: string[] | undefined, userId: string | null): Promise<{ imported: SalonEnrichmentRow[]; skipped: Array<{ rowId: string; reason: string }> }> {
    const result = await db.transaction(async (tx) => {
      // Serialize imports for this batch. The contact insert and source-row
      // marker then commit together, so retries cannot create orphan duplicates.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`salon-import:${batchId}`}))`);
      const batchWhere = userId === null
        ? eq(salonEnrichmentBatches.id, batchId)
        : and(eq(salonEnrichmentBatches.id, batchId), eq(salonEnrichmentBatches.userId, userId));
      const [batch] = await tx.select().from(salonEnrichmentBatches).where(batchWhere);
      if (!batch) return { imported: [] as SalonEnrichmentRow[], skipped: [{ rowId: batchId, reason: "Batch not found" }], ownerId: null };

      const ownerId = batch.userId;
      // Serialize imports across all lists for this CRM owner, not just one batch.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`crm-import:${ownerId}`}))`);
      const rows = await tx.select().from(salonEnrichmentRows).where(and(
        eq(salonEnrichmentRows.batchId, batchId),
        eq(salonEnrichmentRows.userId, ownerId),
      )).for("update");
      const selected = rows.filter(row =>
        (!rowIds || rowIds.includes(row.id)) &&
        row.reviewStatus === "approved" &&
        row.status === "enriched" &&
        row.identityMatchStatus === "strong",
      );
      const existingContacts = await tx.select().from(contacts).where(eq(contacts.userId, ownerId));
      const imported: SalonEnrichmentRow[] = [];
      const skipped: Array<{ rowId: string; reason: string }> = [];

      for (const row of selected) {
        if (directoryEligibility(row).blocked) {
          skipped.push({ rowId: row.id, reason: "Grooming suitability is unconfirmed or excluded" });
          continue;
        }
        if (row.importedContactId) {
          skipped.push({ rowId: row.id, reason: "Already imported" });
          continue;
        }
        if (salonOwnerNameImportBlocked(ownerNameFromRow(row))) {
          skipped.push({ rowId: row.id, reason: "Owner-name lookup is still in progress" });
          continue;
        }
        const verifiedEmail = importableSalonEmail(row);
        if (!verifiedEmail) {
          skipped.push({ rowId: row.id, reason: "No approved, importable email with complete evidence" });
          continue;
        }
        const duplicates = salonCrmDuplicates(row,existingContacts,verifiedEmail);
        if (duplicates.length) {
          await tx.update(salonEnrichmentRows).set({
            duplicateMetadata: { contactIds: duplicates.map(contact => contact.id), reason: "Existing contact match" },
            updatedAt: new Date(),
          }).where(eq(salonEnrichmentRows.id, row.id));
          skipped.push({ rowId: row.id, reason: "Potential duplicate contact" });
          continue;
        }

        const evidence = row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
          ? row.evidence as Record<string, unknown>
          : {};
        const ownerName = evidence.ownerName as OwnerNameResult | undefined;
        const approvedOwner = salonOwnerNameForImport(ownerName);
        const contactNotes: Record<string, unknown> = {
          enrichmentRowId: row.id,
          placeId: row.placeId,
          evidence: row.evidence,
          confidence: row.confidence,
        };
        if (approvedOwner.candidate) {
          contactNotes.salonOwnerNameApplication = {
            rowId: row.id,
            candidateId: approvedOwner.candidate.id,
            firstName: approvedOwner.firstName,
            lastName: approvedOwner.lastName,
          };
        }
        const [contact] = await tx.insert(contacts).values({
          userId: ownerId,
          firstName: approvedOwner.firstName,
          lastName: approvedOwner.lastName,
          useBusinessNameForEmail: approvedOwner.useBusinessNameForEmail,
          company: row.businessName,
          email: verifiedEmail,
          phone: row.phone,
          address: row.address1 || row.address,
          city: row.city,
          state: row.state,
          zipCode: row.zipCode,
          usesSoftware: row.usesSoftware || "Unknown",
          currentSoftware: row.currentSoftware,
          hasWebsite: row.hasWebsite || "Unknown",
          websiteUrl: row.websiteUrl,
          contactRequestFormUrl: row.contactRequestFormUrl,
          bookingSoftwareUrl: row.bookingUrl,
          leadSource: "Google Search",
          businessType: "salon",
          sequenceTrack: row.audienceTrack || "directory_general",
          notes: JSON.stringify(contactNotes),
          lastContactDate: new Date(),
        }).returning();
        await tx.insert(activities).values({
          userId: ownerId,
          type: "contact_added",
          description: `New contact for ${row.businessName} added from salon enrichment`,
          contactId: contact.id,
        });
        const [updated] = await tx.update(salonEnrichmentRows).set({
          importedContactId: contact.id,
          status: "imported",
          updatedAt: new Date(),
        }).where(and(
          eq(salonEnrichmentRows.id, row.id),
          isNull(salonEnrichmentRows.importedContactId),
        )).returning();
        if (!updated) throw new Error(`Row ${row.id} was imported concurrently`);
        imported.push(updated);
        existingContacts.push(contact);
      }
      return { imported, skipped, ownerId };
    });
    if (result.ownerId) await this.refreshSalonEnrichmentBatchCounts(batchId, result.ownerId);
    return { imported: result.imported, skipped: result.skipped };
  }

  // SERP Usage Tracking
  async getSerpUsage(monthYear: string): Promise<SerpUsage | undefined> {
    const [usage] = await db
      .select()
      .from(serpUsage)
      .where(eq(serpUsage.monthYear, monthYear));
    return usage;
  }

  private async getOrCreateSerpUsageLocked(tx: Pick<typeof db, "select" | "insert">, monthYear: string): Promise<SerpUsage> {
    const [existing] = await tx.select().from(serpUsage).where(eq(serpUsage.monthYear, monthYear));
    if (existing) return existing;
    const [previous] = await tx.select({
      monthlyQuota: serpUsage.monthlyQuota, hardStopAt: serpUsage.hardStopAt,
    }).from(serpUsage).where(lt(serpUsage.monthYear, monthYear)).orderBy(desc(serpUsage.monthYear)).limit(1);
    const budget = savedSerpBudget(previous);
    const [created] = await tx
      .insert(serpUsage)
      .values({ monthYear, usedCredits: 0, ...budget })
      .returning();
    return created;
  }

  async getOrCreateSerpUsage(monthYear: string): Promise<SerpUsage> {
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('serp-call-reservation'))`);
      return this.getOrCreateSerpUsageLocked(tx, monthYear);
    });
  }

  async incrementSerpUsage(monthYear: string): Promise<SerpUsage> {
    await this.getOrCreateSerpUsage(monthYear);
    const [updated] = await db
      .update(serpUsage)
      .set({ usedCredits: sql`${serpUsage.usedCredits} + 1` })
      .where(eq(serpUsage.monthYear, monthYear))
      .returning();
    return updated;
  }

  async reserveSerpCall(monthYear: string, maxCallsPerHour: number): Promise<string | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('serp-call-reservation'))`);
      const usage = await this.getOrCreateSerpUsageLocked(tx, monthYear);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [hourly] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(serpCallReservations)
        .where(gte(serpCallReservations.createdAt, oneHourAgo));
      if (usage.usedCredits >= usage.hardStopAt || hourly.count >= maxCallsPerHour) return null;
      await tx.update(serpUsage)
        .set({ usedCredits: sql`${serpUsage.usedCredits} + 1` })
        .where(eq(serpUsage.monthYear, monthYear));
      const [reservation] = await tx.insert(serpCallReservations).values({}).returning();
      return reservation.id;
    });
  }

  async releaseSerpCall(reservationId: string, monthYear: string): Promise<void> {
    await db.transaction(async (tx) => {
      const deleted = await tx.delete(serpCallReservations)
        .where(eq(serpCallReservations.id, reservationId))
        .returning();
      if (deleted.length) {
        await tx.update(serpUsage)
          .set({ usedCredits: sql`greatest(${serpUsage.usedCredits} - 1, 0)` })
          .where(eq(serpUsage.monthYear, monthYear));
      }
    });
  }

  async getNextSerpCallAt(maxCallsPerHour: number): Promise<string> {
    const now = Date.now();
    // The Nth newest reservation must expire before another call at limit N.
    const [reservation] = await db.select({ createdAt: serpCallReservations.createdAt })
      .from(serpCallReservations)
      .where(gte(serpCallReservations.createdAt, new Date(now - 60 * 60 * 1000)))
      .orderBy(desc(serpCallReservations.createdAt)).offset(maxCallsPerHour - 1).limit(1);
    return new Date(reservation ? reservation.createdAt.getTime() + 60 * 60 * 1000 + 1000 : now + 60000).toISOString();
  }

  async updateSerpQuota(monthYear: string, quota: number, hardStopAt: number): Promise<SerpUsage | undefined> {
    const budget = savedSerpBudget({ monthlyQuota: quota, hardStopAt });
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('serp-call-reservation'))`);
      await this.getOrCreateSerpUsageLocked(tx, monthYear);
      const [updated] = await tx.update(serpUsage).set(budget)
        .where(eq(serpUsage.monthYear, monthYear)).returning();
      return updated;
    });
  }

  // SERP Cache
  async getSerpCache(zipCode: string, queryTemplate: string, state: string, maxAgeDays: number = 30): Promise<SerpCache | undefined> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    const [cached] = await db
      .select()
      .from(serpCache)
      .where(and(
        eq(serpCache.zipCode, zipCode),
        eq(serpCache.queryTemplate, queryTemplate),
        eq(serpCache.state, state),
        gte(serpCache.createdAt, cutoffDate)
      ));
    return cached;
  }

  async createSerpCache(zipCode: string, queryTemplate: string, state: string, results: any): Promise<SerpCache> {
    const [created] = await db
      .insert(serpCache)
      .values({ zipCode, queryTemplate, state, resultsJson: results })
      .returning();
    return created;
  }

  async clearOldSerpCache(maxAgeDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    const result = await db
      .delete(serpCache)
      .where(lte(serpCache.createdAt, cutoffDate));
    return 0;
  }

  // Lead Discovery Config
  async getLeadDiscoveryConfig(configKey: string): Promise<LeadDiscoveryConfig | undefined> {
    const [config] = await db
      .select()
      .from(leadDiscoveryConfig)
      .where(eq(leadDiscoveryConfig.configKey, configKey));
    return config;
  }

  async getOrCreateLeadDiscoveryConfig(configKey: string): Promise<LeadDiscoveryConfig> {
    const existing = await this.getLeadDiscoveryConfig(configKey);
    if (existing) return existing;
    
    const [created] = await db
      .insert(leadDiscoveryConfig)
      .values({
        configKey,
        queriesPerZip: 2,
        maxZipsPerRun: 3,
        maxRunsPerDay: 1,
        maxSerpCallsPerHour: 5,
        enableThirdQuery: "false",
        planType: "free"
      })
      .returning();
    return created;
  }

  async updateLeadDiscoveryConfig(configKey: string, updates: Partial<LeadDiscoveryConfig>): Promise<LeadDiscoveryConfig | undefined> {
    await this.getOrCreateLeadDiscoveryConfig(configKey);
    const [updated] = await db
      .update(leadDiscoveryConfig)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(leadDiscoveryConfig.configKey, configKey))
      .returning();
    return updated;
  }

  async getRunsToday(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const jobs = await db
      .select()
      .from(leadDiscoveryJobs)
      .where(and(
        eq(leadDiscoveryJobs.userId, userId),
        gte(leadDiscoveryJobs.createdAt, today)
      ));
    return jobs.length;
  }

  // ─── Deal Tasks ───────────────────────────────────────────────────────────
  async getDealTasks(dealId: string): Promise<DealTask[]> {
    return await db.select().from(dealTasks)
      .where(eq(dealTasks.dealId, dealId))
      .orderBy(dealTasks.createdAt);
  }

  async getDealTask(id: string): Promise<DealTask | undefined> {
    const [task] = await db.select().from(dealTasks).where(eq(dealTasks.id, id));
    return task;
  }

  async createDealTask(task: Omit<InsertDealTask, 'dueDate' | 'reminderDatetime'> & { dueDate?: Date | null; reminderDatetime?: Date | null }): Promise<DealTask> {
    const [created] = await db.insert(dealTasks).values(task as any).returning();
    return created;
  }

  async updateDealTask(id: string, updates: Partial<DealTask>): Promise<DealTask | undefined> {
    const [updated] = await db.update(dealTasks).set(updates as any).where(eq(dealTasks.id, id)).returning();
    return updated;
  }

  async deleteDealTask(id: string): Promise<boolean> {
    const result = await db.delete(dealTasks).where(eq(dealTasks.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getPendingReminderTasks() {
    const now = new Date();
    const rows = await db
      .select({
        task: dealTasks,
        dealTitle: deals.title,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        contactPhone: contacts.phoneCell,
        assignedUserFirstName: users.firstName,
        assignedUserLastName: users.lastName,
      })
      .from(dealTasks)
      .leftJoin(deals, eq(dealTasks.dealId, deals.id))
      .leftJoin(contacts, eq(dealTasks.contactId, contacts.id))
      .leftJoin(users, eq(dealTasks.assignedTo, users.id))
      .where(
        and(
          eq(dealTasks.completed, "false"),
          eq(dealTasks.reminderSent, "false"),
          lte(dealTasks.reminderDatetime, now),
        )
      );
    return rows.map(r => ({
      ...r.task,
      dealTitle: r.dealTitle ?? "",
      contactFirstName: r.contactFirstName ?? null,
      contactLastName: r.contactLastName ?? null,
      contactPhone: r.contactPhone ?? null,
      assignedUserFirstName: r.assignedUserFirstName ?? null,
      assignedUserLastName: r.assignedUserLastName ?? null,
    }));
  }

  async createCommission(data: InsertCommission): Promise<Commission> {
    const [commission] = await db.insert(commissions).values(data).returning();
    return commission;
  }

  async getCommissions(userId: string | null): Promise<Commission[]> {
    if (userId) {
      return db.select().from(commissions).where(eq(commissions.userId, userId)).orderBy(desc(commissions.confirmedAt));
    }
    return db.select().from(commissions).orderBy(desc(commissions.confirmedAt));
  }

  async createMonthlyPayment(data: InsertCommissionMonthlyPayment): Promise<CommissionMonthlyPayment> {
    const [payment] = await db.insert(commissionMonthlyPayments).values(data).returning();
    return payment;
  }

  async getMonthlyPaymentsForCommission(commissionId: string): Promise<CommissionMonthlyPayment[]> {
    return db.select().from(commissionMonthlyPayments)
      .where(eq(commissionMonthlyPayments.commissionId, commissionId))
      .orderBy(commissionMonthlyPayments.periodNumber);
  }

  async getMonthlyPayments(userId: string | null): Promise<CommissionMonthlyPayment[]> {
    if (userId) {
      return db.select().from(commissionMonthlyPayments)
        .where(eq(commissionMonthlyPayments.userId, userId))
        .orderBy(desc(commissionMonthlyPayments.paidAt));
    }
    return db.select().from(commissionMonthlyPayments).orderBy(desc(commissionMonthlyPayments.paidAt));
  }

  async previewPayroll(userId: string, startDate: Date, endDate: Date): Promise<PayrollPreviewItem[]> {
    const comms = await db
      .select({
        id: commissions.id,
        planName: commissions.planName,
        upfrontAmount: commissions.upfrontAmount,
        confirmedAt: commissions.confirmedAt,
        dealTitle: deals.title,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
      })
      .from(commissions)
      .innerJoin(deals, eq(commissions.dealId, deals.id))
      .leftJoin(contacts, eq(deals.contactId, contacts.id))
      .where(and(
        eq(commissions.userId, userId),
        gte(commissions.confirmedAt, startDate),
        lte(commissions.confirmedAt, endDate),
      ));

    const monthly = await db
      .select({
        id: commissionMonthlyPayments.id,
        commissionId: commissionMonthlyPayments.commissionId,
        amount: commissionMonthlyPayments.amount,
        periodNumber: commissionMonthlyPayments.periodNumber,
        paidAt: commissionMonthlyPayments.paidAt,
        dealTitle: deals.title,
        planName: commissions.planName,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
      })
      .from(commissionMonthlyPayments)
      .innerJoin(deals, eq(commissionMonthlyPayments.dealId, deals.id))
      .innerJoin(commissions, eq(commissionMonthlyPayments.commissionId, commissions.id))
      .leftJoin(contacts, eq(deals.contactId, contacts.id))
      .where(and(
        eq(commissionMonthlyPayments.userId, userId),
        gte(commissionMonthlyPayments.paidAt, startDate),
        lte(commissionMonthlyPayments.paidAt, endDate),
      ));

    const buildContactName = (first: string | null | undefined, last: string | null | undefined) =>
      [first, last].filter(Boolean).join(" ").trim() || "Unknown Contact";

    const items: PayrollPreviewItem[] = [
      ...comms.map(c => ({
        tempId: `c_${c.id}`,
        commissionId: c.id,
        monthlyPaymentId: null,
        type: "upfront" as const,
        date: c.confirmedAt!.toISOString(),
        contactName: buildContactName(c.contactFirstName, c.contactLastName),
        dealTitle: c.dealTitle,
        planName: c.planName,
        originalAmount: c.upfrontAmount,
      })),
      ...monthly.map(m => ({
        tempId: `m_${m.id}`,
        commissionId: m.commissionId,
        monthlyPaymentId: m.id,
        type: "recurring" as const,
        date: m.paidAt.toISOString(),
        contactName: buildContactName(m.contactFirstName, m.contactLastName),
        dealTitle: m.dealTitle,
        planName: m.planName,
        originalAmount: m.amount,
      })),
    ];

    items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return items;
  }

  async createPayrollPeriod(
    data: Omit<InsertPayrollPeriod, "totalAmount">,
    lineItems: PayrollLineItemInput[],
  ): Promise<{ period: PayrollPeriod; items: PayrollLineItem[] }> {
    const totalAmount = lineItems
      .reduce((sum, item) => sum + parseFloat(item.adjustedAmount || "0"), 0)
      .toFixed(2);

    const [period] = await db.insert(payrollPeriods).values({ ...data, totalAmount }).returning();

    const insertedItems: PayrollLineItem[] = [];
    for (const item of lineItems) {
      const [inserted] = await db.insert(payrollLineItems).values({
        payrollPeriodId: period.id,
        commissionId: item.commissionId ?? null,
        monthlyPaymentId: item.monthlyPaymentId ?? null,
        type: item.type,
        contactName: item.contactName,
        dealTitle: item.dealTitle,
        planName: item.planName,
        originalAmount: item.originalAmount,
        adjustedAmount: item.adjustedAmount,
        date: item.date,
        notes: item.notes ?? null,
      }).returning();
      insertedItems.push(inserted);
    }

    return { period, items: insertedItems };
  }

  async getPayrollPeriods(userId: string | null): Promise<PayrollPeriodFull[]> {
    const periods = await db
      .select()
      .from(payrollPeriods)
      .where(userId ? eq(payrollPeriods.userId, userId) : undefined)
      .orderBy(desc(payrollPeriods.createdAt));

    const enriched: PayrollPeriodFull[] = [];
    for (const period of periods) {
      const items = await db
        .select()
        .from(payrollLineItems)
        .where(eq(payrollLineItems.payrollPeriodId, period.id))
        .orderBy(payrollLineItems.date);

      const userRows = await db.select().from(users).where(eq(users.id, period.userId)).limit(1);
      const u = userRows[0];
      const salespersonName = u
        ? [`${u.firstName ?? ""}`, `${u.lastName ?? ""}`].join(" ").trim() || u.email || period.userId
        : period.userId;
      const salespersonEmail = u?.email || "";

      enriched.push({ ...period, items, salespersonName, salespersonEmail });
    }

    return enriched;
  }

  async getPayrollPeriod(id: string): Promise<PayrollPeriodFull | null> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, id)).limit(1);
    if (!period) return null;

    const items = await db
      .select()
      .from(payrollLineItems)
      .where(eq(payrollLineItems.payrollPeriodId, period.id))
      .orderBy(payrollLineItems.date);

    const userRows = await db.select().from(users).where(eq(users.id, period.userId)).limit(1);
    const u = userRows[0];
    const salespersonName = u
      ? [`${u.firstName ?? ""}`, `${u.lastName ?? ""}`].join(" ").trim() || u.email || period.userId
      : period.userId;
    const salespersonEmail = u?.email || "";

    return { ...period, items, salespersonName, salespersonEmail };
  }

  async updatePayrollLineItem(id: string, adjustedAmount: string, notes?: string): Promise<PayrollLineItem> {
    const [updated] = await db
      .update(payrollLineItems)
      .set({ adjustedAmount, ...(notes !== undefined ? { notes } : {}) })
      .where(eq(payrollLineItems.id, id))
      .returning();
    return updated;
  }

  async updatePayrollPeriod(
    id: string,
    data: Partial<Pick<PayrollPeriod, "status" | "notes" | "sentAt" | "sentToEmails" | "totalAmount">>,
  ): Promise<PayrollPeriod> {
    const [updated] = await db.update(payrollPeriods).set(data).where(eq(payrollPeriods.id, id)).returning();
    return updated;
  }

  async getSerpCallsInLastHour(): Promise<number> {
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    const [result] = await db.select({ count: sql<number>`count(*)::int` })
      .from(serpCallReservations)
      .where(gte(serpCallReservations.createdAt, oneHourAgo));
    return result.count;
  }
}

export const storage = new DatabaseStorage();
