import { defineConfig } from "drizzle-kit";

// `npm run db:generate` writes a new SQL file in migrations/ from shared/schema.ts;
// it needs no database. Railway applies the files with `npm run db:migrate`
// (scripts/migrate.ts). Don't use `drizzle-kit push`: it breaks on Postgres 18.
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
