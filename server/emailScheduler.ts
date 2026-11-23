import { storage } from "./storage";
import { sendSequenceEmail } from "./sendgrid";
import { claimRecipientSend, recordRecipientOutcome, retainedRecipientEvidence } from "./recipientOutreach";
import type { Contact, EmailSequence, EmailSequenceLog } from "@shared/schema";

/**
 * Email Sequence Scheduler
 * This runs periodically to check and send automated email sequences
 * 
 * IMPORTANT: Requires Reserved VM deployment for 24/7 operation
 * 
 * TIMEZONE: All scheduled times are interpreted as Eastern Time (America/New_York)
 * This automatically handles Daylight Saving Time changes.
 */

const TIMEZONE = "America/New_York";

/**
 * Get current time in Eastern timezone
 */
function getNowInEastern(): Date {
  const now = new Date();
  const easternString = now.toLocaleString("en-US", { timeZone: TIMEZONE });
  return new Date(easternString);
}

/**
 * Convert a date and time to Eastern timezone for comparison
 * The scheduledDate stores the date the user picked, and scheduledTime is the time in Eastern
 */
function getScheduledDateTimeInEastern(scheduledDate: Date, scheduledTime: string): Date {
  const year = scheduledDate.getUTCFullYear();
  const month = scheduledDate.getUTCMonth();
  const day = scheduledDate.getUTCDate();
  
  const [hours, minutes] = scheduledTime.split(':').map(Number);
  
  const utcDate = new Date(Date.UTC(year, month, day, hours, minutes, 0));
  const easternOffset = getEasternOffset(utcDate);
  
  return new Date(utcDate.getTime() + easternOffset * 60 * 1000);
}

/**
 * Get the offset in minutes between UTC and Eastern time for a given date
 * This handles DST automatically
 */
function getEasternOffset(date: Date): number {
  const utcString = date.toLocaleString("en-US", { timeZone: "UTC" });
  const easternString = date.toLocaleString("en-US", { timeZone: TIMEZONE });
  
  const utcDate = new Date(utcString);
  const easternDate = new Date(easternString);
  
  return (utcDate.getTime() - easternDate.getTime()) / (60 * 1000);
}

/**
 * Check if it's time to send Sequence 1 for a contact
 */
function shouldSendSequence1(
  sequence: EmailSequence,
  existingLogs: EmailSequenceLog[]
): boolean {
  if (existingLogs.some(log => log.sequenceNumber === 1)) {
    return false;
  }

  if (!sequence.scheduledDate || !sequence.scheduledTime) {
    return false;
  }

  const now = new Date();
  
  const scheduledDate = sequence.scheduledDate instanceof Date 
    ? sequence.scheduledDate 
    : new Date(sequence.scheduledDate);
  
  const scheduledDateTime = getScheduledDateTimeInEastern(scheduledDate, sequence.scheduledTime);
  
  return now >= scheduledDateTime;
}

/**
 * Check if it's time to send a follow-up sequence (2-5)
 * Stops if the contact has replied (has inbox messages)
 */
async function shouldSendFollowUpSequence(
  sequenceNumber: number,
  daysAfterNoReply: number | null,
  existingLogs: EmailSequenceLog[],
  contactId: string
): Promise<boolean> {
  // Already sent this sequence
  if (existingLogs.some(log => log.sequenceNumber === sequenceNumber)) {
    return false;
  }

  // Check if previous sequence was sent
  const previousSequenceLog = existingLogs.find(
    log => log.sequenceNumber === sequenceNumber - 1
  );

  if (!previousSequenceLog || !previousSequenceLog.sentAt) {
    return false;
  }

  // Stop if the contact has replied to a previous sequence (log-level flag)
  if (previousSequenceLog.emailResponseReceived === "true") {
    return false;
  }

  // Stop if the contact has any inbox messages (actual replies)
  const inboxMessages = await storage.getInboxMessages(null, contactId);
  if (inboxMessages.length > 0) {
    console.log(`Contact ${contactId} has replied — stopping automation at Sequence ${sequenceNumber}`);
    return false;
  }

  const daysRequired = daysAfterNoReply ?? 7;
  const daysSincePrevious = Math.floor(
    (new Date().getTime() - new Date(previousSequenceLog.sentAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return daysSincePrevious >= daysRequired;
}

/**
 * After a sequence is successfully sent, auto-schedule the next one in the chain.
 * Only applies to the two auto-track types (no_software, uses_competitor).
 * Sequences 2→3→4→5 are created automatically; the chain stops if the contact replies.
 */
export async function scheduleNextSequence(
  sentLog: EmailSequenceLog,
  sentSequence: EmailSequence,
  sentAt: Date
): Promise<void> {
  // Custom track emails are one-off — no chaining
  if (sentSequence.sequenceTrack.endsWith("_custom") || sentSequence.sequenceTrack === "custom") return;

  const nextNumber = sentSequence.sequenceNumber + 1;
  if (nextNumber > 5) return;
  const [run] = await retainedRecipientEvidence([sentLog]);

  // Stop the chain if the contact has already replied
  const inboxMessages = await storage.getInboxMessages(null, sentLog.contactId);
  const runStartedAt = run.sequenceRunStartedAt ? new Date(run.sequenceRunStartedAt).getTime() : null;
  if (inboxMessages.some(message => runStartedAt === null || !message.receivedAt ||
    new Date(message.receivedAt).getTime() >= runStartedAt)) {
    console.log(`[AutoChain] Contact ${sentLog.contactId} has replied — not scheduling Sequence ${nextNumber}`);
    return;
  }

  // Past runs must not suppress the new run's follow-ups; duplicates within a run still do.
  const existingLogs = await storage.getEmailSequenceLogs(null, sentLog.contactId);
  const existingEvidence = run.sequenceRunId ? await retainedRecipientEvidence(existingLogs) : existingLogs;
  const alreadyScheduled = existingEvidence.some(
    l => l.sequenceNumber === nextNumber && l.sequenceTrack === sentSequence.sequenceTrack &&
      (!run.sequenceRunId || ("sequenceRunId" in l && l.sequenceRunId === run.sequenceRunId))
  );
  if (alreadyScheduled) return;

  // Find the next sequence template for this salesperson and track
  const trackSequences = await storage.getEmailSequencesByTrack(sentLog.userId, sentSequence.sequenceTrack);
  const nextSequence = trackSequences.find(s => s.sequenceNumber === nextNumber);
  if (!nextSequence) {
    console.log(`[AutoChain] No Sequence ${nextNumber} template found for user ${sentLog.userId} track ${sentSequence.sequenceTrack}`);
    return;
  }
  const daysRequired = nextSequence.daysAfterNoReply ?? 7;

  // Schedule at sentAt + daysRequired days (same time of day)
  const nextSendAt = new Date(sentAt.getTime() + daysRequired * 24 * 60 * 60 * 1000);

  await storage.createEmailSequenceLog(
    {
      contactId: sentLog.contactId,
      sequenceId: nextSequence.id,
      sequenceTrack: sentSequence.sequenceTrack,
      sequenceNumber: nextNumber,
      status: "pending",
      scheduledSendAt: nextSendAt,
    },
    sentLog.userId, undefined, run.sequenceRunId ? { sequenceRunId: run.sequenceRunId } : {}
  );

  console.log(
    `[AutoChain] Scheduled Sequence ${nextNumber} for contact ${sentLog.contactId} at ${nextSendAt.toISOString()} (${daysRequired} days after Seq ${sentSequence.sequenceNumber})`
  );
}

// Global lock to prevent concurrent scheduler runs
let isProcessing = false;

/**
 * Process email sequences from the queue with rate limiting
 * Sends max 12 emails per hour (1 email every 5 minutes)
 */
export async function processEmailSequences(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}> {
  if (isProcessing) {
    console.log("Email sequence processing already in progress, skipping this run");
    return { processed: 0, sent: 0, failed: 0, errors: [] };
  }
  
  isProcessing = true;
  console.log("Starting email sequence processing...");
  
  const stats = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    const allLogs = await storage.getEmailSequenceLogs(null);
    
    // Reset stale "processing" logs back to "pending" 
    const STALE_PROCESSING_THRESHOLD_MS = 90 * 60 * 1000;
    const now = new Date();
    
    for (const log of allLogs.filter(l => l.status === "processing")) {
      const processingStarted = log.processingStartedAt ? new Date(log.processingStartedAt) : (log.createdAt ? new Date(log.createdAt) : new Date(0));
      const ageMs = now.getTime() - processingStarted.getTime();
      
      if (ageMs > STALE_PROCESSING_THRESHOLD_MS) {
        console.log(`Resetting stale processing log ${log.id} back to pending (stuck for ${Math.round(ageMs / 60000)} minutes)`);
        await storage.updateEmailSequenceLog(log.id, { status: "needs_review", errorMessage: "Stale processing state: provider acceptance is unknown. Reconcile before retrying." }, null);
      }
    }
    
    const refreshedLogs = await storage.getEmailSequenceLogs(null);
    const pendingLogs = refreshedLogs
      .filter(log => {
        if (log.status !== "pending") return false;
        if (log.scheduledSendAt) {
          const scheduledTime = new Date(log.scheduledSendAt);
          if (scheduledTime > now) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });

    console.log(`Found ${pendingLogs.length} pending emails in queue`);

    const MAX_EMAILS_PER_RUN = 12;
    const DELAY_BETWEEN_EMAILS_MS = 5 * 60 * 1000;

    for (const log of pendingLogs.slice(0, MAX_EMAILS_PER_RUN)) {
      stats.processed++;
      
      try {
        // Validate contact/template below, then atomically reserve immediately before the provider call.
      } catch (error) {
        console.error(`Failed to mark log ${log.id} as processing:`, error);
        stats.errors.push(`Failed to mark log ${log.id} as processing`);
        continue;
      }

      try {
        const contact = await storage.getContact(log.contactId, null);
        if (!contact) {
          stats.errors.push(`Contact ${log.contactId} not found`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }
        const reportSendRejection = await storage.getSalonReportSendRejection(
          contact.id,
          log.userId,
          contact.userId,
          contact.email,
        );
        if (reportSendRejection) {
          stats.errors.push(`Blocked salon report sequence for ${contact.email || contact.id}: ${reportSendRejection}`);
          await storage.updateEmailSequenceLog(log.id, {
            status: "failed",
            errorMessage: reportSendRejection,
          }, null);
          stats.failed++;
          continue;
        }
        if (!contact.email) {
          stats.errors.push(`Contact ${log.contactId} has no email`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }

        const sequence = await storage.getEmailSequence(log.sequenceId, null);
        if (!sequence) {
          stats.errors.push(`Sequence ${log.sequenceId} not found`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }

        const salesperson = await storage.getUser(log.userId);
        if (!salesperson) {
          stats.errors.push(`Salesperson ${log.userId} not found`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }

        if (sequence.userId !== log.userId || sequence.sequenceNumber !== log.sequenceNumber || sequence.sequenceTrack !== log.sequenceTrack) {
          await storage.updateEmailSequenceLog(log.id, { status: "needs_review", errorMessage: "Sequence identity changed after scheduling. Review before sending." }, null);
          continue;
        }
        const claim = await claimRecipientSend(log.id, contact.email);
        if ("rejection" in claim) {
          stats.errors.push(claim.rejection);
          continue;
        }
        const result = await sendSequenceEmail({
          contact: { ...contact, email: claim.recipient },
          salesperson,
          sequence,
          customSubject: log.customSubject,
          customBody: log.customBody,
        });

        if (result.success) {
          const sentAt = new Date();
          await recordRecipientOutcome(log.id, true, result.messageId);
          stats.sent++;
          console.log(`Sent Sequence ${sequence.sequenceNumber} to ${contact.email}`);

          // Auto-schedule the next sequence in the chain (Seq 2→3→4→5)
          try {
            await scheduleNextSequence(log, sequence, sentAt);
          } catch (chainErr) {
            const msg = chainErr instanceof Error ? chainErr.message : String(chainErr);
            console.error(`[AutoChain] Failed to schedule next sequence for contact ${log.contactId}: ${msg}`);
          }
        } else {
          const errMsg = result.error || "Unknown Brevo error";
          console.error(`[EmailScheduler] FAILED to send to ${contact.email}: ${errMsg}`);
          await recordRecipientOutcome(log.id, false, undefined, errMsg);
          stats.failed++;
          stats.errors.push(`Failed to send to ${contact.email}: ${errMsg}`);
        }

        if (stats.processed < Math.min(pendingLogs.length, MAX_EMAILS_PER_RUN)) {
          console.log(`Waiting 5 minutes before next email (rate limiting)...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_EMAILS_MS));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[EmailScheduler] Exception processing log ${log.id}: ${errorMessage}`);
        stats.errors.push(`Error processing log ${log.id}: ${errorMessage}`);
        await storage.updateEmailSequenceLog(log.id, { status: "needs_review", errorMessage: `Delivery requires review: ${errorMessage}` }, null);
        stats.failed++;
      }
    }

    console.log(`Email sequence processing complete:`, stats);
    return stats;
  } catch (error) {
    console.error("Fatal error in email sequence processing:", error);
    throw error;
  } finally {
    isProcessing = false;
  }
}

/**
 * Start the email sequence scheduler
 * Runs every hour
 */
export function startEmailSequenceScheduler(): NodeJS.Timeout {
  console.log("Starting email sequence scheduler (runs every hour)");
  
  processEmailSequences().catch(error => {
    console.error("Error in initial email sequence run:", error);
  });

  const interval = setInterval(() => {
    processEmailSequences().catch(error => {
      console.error("Error in scheduled email sequence run:", error);
    });
  }, 60 * 60 * 1000);

  return interval;
}
