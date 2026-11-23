import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "./db";
import { claimRecipientSend, recipientHistory, recordRecipientOutcome, reserveRecipientLog, reconcileRecipientOutcome } from "./recipientOutreach";
import { normalizeRecipient, recipientConflict, latestRecipientEvents, type RecipientEvent } from "./recipientPolicy";
import { storage } from "./storage";
import { scheduleNextSequence } from "./emailScheduler";

test("normalization never guesses aliases; sent intro allows only its intended later steps", () => {
  assert.equal(normalizeRecipient("  Team@Fixture.Example "), "team@fixture.example");
  assert.notEqual(normalizeRecipient("te.am+sale@fixture.example"), "team@fixture.example");
  const event: RecipientEvent = { logId: "log1", userId: "owner1", contactId: "contact1", recipient: "team@fixture.example",
    sequenceTrack: "directory_general", sequenceNumber: 1, state: "sent", at: "2026-10-01T01:00:00Z" };
  assert.match(recipientConflict(event.recipient, 1, "salon_custom", "owner2", "contact2", [event], new Set())!, /Previously emailed/);
  assert.equal(recipientConflict(event.recipient, 2, event.sequenceTrack, event.userId, event.contactId, [event], new Set()), null);
  assert.match(recipientConflict(event.recipient, 2, "salon_custom", event.userId, event.contactId, [event], new Set())!, /preceding/);
  assert.match(recipientConflict(event.recipient, 2, event.sequenceTrack, "owner2", "contact2", [event], new Set())!, /preceding/);
  assert.equal(latestRecipientEvents([{ ...event, state: "attempted" }, event])[0].state, "sent");
  assert.equal(recipientConflict(event.recipient, 1, event.sequenceTrack, event.userId, event.contactId,
    [event], new Set(), undefined, "new-run"), null, "manual runs can start despite previous sends");
  assert.match(recipientConflict(event.recipient, 1, event.sequenceTrack, event.userId, event.contactId,
    [{ ...event, state: "scheduled" }], new Set([event.logId]), undefined, "new-run")!, /Already scheduled/);
  for (const state of ["attempted", "uncertain"] as const) {
    assert.match(recipientConflict(event.recipient, 1, event.sequenceTrack, event.userId, event.contactId,
      [{ ...event, state }], new Set(), undefined, "new-run")!, /Uncertain delivery/);
  }
  assert.match(recipientConflict(event.recipient, 2, event.sequenceTrack, event.userId, event.contactId,
    [event], new Set(), undefined, "new-run")!, /preceding/, "old runs cannot authorize a new follow-up");
});
test("transactional address reservations cover concurrent owners, sends, edits, follow-ups and failed status save", async () => {
  const database = db as any, original = { transaction: database.transaction, select: database.select };
  let memory: Record<string, any[]> = {
    contacts: [{ id:"c1",userId:"owner1",email:" Team@Fixture.Example " },{ id:"c2",userId:"owner2",email:"team@fixture.example" }],
    activities: [], email_sequence_logs: [],
  };
  let queue = Promise.resolve(), failSave = false, locks = 0;
  const dialect = new PgDialect();
  const matches = (row: any, condition: any, table: string) => {
    if (!condition) return true;
    const query = dialect.sqlToQuery(condition);
    if (query.sql.includes('lower(trim(')) return normalizeRecipient(row.email) === query.params[0];
    const columns = [...query.sql.matchAll(/"(\w+)"\s*=\s*\$\d+/g)];
    return columns.every((match, index) => row[match[1].replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] === query.params[index]);
  };
  const tx: any = {
    execute: async () => { locks++; },
    select: () => {
      let table = "", condition: any;
      const read = () => structuredClone((memory[table] || []).filter(row => matches(row, condition, table)));
      const builder: any = { from(t: any) { table=getTableName(t); return builder; },
        where(c: any) { condition=c;return builder; }, for() { return builder; }, then(r:any,j:any) { return Promise.resolve(read()).then(r,j); } };
      return builder;
    },
    insert: (table: any) => ({ values(value: any) {
      const inserted = { ...value, id: value.id || `e${memory.activities.length}`, sequenceTrack:value.sequenceTrack||"directory_general" };
      memory[getTableName(table)].push(inserted);
      return { returning: async () => [structuredClone(inserted)], then: (r:any,j:any) => Promise.resolve().then(r,j) };
    }}),
    update: (table: any) => ({ set(value: any) { return { where(condition: any) {
      if (failSave && value.status === "sent") throw new Error("Fixture failed local status save.");
      for (const row of memory[getTableName(table)]) if (matches(row, condition, getTableName(table))) Object.assign(row,value);
      return { returning:async()=>[], then:(r:any,j:any)=>Promise.resolve().then(r,j) };
    }}; }}),
  };
  database.select = tx.select;
  database.transaction = (callback: any) => {
    const result = queue.then(async () => {
      const before = structuredClone(memory);
      try { return await callback(tx); } catch(error) { memory=before;throw error; }
    });
    queue = result.catch(()=>{});
    return result;
  };
  const input = (contactId:string,step=1) => ({ contactId, sequenceId:`template-${step}`, sequenceTrack:"directory_general", sequenceNumber:step, status:"pending" });
  try {
    await assert.rejects(()=>reserveRecipientLog(input("c1"),"owner1","stale-preview@fixture.example"),/email changed during enrollment/);
    const concurrent = await Promise.allSettled([reserveRecipientLog(input("c1"),"owner1"),reserveRecipientLog(input("c2"),"owner2")]);
    assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);
    const log = (concurrent.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<any>).value;
    const owner = log.userId, contactId=log.contactId;
    const other = await recipientHistory("team@fixture.example", owner==="owner1"?"owner2":"owner1");
    assert.equal(other.label,"Already scheduled");assert.equal(other.crossOwner,true);assert.equal(other.history.length,0);
    const claims = await Promise.all([claimRecipientSend(log.id),claimRecipientSend(log.id)]);
    assert.equal(claims.filter(claim=>"recipient" in claim).length,1);
    failSave=true;
    await assert.rejects(()=>recordRecipientOutcome(log.id,true,"provider-accepted"), /failed local status save/);
    failSave=false;
    assert.equal((await recipientHistory("team@fixture.example", owner)).label,"Uncertain history");
    assert.ok("rejection" in await claimRecipientSend(log.id));
    await assert.rejects(()=>reconcileRecipientOutcome(log.id,owner,owner,{confirmed:true,outcome:"accepted",recipient:"someone-else@fixture.example",providerMessageId:"receipt",acceptedAt:"2026-01-01T12:00:00Z",note:"Checked provider receipt."}),/differs from retained/);
    await reconcileRecipientOutcome(log.id,owner,owner,{confirmed:true,outcome:"accepted",recipient:"team@fixture.example",providerMessageId:"provider-reconciled",acceptedAt:"2026-01-01T12:00:00Z",note:"Inspected the provider receipt for this exact actual recipient."});
    assert.equal((await recipientHistory("team@fixture.example", owner)).label,"Previously emailed");
    await assert.rejects(()=>reserveRecipientLog(input(contactId),owner), /Previously emailed/);
    const followup=await reserveRecipientLog(input(contactId,2),owner);
    assert.ok("recipient" in await claimRecipientSend(followup.id));
    await recordRecipientOutcome(followup.id,true,"provider-followup");
    const step3=await reserveRecipientLog(input(contactId,3),owner);
    memory.contacts.find(c=>c.id===contactId).email="new@fixture.example";
    assert.match((await claimRecipientSend(step3.id) as { rejection:string }).rejection,/changed/);
    assert.equal(memory.email_sequence_logs.find(l=>l.id===step3.id).status,"needs_review");
    memory.contacts=memory.contacts.filter(c=>c.id!==contactId);
    assert.equal((await recipientHistory("team@fixture.example",null)).label,"Previously emailed");
    assert.ok(memory.activities.every(event=>!event.contactId));
    memory.contacts.push({id:"legacy",userId:"legacyOwner",email:"legacy@fixture.example"});
    memory.email_sequence_logs.push({id:"unknown-history",contactId:"legacy",userId:"legacyOwner",status:"sent",sequenceNumber:1});
    assert.equal((await recipientHistory("legacy@fixture.example","legacyOwner")).label,"Uncertain history");
    await assert.rejects(()=>reserveRecipientLog(input("legacy"),"legacyOwner"), /Uncertain history/);
    const manual = { manualNewSequence: true };
    for (const status of ["pending", "processing", "needs_review"]) {
      memory.email_sequence_logs.find(l=>l.id==="unknown-history").status=status;
      await assert.rejects(()=>reserveRecipientLog(input("legacy"),"legacyOwner",undefined,manual), /Uncertain history/);
    }
    memory.email_sequence_logs.find(l=>l.id==="unknown-history").status="sent";
    await assert.rejects(()=>reserveRecipientLog(input("legacy"),"wrong-owner",undefined,manual), /same CRM owner/);
    await assert.rejects(()=>reserveRecipientLog(input("legacy"),"legacyOwner","different@fixture.example",manual), /changed during enrollment/);

    // Exercise the real bulk storage path used by Start New Sequence, not a mocked success.
    const crm = storage as any;
    const methods = ["getContact", "getEmailSequence", "getSalonReportSendRejection",
      "getInboxMessages", "getEmailSequenceLogs", "getEmailSequencesByTrack"];
    const originals = Object.fromEntries(methods.map(method=>[method,crm[method]]));
    const template = (step: number) => ({id:`template-${step}`,userId:"legacyOwner",strategy:"no_software",
      sequenceTrack:"salon_no_software",sequenceNumber:step,isActive:"true",daysAfterNoReply:7});
    try {
      crm.getContact=async(id:string)=>memory.contacts.find(c=>c.id===id);
      crm.getEmailSequence=async()=>template(1);
      crm.getSalonReportSendRejection=async()=>null;
      const enroll = () => crm.bulkCreateEmailSequenceLogs("template-1",["legacy"],"legacyOwner",
        new Date(Date.now()+60_000),undefined,undefined,undefined,manual);
      const scheduled = await enroll();
      assert.equal(scheduled.successful.length,1);
      const newLog = scheduled.successful[0];
      const evidence = memory.activities.map(a=>JSON.parse(a.description)).find(e=>e.logId===newLog.id);
      assert.equal(evidence.sequenceRunId,newLog.id);
      assert.equal(evidence.recipient,"legacy@fixture.example");
      assert.match((await enroll()).failed[0].error,/already in/);
      memory.contacts.push({id:"legacy-other",userId:"anotherOwner",email:"legacy@fixture.example"});
      await assert.rejects(()=>reserveRecipientLog(input("legacy-other"),"anotherOwner",undefined,manual), /Already scheduled/,
        "manual enrollment still protects the same address across CRM owners");
      assert.ok("recipient" in await claimRecipientSend(newLog.id), "historical missing snapshots also do not block the scheduler");
      await assert.rejects(()=>reserveRecipientLog(input("legacy"),"legacyOwner",undefined,manual), /Uncertain delivery/);
      await recordRecipientOutcome(newLog.id,true,"fixture-new-run");
      assert.equal(memory.email_sequence_logs.find(l=>l.id==="unknown-history").status,"sent", "past history is preserved");

      // A completed older run's step 2 and reply must not suppress this new run's step 2.
      memory.email_sequence_logs.push({id:"old-step-2",contactId:"legacy",userId:"legacyOwner",
        status:"sent",sequenceNumber:2,sequenceTrack:"salon_no_software",sequenceId:"template-2"});
      crm.getInboxMessages=async()=>[{receivedAt:new Date("2020-01-01")}];
      crm.getEmailSequenceLogs=async()=>memory.email_sequence_logs.filter(l=>l.contactId==="legacy");
      crm.getEmailSequencesByTrack=async()=>[template(2),template(3)];
      crm.getEmailSequence=async(id:string)=>template(Number(id.split("-").at(-1)));
      await scheduleNextSequence(newLog,template(1) as any,new Date());
      const next = memory.email_sequence_logs.find(l=>l.contactId==="legacy"&&l.sequenceNumber===2&&l.status==="pending");
      assert.ok(next, "the new run gets its own follow-up");
      assert.equal(memory.activities.map(a=>JSON.parse(a.description)).find(e=>e.logId===next.id).sequenceRunId,newLog.id);
      const count=memory.email_sequence_logs.length;
      await scheduleNextSequence(newLog,template(1) as any,new Date());
      assert.equal(memory.email_sequence_logs.length,count, "a run's follow-up cannot be queued twice");
      assert.ok("recipient" in await claimRecipientSend(next.id));
      await recordRecipientOutcome(next.id,true,"fixture-new-followup");
      crm.getInboxMessages=async()=>[{receivedAt:new Date(Date.now()+60_000)}];
      await scheduleNextSequence(next,template(2) as any,new Date());
      assert.equal(memory.email_sequence_logs.length,count, "new replies still stop the new run");

      // Completing this run permits another explicit run, even using the same template.
      crm.getEmailSequence=async()=>template(1);
      const later = await enroll();
      assert.equal(later.successful.length,1);
      memory.contacts.find(c=>c.id==="legacy").email="changed-after-manual-enrollment@fixture.example";
      assert.match((await claimRecipientSend(later.successful[0].id) as {rejection:string}).rejection,/changed/);
    } finally { for(const method of methods) crm[method]=originals[method]; }
    assert.ok(locks>=6);
  } finally { database.transaction=original.transaction;database.select=original.select; }
});