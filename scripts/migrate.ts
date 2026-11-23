// Runs before every Railway deploy (pre-deploy command `npm run db:migrate`).
//
// Applies the SQL files in migrations/ that this database hasn't had yet, in order.
// Replaces `drizzle-kit push`, which compares against the live database and breaks on
// Postgres 18 (it tries to drop NOT NULL from primary keys).
//
// To change the database: edit shared/schema.ts, then run
//   npm run db:generate -- --name short_description
// and commit the new file in migrations/.
//
// The CRM database was first built with `drizzle-kit push` (Steps 1-2), so it has the
// tables but no migration history. On that first run this script adds the Step 2
// pieces that may be missing, then records 0000_baseline as already applied.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const MIGRATIONS = "./migrations";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const isPrivate = /\.railway\.internal\b|localhost|127\.0\.0\.1/.test(url);
  const pool = new pg.Pool({ connectionString: url, ssl: isPrivate ? false : { rejectUnauthorized: false } });

  try {
    const existing = await pool.query(`
      SELECT
        to_regclass('public.users') IS NOT NULL AS has_users,
        to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_history`);
    const { has_users, has_history } = existing.rows[0];

    if (has_users && !has_history) {
      console.log("[migrate] Database was built by drizzle-kit push; recording the baseline.");
      const [baseline] = readMigrationFiles({ migrationsFolder: MIGRATIONS });
      await pool.query("BEGIN");
      try {
        // Step 2 pieces, in case the failed push didn't get to them.
        await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_list text`);
        await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_type text`);
        await pool.query(`CREATE TABLE IF NOT EXISTS deal_plans (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          name text NOT NULL,
          price numeric(10, 2),
          billing text DEFAULT 'monthly' NOT NULL,
          kind text DEFAULT 'plan' NOT NULL,
          note text,
          active text DEFAULT 'true' NOT NULL,
          sort_order integer DEFAULT 0 NOT NULL,
          updated_at timestamp DEFAULT now())`);
        await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
        await pool.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
        await pool.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
          [baseline.hash, baseline.folderMillis],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    }

    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS });

    // Report what is there, so the deploy log shows the database is complete.
    const check = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public') AS tables,
        (SELECT count(*)::int FROM information_schema.columns
           WHERE table_name = 'contacts' AND column_name IN ('lead_list', 'lead_type')) AS lead_columns,
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS applied`);
    const { tables, lead_columns, applied } = check.rows[0];
    console.log(`[migrate] Done: ${tables} tables, ${applied} migration(s) applied, lead columns ${lead_columns}/2.`);
    if (lead_columns !== 2) throw new Error("contacts.lead_list / lead_type are missing.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate] FAILED:", error);
  process.exit(1); // stops the deploy, so the old version keeps running
});
