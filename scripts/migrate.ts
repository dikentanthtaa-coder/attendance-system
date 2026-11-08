// Applies db/migrations/*.sql in order, once each. Safe to re-run.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (add it to .env.local)");

const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { prepare: false, max: 1, ssl: local ? false : "require", onnotice: () => {} });

async function main() {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  await sql`alter table schema_migrations enable row level security`;

  const dir = join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const [done] = await sql`select 1 from schema_migrations where name = ${file}`;
    if (done) {
      console.log(`skip   ${file}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, file), "utf8"));
      await tx.unsafe("insert into schema_migrations (name) values ($1)", [file]);
    });
    console.log(`apply  ${file}`);
  }
}

main()
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
