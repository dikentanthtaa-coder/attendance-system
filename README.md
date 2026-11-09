# Gyansatr Attendance

Attendance management for the three-day Gyansatr event: Admin controls the event days, and the Male and Female Attendance Officers search for members and mark them present.

Built with Next.js, Postgres on Supabase, and Vercel hosting.

## Accounts

There is no signup. `npm run seed` creates the three accounts:

| Role | Username | Access |
| --- | --- | --- |
| Admin | `admin` | Excel upload, event start/end, dashboard, reports, export, corrections |
| Male Officer | `male.officer` | Male members only: search, mark attendance, Quick Entry |
| Female Officer | `female.officer` | Female members only: search, mark attendance, Quick Entry |

Passwords are randomly generated and saved to `.credentials.local.txt`, which is git-ignored. To issue new ones, run `npm run seed -- --reset`.

## Setup

1. Copy `.env.example` to `.env.local` and fill in both values.
2. Create the tables and accounts, then start the app:

   ```sh
   npm install
   npm run migrate
   npm run seed
   npm run dev
   ```

`DATABASE_URL` must be the Supabase **Transaction pooler** string (port 6543). The direct connection string doesn't work reliably from Vercel.

## Deploying

The app runs on Vercel and needs `DATABASE_URL` and `SESSION_SECRET` set as environment variables. `vercel.json` pins the server to Singapore (`sin1`), next to the Supabase database, which keeps search fast.

Schema changes go in a new file in `db/migrations/`. Apply them with `npm run migrate`; Vercel deployments don't run migrations.

## How the rules are enforced

Everything below is checked on the server or in the database, so it holds even for forged requests.

- **Gender restriction:** the officer's gender is read from the database on every request and is never taken from the browser.
- **One active event:** a partial unique index on `event_sessions`.
- **No duplicate attendance:** a unique constraint on member and event day.
- **Marking stops when an event ends:** each mark takes a row lock on the event inside its transaction, so a mark can't slip through as Admin ends the event.
- **Public API closed:** row level security is on with no policies, so Supabase's public API can't read any table.
- **Audit trail:** uploads, event changes, marks, Quick Entries and corrections are written to `audit_log`, in the same transaction as the change. The app has no screen for it; read it in the Supabase table editor.

## Tests

The end-to-end suite follows the testing checklist in the requirements document. It needs a throwaway local Postgres, and it **wipes that database**, so it refuses to run against anything except localhost.

```sh
docker run -d --name attendance-pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=attendance -p 54329:5432 postgres:17-alpine
npm run test:e2e
```

It uses your installed Google Chrome.
