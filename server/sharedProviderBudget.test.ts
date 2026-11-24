import assert from "node:assert/strict";
import test from "node:test";
import { confirmSharedProviderBudget, sharedBudgetSnapshot, type BudgetUpdateDependencies } from "./sharedProviderBudget";
import { APPROVED_SERP_BUDGET, savedSerpBudget, sharedSerpStopMessage } from "@shared/serpBudget";
import { storage } from "./storage";
import { db } from "./db";
import { serpUsage, serpCallReservations } from "@shared/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import express from "express";
import { registerLeadWorkspaceRoutes } from "./leadWorkspaceRoutes";

const approved = { confirmed: true, ...APPROVED_SERP_BUDGET };
function fixture() {
  const usage = { monthYear: "2026-10", monthlyQuota: 250, hardStopAt: 200, usedCredits: 200 };
  let reads = 0, updates = 0;
  const dependencies: BudgetUpdateDependencies = {
    credits: async () => { reads++; return { status: "available", remaining: 979,
      monthlyLimit: 1000, usedThisMonth: 21, checkedAt: new Date().toISOString() }; },
    month: () => "2026-10",
    update: async (month, quota, stop) => {
      updates++;
      assert.equal(month, usage.monthYear);
      usage.monthlyQuota = quota; usage.hardStopAt = stop;
      return usage;
    },
  };
  return { usage, dependencies, counts: () => ({ reads, updates }) };
}

test("only an administrator's exact confirmed 1,000/800 update changes the shared budget", async () => {
  const env = fixture();
  for (const [role, input] of [
    ["salesperson", approved], ["admin", { ...approved, confirmed: false }],
    ["admin", { monthlyQuota: 1000, hardStopAt: 800 }],
    ["admin", { ...approved, hardStopAt: 1000 }],
    ["admin", { ...approved, monthlyQuota: 5000 }],
    ["admin", { ...approved, resetUsage: true }],
  ] as const) {
    await assert.rejects(confirmSharedProviderBudget(role, input, env.dependencies));
  }
  assert.deepEqual(env.counts(), { reads: 0, updates: 0 });
  assert.equal(env.usage.usedCredits, 200);
  const saved = await confirmSharedProviderBudget("admin", approved, env.dependencies);
  assert.deepEqual(saved, { monthYear: "2026-10", monthlyQuota: 1000, hardStopAt: 800, used: 200, remaining: 600 });
  assert.deepEqual(env.counts(), { reads: 1, updates: 1 });
  await confirmSharedProviderBudget("admin", approved, env.dependencies);
  assert.equal(env.usage.usedCredits, 200, "repeated confirmations never refund spending");
});

test("budget endpoint uses the authenticated CRM role, not OIDC identity claims", async () => {
  const env = fixture();
  let actor: any = { role: "admin", claims: { sub: "fixture-admin" } };
  const scopes: Array<string | null | undefined> = [];
  const original = storage.getSalonEnrichmentBatch;
  storage.getSalonEnrichmentBatch = async (_id, owner) => {
    scopes.push(owner);
    return { id: "fixture-list", userId: "fixture-list-owner" } as Awaited<ReturnType<typeof original>>;
  };
  const app = express();
  app.use(express.json());
  registerLeadWorkspaceRoutes(app, (req, _res, next) => {
    req.user = actor;
    next();
  }, (role, input) => confirmSharedProviderBudget(role, input, env.dependencies));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/leads/fixture-list/shared-provider-budget`;
    const send = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(approved) });
    const response = await send();
    assert.equal(response.status, 200, "real admin session has no role in OIDC claims");
    assert.deepEqual(await response.json(), {
      monthYear: "2026-10", monthlyQuota: 1000, hardStopAt: 800, used: 200, remaining: 600,
    });
    assert.deepEqual(scopes, [null], "CRM admin can access the shared control on an accessible saved list");
    for (const role of ["salesperson", undefined]) {
      actor = { role, claims: { sub: "fixture-salesperson", role: "admin" } };
      const denied = await send();
      assert.equal(denied.status, 400);
      assert.match((await denied.json()).message, /Only an administrator/);
    }
    assert.deepEqual(env.counts(), { reads: 1, updates: 1 }, "identity claims cannot bypass the CRM role guard");
    assert.deepEqual(scopes, [null], "denied actors do not access the saved list or budget");
    assert.equal(env.usage.usedCredits, 200);
    actor = { role: "admin", claims: { sub: "fixture-admin", role: "salesperson" } };
    assert.equal((await send()).status, 200, "database-backed CRM role is authoritative");
    assert.equal(env.usage.usedCredits, 200, "repeated update retains counted spending");
  } finally {
    storage.getSalonEnrichmentBatch = original;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("unverified, insufficient and failed account reads cannot raise the shared allowance", async () => {
  for (const monthlyLimit of [null, 250, 999]) {
    const env = fixture();
    env.dependencies.credits = async () => ({ status: "available", monthlyLimit, remaining: 979,
      usedThisMonth: 21, checkedAt: new Date().toISOString() });
    await assert.rejects(confirmSharedProviderBudget("admin", approved, env.dependencies), /Verify/);
    assert.equal(env.counts().updates, 0);
    assert.equal(env.usage.hardStopAt, 200);
  }
  const env = fixture();
  env.dependencies.credits = async () => { throw new Error("Account check unavailable"); };
  await assert.rejects(confirmSharedProviderBudget("admin", approved, env.dependencies));
  assert.equal(env.counts().updates, 0);
});

test("saved budgets persist into a new month; invalid budgets fail rather than grant credit", () => {
  assert.deepEqual(savedSerpBudget(), { monthlyQuota: 1000, hardStopAt: 900 });
  assert.deepEqual(savedSerpBudget(APPROVED_SERP_BUDGET), APPROVED_SERP_BUDGET);
  for (const budget of [{ monthlyQuota: 0, hardStopAt: 200 }, { monthlyQuota: 1000, hardStopAt: 1001 },
    { monthlyQuota: 1000, hardStopAt: -1 }, { monthlyQuota: 1000.5, hardStopAt: 800 }]) {
    assert.throws(() => savedSerpBudget(budget), /Invalid/);
  }
  assert.equal(sharedBudgetSnapshot({ monthYear: "2026-10", monthlyQuota: 1000, hardStopAt: 800,
    usedCredits: 805 }).remaining, 0);
  assert.match(sharedSerpStopMessage(200, 200), /Shared app monthly safety stop.*200 \/ 200/);
  assert.match(sharedSerpStopMessage(200, 200), /SerpAPI may still have credits/);
});

test("actual storage retains usage, inherits approved limits and serializes concurrent list reservations", async () => {
  // In-memory transaction fixtures only; never connect to or mutate a real database.
  const original = db.transaction;
  const dialect = new PgDialect();
  let records: any[] = [{ id: "usage-old", monthYear: "2026-10", monthlyQuota: 250, hardStopAt: 200, usedCredits: 200 }];
  const reservations: any[] = [];
  let transactions = Promise.resolve();
  let lockCount = 0;
  const tx: any = {
    execute: async (sql: any) => {
      assert.match(dialect.sqlToQuery(sql).sql, /pg_advisory_xact_lock.*serp-call-reservation/);
      lockCount++;
    },
    select: (selection: any) => {
      let table: any, condition: any, limit = Infinity;
      const builder: any = {
        from(value: any) { table = value; return builder; },
        where(value: any) { condition = value; return builder; },
        orderBy() { return builder; },
        limit(value: number) { limit = value; return builder; },
        then(resolve: any, reject: any) {
          if (table === serpCallReservations) return Promise.resolve([{ count: reservations.length }]).then(resolve, reject);
          assert.equal(table, serpUsage);
          const query = dialect.sqlToQuery(condition);
          const filtered = records.filter(row => query.sql.includes(" < ") ?
            row.monthYear < query.params[0] : row.monthYear === query.params[0])
            .sort((a, b) => b.monthYear.localeCompare(a.monthYear)).slice(0, limit);
          return Promise.resolve(filtered.map(row => selection ?
            { monthlyQuota: row.monthlyQuota, hardStopAt: row.hardStopAt } : { ...row })).then(resolve, reject);
        },
      };
      return builder;
    },
    insert: (table: any) => ({ values: (value: any) => ({ returning: async () => {
      const row = { id: `fixture-${records.length + reservations.length}`, createdAt: new Date(), ...value };
      (table === serpUsage ? records : reservations).push(row);
      return [{ ...row }];
    } }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: (condition: any) => {
      assert.equal(table, serpUsage);
      const month = dialect.sqlToQuery(condition).params[0];
      const apply = () => {
        const row = records.find(row => row.monthYear === month)!;
        for (const [key, value] of Object.entries(values)) {
          if (key === "usedCredits") {
            assert.match(dialect.sqlToQuery(value as any).sql, /\+ 1/);
            row.usedCredits++;
          } else {
            assert.ok(["monthlyQuota", "hardStopAt"].includes(key), "only budget metadata may change");
            row[key] = value;
          }
        }
        return [{ ...row }];
      };
      return { then: (resolve: any) => Promise.resolve(apply()).then(resolve), returning: async () => apply() };
    } }) }),
  };
  db.transaction = ((callback: any) => {
    const result = transactions.then(() => callback(tx));
    transactions = result.then(() => undefined, () => undefined);
    return result;
  }) as typeof original;
  try {
    const saved = await storage.updateSerpQuota("2026-10", 1000, 800);
    assert.equal(saved?.usedCredits, 200);
    assert.equal(saved?.hardStopAt, 800);
    const afterRestart = await storage.getOrCreateSerpUsage("2026-10");
    assert.equal(afterRestart.usedCredits, 200);
    assert.equal(afterRestart.hardStopAt, 800);
    const newMonth = await storage.getOrCreateSerpUsage("2026-11");
    assert.equal(newMonth.monthlyQuota, 1000);
    assert.equal(newMonth.hardStopAt, 800);
    assert.equal(newMonth.usedCredits, 0);
    assert.equal(records[0].usedCredits, 200, "new month never rewrites historical usage");
    records.find(row => row.monthYear === "2026-11").usedCredits = 799;
    const results = await Promise.all(["NY", "CA", "TX"].map(() => storage.reserveSerpCall("2026-11", 1000)));
    assert.equal(results.filter(Boolean).length, 1, "three competing lists cannot exceed the shared 800 cap");
    assert.equal(records.find(row => row.monthYear === "2026-11").usedCredits, 800);
    assert.equal(reservations.length, 1);
    assert.equal(lockCount, 6);
  } finally { db.transaction = original; }
});
