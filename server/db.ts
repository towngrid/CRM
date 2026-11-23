import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Standard Postgres driver (Railway Postgres). Railway's private network address
// (*.railway.internal) does not use SSL; a public proxy address does.
const url = process.env.DATABASE_URL;
const isPrivate = /\.railway\.internal\b|localhost|127\.0\.0\.1/.test(url);

export const pool = new pg.Pool({
  connectionString: url,
  ssl: isPrivate ? false : { rejectUnauthorized: false },
});
export const db = drizzle({ client: pool, schema });
