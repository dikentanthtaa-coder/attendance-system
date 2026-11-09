# Gyansatr Attendance

Attendance management for the three-day Gyansatr event: Admin controls the event days and approves officers, and Attendance Officers search for members and mark them Present or Absent.

Built with Next.js, Postgres on Supabase, and Vercel hosting.

## Accounts

| Role | How they get an account | Access |
| --- | --- | --- |
| Admin | `npm run seed` (username `admin`) | Excel upload, event start and end, approving officers, marking attendance, dashboard, reports, export, corrections |
| Attendance Officer | Registers at `/register`, then Admin approves on the Officers page | See who isn't marked yet, search all members, mark Present or Absent, Quick Entry, their own totals and everyone's, and a history of each day's marks |

Officers log in with their email or mobile number. Until Admin approves them they can't log in, and Admin can remove access at any time.

If an officer forgets their password, Admin uses **Reset password** on the Officers page. It shows a temporary password once, signs out any device they're logged in on, and makes them choose a new password at their next login.

The Admin password is randomly generated and saved to `.credentials.local.txt`, which is git-ignored. To issue a new one, run `npm run seed -- --reset`.

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

Schema changes go in a new file in `db/migrations/`. Apply them with `npm run migrate`; Vercel deployments don't run migrations, so apply them when you push code that needs them.

## How the rules are enforced

Everything below is checked on the server or in the database, so it holds even for forged requests.

- **Officer approval:** role and approval status are read from the database on every request, so removing access takes effect on the officer's next click, and nothing sent while registering can grant access.
- **Password resets:** a temporary password is stored only as a hash and never logged. Until it's replaced, the server refuses every other request from that account. Each password change raises a version stored with the account and in the session cookie, which signs out older sessions.
- **Officers can't undo attendance:** one database statement decides each mark. An officer can mark someone with no record, or change Absent to Present. Present stays as it is, even for a forged request, and only Admin's correction route can change or remove it.
- **One active event:** a partial unique index on `event_sessions`.
- **No duplicate attendance:** a unique constraint on member and event day.
- **Marking stops when an event ends:** each mark takes a row lock on the event inside its transaction, so a mark can't slip through as Admin ends the event.
- **Public API closed:** row level security is on with no policies, so Supabase's public API can't read any table.
- **Audit trail:** registrations, approvals, uploads, event changes, marks, Quick Entries and corrections are written to `audit_log`, in the same transaction as the change. The app has no screen for it; read it in the Supabase table editor.

## Tests

The end-to-end suite follows the testing checklist in the requirements document. It needs a throwaway local Postgres, and it **wipes that database**, so it refuses to run against anything except localhost.

```sh
docker run -d --name attendance-pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=attendance -p 54329:5432 postgres:17-alpine
npm run test:e2e
```

It uses your installed Google Chrome.
