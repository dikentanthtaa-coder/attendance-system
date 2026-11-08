import { execSync } from "node:child_process";
import postgres from "postgres";
import { TEST_DB } from "../playwright.config";

export const TEST_PASSWORD = "test-password-123";

export default async function globalSetup() {
  // This wipes the database, so it must never point anywhere but the local test container.
  if (!/localhost|127\.0\.0\.1/.test(TEST_DB)) throw new Error("Tests may only run against a local database");

  const sql = postgres(TEST_DB, { max: 1, onnotice: () => {} });
  await sql.unsafe(`drop schema if exists public cascade; drop schema if exists extensions cascade; create schema public;`);
  await sql.end();

  const env = { ...process.env, DATABASE_URL: TEST_DB, SEED_PASSWORD: TEST_PASSWORD };
  execSync("npx tsx scripts/migrate.ts", { env, stdio: "pipe" });
  execSync("npx tsx scripts/seed-users.ts", { env, stdio: "pipe" });
}
