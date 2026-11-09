// Creates the three accounts: Admin, Male Officer and Female Officer. There is no signup, so this
// is the only way accounts come into existence.
//
//   npm run seed            create any missing account
//   npm run seed -- --reset also issue new passwords for existing accounts
//
// New passwords are written to .credentials.local.txt (git-ignored), never to stdout.
import { appendFileSync, chmodSync } from "node:fs";
import bcrypt from "bcryptjs";
import postgres from "postgres";
import { generatePassword } from "../src/lib/passwords";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (add it to .env.local)");

const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { prepare: false, max: 1, ssl: local ? false : "require" });
const reset = process.argv.includes("--reset");
const CREDENTIALS_FILE = ".credentials.local.txt";

const ACCOUNTS = [
  { username: "admin", displayName: "Admin", role: "admin", gender: null },
  { username: "male.officer", displayName: "Male Officer", role: "officer", gender: "Male" },
  { username: "female.officer", displayName: "Female Officer", role: "officer", gender: "Female" },
] as const;

async function main() {
  const lines: string[] = [];

  for (const account of ACCOUNTS) {
    const [existing] = await sql`select id from app_users where username = ${account.username}`;
    if (existing && !reset) {
      console.log(`exists  ${account.username}`);
      continue;
    }
    const password = process.env.SEED_PASSWORD ?? generatePassword();
    const hash = await bcrypt.hash(password, 12);

    await sql`
      insert into app_users (username, display_name, password_hash, role, gender_scope, approval_status)
      values (${account.username}, ${account.displayName}, ${hash}, ${account.role}, ${account.gender}, 'approved')
      on conflict (username) do update
        set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null`;
    lines.push(`${account.displayName.padEnd(16)} username: ${account.username.padEnd(16)} password: ${password}`);
    console.log(`${existing ? "reset  " : "created"} ${account.username}`);
  }

  if (lines.length > 0 && !process.env.SEED_PASSWORD) {
    appendFileSync(CREDENTIALS_FILE, `--- ${new Date().toISOString()}\n${lines.join("\n")}\n`, { mode: 0o600 });
    chmodSync(CREDENTIALS_FILE, 0o600);
    console.log(`Passwords saved to ${CREDENTIALS_FILE}`);
  }
}

main()
  .catch((err) => {
    console.error("Seeding failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
