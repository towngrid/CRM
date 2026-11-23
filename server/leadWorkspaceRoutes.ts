import type { Express, RequestHandler } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { contacts, deals, salonEnrichmentBatches, salonEnrichmentRows } from "@shared/schema";
import { directoryEligibility, directoryObject, directoryNotesEvidence } from "@shared/directoryEligibility";
import { getSalonOwnerNameResult } from "./salonOwnerNames";
import { importableSalonEmail } from "./bookingPageEmail";
import { historicalApprovalEvidence, leadView, sameLead, leadIdentityIndex, unifiedUploadRow, validateLeadMaterial } from "./leadWorkspacePolicy";
import { recipientHistory, recipientHistoryReader, reconcileRecipientOutcome } from "./recipientOutreach";
import { leadResearchEstimate, startLeadResearch, pauseLeadResearch, recoverLeadResearch } from "./leadWorkspaceResearch";
import { recoveredLeadEvidence } from "./leadWorkspaceSavedEvidence";
import { leadResearchResults, filterLeadResearchRows } from "./leadResearchResults";
import { renderLeadSequencePreview } from "./leadSequencePreview";
import { salonCrmDuplicates, salonCrmDuplicateReasons } from "./salonCrmDuplicates";
import { leadRecipient } from "@shared/leadWorkflowState";
import { controlFullResearch } from "./fullResearchQueue";
import { getProviderCredits } from "./providerCredits";
import { confirmSharedProviderBudget, readSharedProviderBudget } from "./sharedProviderBudget";
import { renderContactFormDraft } from "./leadContactFormDraft";

const scope = (req: any) => req.user.role === "admin" ? null : req.user.claims.sub as string;
function confirmed(req: any) { if (req.body?.confirmed !== true) throw new Error("Confirm this action before continuing."); }
export function registerLeadWorkspaceRoutes(app: Express, auth: RequestHandler,
  budgetUpdate: typeof confirmSharedProviderBudget = confirmSharedProviderBudget) {
  const route = (method: "get" | "post", path: string, handler: (req: any) => Promise<any>) => app[method](path, auth, async (req: any, res) => {
    try { res.json(await handler(req)); } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Lead action failed" });
    }
  });
  async function ownedRow(req: any) {
    const row = await storage.getSalonEnrichmentRow(req.params.rowId, scope(req));
    if (!row) throw new Error("Lead not found or not accessible.");
    return recoveredLeadEvidence(row);
  }
  route("get", "/api/leads", req => storage.getSalonEnrichmentBatches(scope(req)));
  route("get", "/api/leads/rows/:rowId/form-draft-templates", async req => {
    await ownedRow(req);
    return (await storage.getEmailSequences(req.user.claims.sub))
      .filter(s => s.isActive === "true" && s.sequenceNumber === 1)
      .map(s => ({ id: s.id, name: `${s.sequenceTrack.replace(/_/g," ")} · ${s.strategy} · ${s.subject.slice(0,80)}` }));
  });
  route("post", "/api/leads/rows/:rowId/form-draft", async req => {
    const row = await ownedRow(req);
    if (row.status === "processing") throw new Error("Wait for research to finish before generating a draft.");
    const sequence = await storage.getEmailSequence(String(req.body?.sequenceId || ""), req.user.claims.sub);
    if (!sequence || sequence.isActive !== "true" || sequence.sequenceNumber !== 1) throw new Error("Choose one of your active first-step outreach messages.");
    const sender = await storage.getUser(req.user.claims.sub);
    if (!sender) throw new Error("Your salesperson profile could not be loaded.");
    return renderContactFormDraft(row, getSalonOwnerNameResult(row), sequence, sender);
  });
  route("post", "/api/recipient-outreach/history", async req => {
    const ids = req.body?.contactIds;
    if (!Array.isArray(ids) || ids.length > 200) throw new Error("Preview up to 200 selected contacts at a time.");
    const history = await recipientHistoryReader(scope(req));
    const result = [];
    for (const id of ids) {
      const contact = await storage.getContact(String(id), scope(req));
      if (!contact) throw new Error("A selected contact is not accessible.");
      result.push({ contactId: contact.id, ...history(contact.email) });
    }
    return { contacts: result };
  });
  route("post", "/api/recipient-outreach/:logId/reconcile", req =>
    reconcileRecipientOutcome(req.params.logId, scope(req), req.user.claims.sub, req.body));
  route("get", "/api/leads/:id", async req => {
    const batch = await storage.getSalonEnrichmentBatch(req.params.id, scope(req));
    if (!batch) throw new Error("Saved list not found or not accessible.");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const view = typeof req.query.view === "string" ? req.query.view : "all";
    if (!["all", "researched", "needs_review", "ready_for_contacts"].includes(view)) throw new Error("Choose a supported business list view.");
    const savedRows = await storage.getSalonEnrichmentRows(batch.id, batch.userId);
    const research = leadResearchResults(savedRows, batch.researchProgress);
    const all = filterLeadResearchRows(savedRows, research.states, view, typeof req.query.search === "string" ? req.query.search : "");
    const rowLinks = directoryObject(batch.researchProgress).linkedRows;
    const linkedRows = Array.isArray(rowLinks) ? (await Promise.all(rowLinks.map(async (link: any) => {
      const row = await storage.getSalonEnrichmentRow(String(link.rowId), batch.userId);
      return row ? { rowId: row.id, batchId: row.batchId, businessName: row.businessName } : null;
    }))).filter(Boolean) : [];
    const ownedDeals = await storage.getDeals(batch.userId);
    const history = await recipientHistoryReader(scope(req));
    const rows = await Promise.all(all.slice(offset, offset + limit).map(async saved => {
      const row = recoveredLeadEvidence(saved);
      const contact = row.importedContactId ? await storage.getContact(row.importedContactId, batch.userId) : undefined;
      return { ...leadView(row), researchState: research.states.get(row.id), ownerName: getSalonOwnerNameResult(row),
        contactName: contact ? { firstName: contact.firstName, lastName: contact.lastName, useBusinessNameForEmail: contact.useBusinessNameForEmail } : null,
        dealId: ownedDeals.find(deal => deal.contactId === row.importedContactId)?.id || null,
        recipientHistory: history(row.email || leadView(row).candidateEmail) };
    }));
    return { batch, rows, linkedRows, researchSummary: research.summary, total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
  });
  const uploadPreview = async (req: any) => {
    if (!Array.isArray(req.body?.rows)) throw new Error("The upload needs a rows array.");
    validateLeadMaterial(req.body.rows);
    const owner = req.user.claims.sub as string;
    const mapping = directoryObject(req.body.columnMapping) as Record<string, string>;
    const batches = await storage.getSalonEnrichmentBatches(owner);
    const existing = (await Promise.all(batches.map(batch => storage.getSalonEnrichmentRows(batch.id, owner)))).flat();
    const existingIndex = leadIdentityIndex<any>(existing);
    const parsed = req.body.rows.map((raw: any, index: number) => raw && typeof raw === "object" && !Array.isArray(raw) ? unifiedUploadRow(raw, index, owner, mapping) : null);
    const seen = leadIdentityIndex<any>();
    const rows = parsed.filter(Boolean).map((row: any) => {
      const duplicate = existingIndex.find(row);
      const repeated = seen.find(row);
      seen.add(row);
      return { row, duplicate, repeated };
    });
    return { owner, rows, inputCount: parsed.length, invalidCount: parsed.filter((r: any) => !r).length,
      duplicateCount: rows.filter((r: any) => r.duplicate || r.repeated).length };
  };
  route("post", "/api/leads/upload-preview", async req => {
    const preview = await uploadPreview(req);
    return { inputCount: preview.inputCount, invalidCount: preview.invalidCount, duplicateCount: preview.duplicateCount,
      rows: preview.rows.map(({ row, duplicate, repeated }: any) => ({ rowNumber: row.rowNumber, businessName: row.businessName,
        email: leadView(row).candidateEmail, sourceUrl: leadView(row).sourceUrl,
        existingRowId: duplicate?.id || null, existingBatchId: duplicate?.batchId || null,
        protected: !!duplicate && (duplicate.reviewStatus === "approved" || !!duplicate.importedContactId),
        action: duplicate ? "Choose skip, link or append source suggestions; existing evidence and CRM history are protected." :
          repeated ? "Repeated inside this file; will be skipped." : "Stage for review; no research or contacts." })) };
  });
  const stageList = async (req:any) => {
    confirmed(req);
    const preview = await uploadPreview(req);
    const choice = req.body.duplicateAction || "skip";
    if (!["skip", "link", "update"].includes(choice)) throw new Error("Choose skip, link or update for duplicates.");
    const name = String(req.body.name || req.body.fileName || "Uploaded list").trim();
    if (!name || name.length > 200) throw new Error("List name must contain 1–200 characters.");
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`leads:${preview.owner}`}))`);
      const existing = await tx.select().from(salonEnrichmentRows).where(eq(salonEnrichmentRows.userId, preview.owner)).for("update");
      const existingIndex = leadIdentityIndex<any>(existing), stagedIndex = leadIdentityIndex<any>();
      const newRows: any[] = [], links: any[] = [];
      let updatedCount = 0, duplicateCount = 0;
      for (const { row } of preview.rows) {
        const duplicate = existingIndex.find(row);
        const discovery=directoryObject(directoryObject(row.sourceData).originalInput).discoveryEvidence;
        if(discovery){
          const originalNotes=String(directoryObject(discovery).notes||"");
          const parsed=directoryObject((()=>{try{return JSON.parse(originalNotes);}catch{return {};}})());
          const compatibleEvidence={...directoryObject(parsed.evidence),...directoryNotesEvidence(originalNotes)};
          delete compatibleEvidence.ownerName;
          row.evidence={...directoryObject(row.evidence),...compatibleEvidence,originalNotes};
        }
        if (stagedIndex.find(row)) { duplicateCount++; continue; }
        if (duplicate) {
          duplicateCount++;
          if (choice !== "skip") links.push({ rowId: duplicate.id, batchId: duplicate.batchId });
          if (choice === "update") {
            const source = directoryObject(duplicate.sourceData);
            const amendments = Array.isArray(source.sourceAmendments) ? source.sourceAmendments : [];
            if (amendments.length >= 20) throw new Error("This lead already has 20 source amendments. Review existing evidence before adding more.");
            const updatedSource = { ...source, sourceAmendments: [...amendments,
              { at: new Date().toISOString(), fileName: req.body.fileName, originalInput: directoryObject(row.sourceData).originalInput }] };
            validateLeadMaterial([updatedSource]);
            await tx.update(salonEnrichmentRows).set({ sourceData: updatedSource, updatedAt: new Date() }).where(eq(salonEnrichmentRows.id, duplicate.id));
            updatedCount++;
          }
        } else { newRows.push(row); stagedIndex.add(row); }
      }
      const [batch] = await tx.insert(salonEnrichmentBatches).values({
        userId: preview.owner, name, fileName: String(req.body.fileName || name),
        status: "completed", totalRows: newRows.length, pilotLimit: 0, concurrency: 1,
        researchProgress: { workflow: "unified_leads", linkedRows: links },
        needsReviewRows: newRows.length, estimatedSerpCalls: 0,
      }).returning();
      for (let i = 0; i < newRows.length; i += 250) {
        await tx.insert(salonEnrichmentRows).values(newRows.slice(i, i + 250).map(row => ({ ...row, batchId: batch.id })));
      }
      return { batch, stagedCount: newRows.length, duplicateCount, updatedCount, linkedCount: links.length, invalidCount: preview.invalidCount };
    });
    return result;
  };
  route("post", "/api/leads/upload",stageList);
  route("post", "/api/leads/discovery/:jobId", async req => {
    confirmed(req);
    const owner = req.user.claims.sub as string;
    const job = await storage.getLeadDiscoveryJob(req.params.jobId, owner);
    const national = !job ? await storage.getNationalSearchJob(req.params.jobId, owner) : undefined;
    if (!job && !national) throw new Error("Search not found or not owned by you.");
    const allRows = job ? await storage.getLeadDiscoveryResults(job.id, owner) : await storage.getNationalJobResults(national!.id, owner);
    const selected = Array.isArray(req.body.rowIds) ? new Set(req.body.rowIds) : null;
    const rows = selected ? allRows.filter(row => selected.has(row.id)) : allRows;
    if (!rows.length) throw new Error("Select at least one saved search result.");
    req.body = { confirmed: true, name: `Business search ${job?.state || "multi-state"}`, fileName: `discovery:${req.params.jobId}`,
      duplicateAction: req.body.duplicateAction || "link", rows: rows.map(row => ({ ...row, Business: row.company,
        "Email Source URL": row.websiteUrl, notes: row.notes, discoveryEvidence: row })) };
    // Same adapter and upload transaction as spreadsheets; invoke the registered handler via the shared helper below.
    return stageList(req);
  });
  route("post", "/api/leads/discovery/:jobId/preview", async req => {
    const owner = req.user.claims.sub as string;
    const job = await storage.getLeadDiscoveryJob(req.params.jobId, owner);
    const national = !job ? await storage.getNationalSearchJob(req.params.jobId, owner) : undefined;
    if (!job && !national) throw new Error("Search not found or not owned by you.");
    const saved = job ? await storage.getLeadDiscoveryResults(job.id, owner) : await storage.getNationalJobResults(national!.id, owner);
    const selected = new Set(Array.isArray(req.body.rowIds) ? req.body.rowIds : saved.map(row=>row.id));
    req.body.rows = saved.filter(row=>selected.has(row.id)).map(row=>({...row,Business:row.company}));
    const preview = await uploadPreview(req);
    return { count: preview.inputCount, duplicateCount: preview.duplicateCount,
      duplicates: preview.rows.filter((item:any)=>item.duplicate).map((item:any)=>({businessName:item.row.businessName,
        rowId:item.duplicate.id,batchId:item.duplicate.batchId,protected:item.duplicate.reviewStatus==="approved"||!!item.duplicate.importedContactId})) };
  });
  route("get", "/api/leads/:id/estimate", req => leadResearchEstimate(req.params.id, scope(req)));
  route("get", "/api/leads/:id/provider-credits", async req => {
    const batch = await storage.getSalonEnrichmentBatch(req.params.id, scope(req));
    if (!batch) throw new Error("Saved list not found or inaccessible.");
    const [credits, sharedBudget] = await Promise.all([getProviderCredits(), readSharedProviderBudget()]);
    return { ...credits, sharedBudget };
  });
  route("post", "/api/leads/:id/shared-provider-budget", async req => {
    if (req.user.role !== "admin") throw new Error("Only an administrator can change the shared monthly safety budget.");
    const batch = await storage.getSalonEnrichmentBatch(req.params.id, scope(req));
    if (!batch) throw new Error("Saved list not found or inaccessible.");
    return budgetUpdate(req.user.role, req.body);
  });
  async function fullResearchControl(req: any, action: string) {
    confirmed(req);
    const batch = await storage.getSalonEnrichmentBatch(req.params.id, scope(req));
    if (!batch) throw new Error("Saved list not found or inaccessible.");
    return controlFullResearch(batch.id, batch.userId, action, req.body);
  }
  route("post", "/api/leads/:id/full-research", req => fullResearchControl(req, "start"));
  for (const action of ["pause", "resume", "recover"]) {
    route("post", `/api/leads/:id/full-research/${action}`, req => fullResearchControl(req, action));
  }
  route("post", "/api/leads/:id/research", async req => { confirmed(req); return startLeadResearch(req.params.id, req.user.claims.sub, req.body); });
  route("post", "/api/leads/:id/resume", async req => { confirmed(req); return startLeadResearch(req.params.id, req.user.claims.sub, req.body, true); });
  route("post", "/api/leads/:id/pause", async req => { confirmed(req); return pauseLeadResearch(req.params.id, req.user.claims.sub); });
  route("post", "/api/leads/:id/recover",async req=>{confirmed(req);return recoverLeadResearch(req.params.id,req.user.claims.sub);});
  route("get", "/api/leads/rows/:rowId/history", async req => {
    const row = await ownedRow(req);
    const contact=row.importedContactId?await storage.getContact(row.importedContactId,row.userId):undefined;
    return recipientHistory(contact?.email || row.email || leadView(row).candidateEmail, scope(req));
  });
  route("post", "/api/leads/rows/:rowId/review", async req => {
    confirmed(req);
    const row = await ownedRow(req);
    if (row.status === "processing") throw new Error("Wait for this business's research to finish before changing its review.");
    if (row.importedContactId) throw new Error("This lead is already linked. Review changes on its contact without overwriting approved evidence.");
    const decision = req.body.decision;
    if (!["approved", "needs_review", "rejected"].includes(decision)) throw new Error("Choose save for review, approve or reject.");
    if (decision === "rejected") return storage.updateSalonEnrichmentRow(row.id, { reviewStatus: "rejected" }, row.userId);
    if (row.reviewStatus === "approved" && (decision === "needs_review" ||
      typeof req.body.email === "string" && req.body.email.trim().toLowerCase() !== (row.email || "").trim().toLowerCase())) {
      throw new Error("This email is already approved. Use the source-correction review to change an approved address.");
    }
    const eligibility = directoryEligibility(row);
    if (decision === "approved" && eligibility.blocked) throw new Error("Confirm grooming suitability through its independent review before approving this email.");
    const reviewedEmail = historicalApprovalEvidence(row, req.body);
    const email = decision === "needs_review" ? { ...reviewedEmail, source: "manual_entry", confidence: "manual",
      fetchedAt: null, reviewedAt: null, identityConfirmed: false, sourceInspected: false } : reviewedEmail;
    const evidence = { ...directoryObject(row.evidence), email };
    const updated = await storage.updateSalonEnrichmentRow(row.id, {
      email: email.value, evidence, identityMatchStatus: decision === "approved" ? "strong" : row.identityMatchStatus, reviewStatus: decision, status: "enriched",
      sourceData: { ...directoryObject(row.sourceData), Outcome: decision === "needs_review" ? eligibility.blocked ? directoryObject(row.sourceData).Outcome : "manually_entered_email" : email.source === "manual_approval" ? "manually_approved_email" : String(leadView(row).historicalFinding).includes("directory") || directoryObject(directoryObject(row.evidence).email).source === "public_directory" ? "verified_independent_directory_email" : "verified_first_party_email", category: decision === "needs_review" ? eligibility.blocked ? directoryObject(row.sourceData).category : "manually_entered_email" : email.source === "manual_approval" ? "manually_approved_email" : "verified_public_email",
        reviewHistory: [...(Array.isArray(directoryObject(row.sourceData).reviewHistory) ? directoryObject(row.sourceData).reviewHistory as any[] : []),
          { at:new Date().toISOString(),actor:req.user.claims.sub,previousEvidence:directoryObject(row.evidence).email||null,previousReviewStatus:row.reviewStatus }],
        reviewDecision: { at: new Date().toISOString(), actor: req.user.claims.sub, decision, note: req.body.reviewNote } },
    }, row.userId);
    await storage.refreshSalonEnrichmentBatchCounts(row.batchId, row.userId);
    return updated;
  });
  async function correction(req: any) {
    const row = await ownedRow(req), fields = directoryObject(req.body.fields);
    const protectedRow = !!row.importedContactId || row.reviewStatus === "approved" || row.status === "processing";
    const before = { businessName: row.businessName, address: row.address || "", websiteUrl: row.websiteUrl || "",
      candidateEmail: leadView(row).candidateEmail || "", sourceUrl: leadView(row).sourceUrl || "" };
    const after = { ...before };
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (fields[key] !== undefined) {
        if (typeof fields[key] !== "string" || fields[key].length > 2000) throw new Error("Correction fields must be text of at most 2,000 characters.");
        after[key] = fields[key].trim();
      }
    }
    if (!after.businessName) throw new Error("Business name is required.");
    if (after.candidateEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(after.candidateEmail)) throw new Error("Use a valid email suggestion or leave it blank.");
    if (!String(req.body.note || "").trim()) throw new Error("Explain why the staged details are changing.");
    const changes = (Object.keys(before) as (keyof typeof before)[]).filter(field => before[field] !== after[field]).map(field => ({ field, before: before[field], after: after[field] }));
    const existing = await storage.getSalonEnrichmentRows(row.batchId, row.userId);
    const duplicates = existing.filter(other => other.id !== row.id && sameLead(other, { ...row, ...after })).map(other => ({ rowId: other.id, batchId: other.batchId, businessName: other.businessName }));
    return { row, after, changes, protected: protectedRow, duplicates,
      message: protectedRow ? "Approved evidence, linked CRM data and in-flight research are protected. Open the contact or finish research first." :
        "Original input remains intact. A correction resets identity and email approval and does not change contact names, contacts, deals or outreach." };
  }
  route("post", "/api/leads/rows/:rowId/correction-preview", async req => {
    const { row, after, ...preview } = await correction(req);
    return preview;
  });
  route("post", "/api/leads/rows/:rowId/correction", async req => {
    confirmed(req);
    const preview = await correction(req);
    if (preview.protected) throw new Error(preview.message);
    return db.transaction(async tx => {
      const [row] = await tx.select().from(salonEnrichmentRows).where(and(eq(salonEnrichmentRows.id, preview.row.id), eq(salonEnrichmentRows.userId, preview.row.userId))).for("update");
      if (!row || row.reviewStatus === "approved" || row.importedContactId || row.status === "processing") throw new Error("This record changed after preview. Refresh; approved evidence and CRM data are protected.");
      const source = directoryObject(row.sourceData), amendments = Array.isArray(source.sourceAmendments) ? source.sourceAmendments : [];
      if (amendments.length >= 20) throw new Error("Review the 20 existing source amendments before adding another.");
      const sourceData = { ...source, uploadedEmailCandidate: preview.after.candidateEmail || null, historicalSourceUrl: preview.after.sourceUrl || null,
        historicalFinding: null, stagingState: "staged_unverified",
        sourceAmendments: [...amendments, { at: new Date().toISOString(), actor: req.user.claims.sub,
          changes: preview.changes, note: String(req.body.note).trim(), previousEvidence: row.evidence }] };
      validateLeadMaterial([sourceData]);
      const [updated] = await tx.update(salonEnrichmentRows).set({
        businessName: preview.after.businessName, address: preview.after.address || null, websiteUrl: preview.after.websiteUrl || null,
        ...(preview.changes.some(change=>["businessName","address"].includes(change.field)) ? { placeId:null,address1:null,city:null,zipCode:null,latitude:null,longitude:null } : {}),
        email: null, identityMatchStatus: "unmatched", reviewStatus: "needs_review", status: "rejected",
        sourceData, evidence: { ...directoryObject(row.evidence), email: null, historicalFinding: null,
          originalNotes: directoryObject(row.evidence).originalNotes, sourceUrl: preview.after.sourceUrl,
          ...(preview.changes.some(change => ["businessName","address"].includes(change.field)) ? {
            groomingChecks: null,
            ownerName: { ...getSalonOwnerNameResult(row), status: "needs_review", selectedCandidateId: null, usePersonalName: false,
              candidates: getSalonOwnerNameResult(row).candidates.map(candidate => ({ ...candidate, businessMatched: false, roleConfirmed: false })) },
          } : {}) },
        duplicateMetadata: preview.duplicates.length ? { rowIds: preview.duplicates.map(row => row.rowId), reason: "Correction matches another staged lead; confirm a link." } : {},
        updatedAt: new Date(),
      }).where(eq(salonEnrichmentRows.id, row.id)).returning();
      return updated;
    });
  });
  route("post", "/api/leads/rows/:rowId/crm", async req => {
    confirmed(req);
    const row = await ownedRow(req);
    if (row.importedContactId) return { contactId: row.importedContactId, linked: true };
    const email = importableSalonEmail(row);
    if (row.reviewStatus !== "approved" || !email || directoryEligibility(row).blocked) throw new Error("Review and approve business identity and email-source evidence before adding to CRM.");
    const candidatesFor=async(current:typeof row,verifiedEmail:string)=>salonCrmDuplicates(current,
      await db.select().from(contacts).where(eq(contacts.userId,current.userId)),verifiedEmail);
    const duplicatePreview=(current:typeof row,matches:typeof contacts.$inferSelect[],verifiedEmail:string)=>({
      needsDuplicateReview:true,duplicates:matches.map(contact=>({id:contact.id,company:contact.company,email:contact.email,
        phone:contact.phone,address:contact.address,matchReasons:salonCrmDuplicateReasons(current,contact,verifiedEmail)})),
      message:"Review the matching contacts and explicitly choose one to link. Nothing was overwritten.",
    });
    const matches = await candidatesFor(row,email);
    if (matches.length) {
      if(!req.body.linkContactId)return duplicatePreview(row,matches,email);
      // Link only; contact details, approved evidence, deals and outreach remain untouched.
      const linked=await db.transaction(async tx=>{
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`crm-import:${row.userId}`}))`);
        const [current]=await tx.select().from(salonEnrichmentRows).where(and(eq(salonEnrichmentRows.id,row.id),eq(salonEnrichmentRows.userId,row.userId))).for("update");
        if(current?.importedContactId)return {contactId:current.importedContactId,linked:true};
        const currentEmail=current&&importableSalonEmail(current);
        if(!current||current.reviewStatus!=="approved"||!currentEmail||directoryEligibility(current).blocked)throw new Error("The review changed. Refresh and approve its source evidence before linking.");
        const currentMatches=salonCrmDuplicates(current,await tx.select().from(contacts).where(eq(contacts.userId,row.userId)),currentEmail);
        const selected=currentMatches.find(contact=>contact.id===req.body.linkContactId);
        if(!selected)throw new Error("The selected contact is no longer a supported duplicate. Refresh the preview; nothing was linked.");
        await tx.update(salonEnrichmentRows).set({importedContactId:selected.id,status:"imported",updatedAt:new Date()}).where(eq(salonEnrichmentRows.id,row.id));
        return {contactId:selected.id,linked:true};
      });
      await storage.refreshSalonEnrichmentBatchCounts(row.batchId,row.userId);
      return linked;
    }
    if(req.body.linkContactId)throw new Error("The selected contact no longer matches this lead. Refresh the duplicate preview.");
    const result = await storage.importApprovedSalonRows(row.batchId, [row.id], row.userId);
    const imported = result.imported.find(item => item.id === row.id) || await storage.getSalonEnrichmentRow(row.id, row.userId);
    if (!imported?.importedContactId) {
      if(imported){
        const currentEmail=importableSalonEmail(imported);
        const currentMatches=currentEmail?await candidatesFor(imported,currentEmail):[];
        if(currentEmail&&currentMatches.length)return duplicatePreview(imported,currentMatches,currentEmail);
      }
      throw new Error(result.skipped[0]?.reason || "Contact could not be added. Resolve identity or duplicate evidence.");
    }
    return { contactId: imported.importedContactId, linked: false };
  });
  route("post", "/api/leads/rows/:rowId/pipeline", async req => {
    confirmed(req);
    const row = await ownedRow(req);
    if (!row.importedContactId) throw new Error("Add or link the CRM contact first.");
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pipeline:${row.importedContactId}`}))`);
      const [prior] = await tx.select().from(deals).where(and(eq(deals.contactId, row.importedContactId!), eq(deals.userId, row.userId)));
      if (prior) return { dealId: prior.id, linked: true };
      const [deal] = await tx.insert(deals).values({ contactId: row.importedContactId, userId: row.userId, title: row.businessName,
        stage: "new_lead_unqualified", plan: "Unknown", probability: 0, description: `Reviewed lead; source ${leadView(row).sourceUrl || "stored evidence"}` }).returning();
      return { dealId: deal.id, linked: false };
    });
  });
  route("get", "/api/leads/rows/:rowId/sequences", async req => {
    const row = await ownedRow(req);
    const sequences = (await storage.getEmailSequences(row.userId)).filter(sequence =>
      sequence.sequenceNumber === 1 && sequence.isActive === "true" && sequence.sequenceTrack.startsWith("directory_"));
    const contact = row.importedContactId ? await storage.getContact(row.importedContactId, row.userId) : undefined;
    const sender=contact?await storage.getUser(row.userId):undefined;
    return { sequences:sequences.map(sequence=>({...sequence,
      ...(contact&&sender?renderLeadSequencePreview(sequence,contact,sender):{renderedSubject:null,renderedBody:null,greetingPreview:null,previewFingerprint:null})})),
      history: await recipientHistory(contact?.email || row.email, scope(req)), contact };
  });
  route("post", "/api/leads/rows/:rowId/schedule", async req => {
    confirmed(req);
    const row = await ownedRow(req);
    if (!row.importedContactId) throw new Error("Add or link the CRM contact first.");
    const contact = await storage.getContact(row.importedContactId, row.userId);
    if (!contact) throw new Error("Linked contact is not available.");
    if (!(await storage.getDeals(row.userId)).some(deal => deal.contactId === contact.id)) throw new Error("Create or open the Pipeline deal before scheduling.");
    const sequence = await storage.getEmailSequence(String(req.body.sequenceId || ""), row.userId);
    if (!sequence || sequence.isActive !== "true" || sequence.sequenceNumber !== 1 || !sequence.sequenceTrack.startsWith("directory_")) throw new Error("Select an active introductory directory sequence belonging to this contact's CRM owner.");
    const sender=await storage.getUser(row.userId);
    if(!sender||!leadRecipient(req.body.previewRecipient)||leadRecipient(req.body.previewRecipient)!==leadRecipient(contact.email)||
      req.body.previewFingerprint!==renderLeadSequencePreview(sequence,contact,sender).previewFingerprint) {
      throw new Error("The linked recipient or message changed. Refresh and confirm the current complete preview before scheduling.");
    }
    const when = new Date(req.body.scheduledSendAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) throw new Error("Confirm a future scheduled date and time.");
    const result = await storage.bulkCreateEmailSequenceLogs(sequence.id, [contact.id], row.userId, when,undefined,undefined,
      {[contact.id]:leadRecipient(req.body.previewRecipient)});
    if (result.failed.length) throw new Error(result.failed[0].error);
    return { successful: true, scheduled: result.successful[0], message: "Scheduled only. No message was sent by this action." };
  });
}