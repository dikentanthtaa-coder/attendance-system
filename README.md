# Gyansatra Attendance

Attendance management for the three-day Gyansatra event: Admin controls the event days, and the Male and Female Officers search for members and mark them present.

Built with Next.js, Postgres on Supabase, and Vercel hosting.

## Accounts

There are exactly three accounts, and no signup. `npm run seed` creates them:

| Role | Username | Access |
| --- | --- | --- |
| Admin | `admin` | Excel upload, event start and end, marking anyone, dashboard, P/A report, export, removing attendance, resetting officer passwords |
| Male Officer | `male.officer` | Male members only: search, filter by area, mark present, Quick Entry, totals and history |
| Female Officer | `female.officer` | Female members only: search, filter by area, mark present, Quick Entry, totals and history |

Each account can be logged in on many devices at once. Logging in or out on one doesn't affect the others.

Passwords are randomly generated and saved to `.credentials.local.txt`, which is git-ignored. To issue new ones, run `npm run seed -- --reset`, or use **Reset password** on the Officers page, which logs out every device on that account. To set a password you choose, run `NEW_PASSWORD='…' npm run set-password -- male.officer` (or `admin`, `female.officer`). It also logs out every device on that account.

## The P/A report

Admin's **Report** tab has one row per member and one column per day that has started, and downloads as Excel. P means marked present. A means not marked once that day has ended, worked out when the report runs and never stored. A running day shows `-` for people not marked yet. Columns build up from Day 1, to Days 1 and 2, to all three.

## Installing on a phone

The app is a PWA. On Android or desktop Chrome, use **Install app** in the header. On iPhone, use Safari's **Share → Add to Home Screen**. It needs the internet to work, and says so clearly when it's offline. Only code, icons and the offline page are stored on the device, never member details.

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

- **Gender restriction:** the officer's gender is read from the database on every request and is never taken from the browser.
- **No duplicate people in Quick Entry:** the same name and mobile together is refused outright. Only one of them matching asks the officer to confirm, because families share numbers and people share names.
- **Three accounts only:** there's no signup, and a database index allows one active officer per gender.
- **Password resets:** a temporary password is stored only as a hash and never logged. Until it's replaced, the server refuses every other request from that account. Each password change raises a version stored with the account and in the session cookie, which signs out older sessions.
- **Officers can't undo attendance:** one database statement decides each mark, so it holds across devices and forged requests. Only Admin can remove attendance, with a reason.
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
