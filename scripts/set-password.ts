// Sets a chosen password for one of the three accounts.
//
//   NEW_PASSWORD='the-password' npm run set-password -- admin
//
// The password comes from NEW_PASSWORD rather than the command's arguments, and is never printed.
// Every device signed in to that account is logged out and has to log in with the new password.
import bcrypt from "bcryptjs";
import postgres from "postgres";
import { passwordSchema } from "../src/lib/passwords";

const ACCOUNTS = ["admin", "male.officer", "female.officer"];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Put it in .env.local.");
const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { prepare: false, max: 1, ssl: local ? false : "require", onnotice: () => {} });

async function main() {
  const username = process.argv[2];
  if (!username || !ACCOUNTS.includes(username)) {
    throw new Error(`Say which account: ${ACCOUNTS.join(", ")}.`);
  }
  const checked = passwordSchema.safeParse(process.env.NEW_PASSWORD ?? "");
  if (!checked.success) throw new Error(checked.error.issues[0].message);

  const hash = await bcrypt.hash(checked.data, 12);
  const updated = await sql`
    update app_users
    set password_hash = ${hash}, must_change_password = false, failed_attempts = 0, locked_until = null,
        session_version = session_version + 1
    where username = ${username}
    returning username`;
  if (updated.length === 0) throw new Error(`There is no ${username} account. Run npm run seed first.`);
  console.log(`Password set for ${username}. Devices signed in to it will need to log in again.`);
}

main()
  .catch((err) => {
    console.error("Not changed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
