// `npm test`: runs every *.test.ts file in server/ and shared/, one at a time, and
// prints a pass/fail line per file. Tests never touch a real database: if
// DATABASE_URL isn't set, a placeholder address that nothing listens on is used.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const files = ["server", "shared"].flatMap(dir =>
  readdirSync(dir).filter(f => f.endsWith(".test.ts")).sort().map(f => join(dir, f)));

const env = { ...process.env, NODE_ENV: "test" };
env.DATABASE_URL ??= "postgres://test@127.0.0.1:9/no-database";

let failed = 0;
for (const file of files) {
  const started = Date.now();
  const run = spawnSync(process.execPath, ["--import", "tsx", "--test", file], {
    env, encoding: "utf8", timeout: 180_000, shell: false,
  });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const pass = Number(/^# pass (\d+)/m.exec(out)?.[1] ?? 0);
  const fail = Number(/^# fail (\d+)/m.exec(out)?.[1] ?? 0);
  const ok = run.status === 0 && fail === 0;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? "PASS" : "FAIL"}  ${file}  (${pass} passed, ${fail} failed, ${secs}s)${run.error ? `  ${run.error.message}` : ""}`);
  if (!ok) { failed++; if (process.argv.includes("--verbose")) console.log(out); }
}
console.log(`\n${files.length - failed} of ${files.length} test files passed.`);
process.exit(failed ? 1 : 0);
