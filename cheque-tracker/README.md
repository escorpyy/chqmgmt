# Cheque Register

A cheque receivable/payable tracker: Express + Prisma (via `@prisma/adapter-pg`) +
PostgreSQL on the backend, plain HTML/CSS/JS on the frontend.

## Stack

- **DB**: local PostgreSQL
- **ORM**: Prisma, connected through `@prisma/adapter-pg` + `pg` (driver adapters)
  rather than Prisma's bundled query engine
- **Server**: Express, serving both the JSON API and the static frontend
- **Frontend**: `public/index.html` + `public/style.css` + `public/script.js` —
  no build step, no framework

## Project layout

```
prisma/
  schema.prisma                  # your data model
  manual-migration-additions.sql # CHECK constraints, triggers, case-insensitive index
lib/
  prisma.js                      # PrismaClient wired to @prisma/adapter-pg
  chequeHelpers.js                # totalDays / chequeType derivation
  asyncHandler.js
routes/
  parties.js, banks.js, staff.js, companyBankAccounts.js, receipts.js
  cheques.js, issuedCheques.js, dashboard.js
scripts/
  apply-manual-migration.js      # applies manual-migration-additions.sql
server.js                        # Express app entrypoint
public/
  index.html, style.css, script.js
```

## 1. Install

```bash
npm install
```

## 2. Configure the database connection

```bash
cp .env.example .env
# edit .env — point DATABASE_URL at your local Postgres instance
# and set SESSION_SECRET to a long random string
```

The normal `npm run dev` and `npm start` commands now launch a guided
connection screen before login when no working configuration is available.
The screen can scan common local PostgreSQL ports, test host/port/database/
username/password, apply committed Prisma migrations and manual safety
constraints, save a local configuration, and then continue to the normal login
screen. If `DATABASE_URL` and `SESSION_SECRET` are already present in `.env`,
the application starts directly.

For a first local setup, make sure the target database exists, for example:

```bash
createdb cheque_tracker
```

The guided screen currently saves its connection details in the ignored local
`data/connection.json` file with restrictive filesystem permissions. This is a
development-friendly implementation. A production Windows installer should
replace the password field with Windows Credential Manager or DPAPI storage.

## 3. Run the Prisma migration manually when needed

```bash
npx prisma migrate dev --name init
```

The first-run connection screen uses the committed migrations with
`prisma migrate deploy`, so this manual step is normally needed only for
development when creating a new migration. The command creates all
tables/enums from `prisma/schema.prisma` and generates the Prisma Client (with
the `driverAdapters` preview feature the app needs to run through
`@prisma/adapter-pg`).

## 4. Apply the manual migration additions

Prisma's schema language can't express `CHECK` constraints, functional
(case-insensitive) unique indexes, or triggers, so `prisma/manual-migration-additions.sql`
covers those — positive-amount checks, `totalDays` sanity, no-self-replacement,
party firm/individual sanity, follow-up/check-log date ordering, the
case-insensitive unique index on `Bank.name`, and the two triggers that stop
cumulative payments from exceeding a cheque's amount.

The first-run connection screen applies this automatically after the Prisma
migrations. Apply it manually only when using direct `.env` startup or when
resetting a development database:

```bash
npm run db:apply-manual
```

Re-run this any time you reset the database (`prisma migrate reset`).

## 5. Backups and restore

Administrators can open the **Settings** tab to configure scheduled PostgreSQL
backups, create an on-demand backup, download a backup file, or restore a
backup. Scheduled backups are stored in the ignored local `data/backups/`
directory and retention removes older files after each scheduled or manual
backup. Copy important backup files to separate protected storage; local files
do not protect against disk failure, theft, or ransomware.

The restore flow requires typing `RESTORE` and confirming a warning. Before a
restore begins, the application creates a `pre-restore` backup of the current
database. Restore replaces database contents and may invalidate active
sessions, so sign out and sign in again afterward. The PostgreSQL command-line
tools `pg_dump` and `pg_restore` must be installed and available on the server's
PATH. Do not expose the backup download endpoint outside the authenticated
application.

## 6. Sign in for the first time

The app requires sign-in — there's no self-registration screen, since this is a
single-business internal tool. On startup, if an `admin` user does not already
exist, the server creates one with the `ADMIN` role and these initial
credentials:

```text
Username: admin
Password: admin
```

Sign in with those credentials and immediately change the password from the
admin-only **Users** tab. The server never overwrites an existing `admin`
account or password on later startups. Once you're signed in, the **Users** tab
lets administrators create and manage further logins — role, active/deactivated,
and password reset — without a CLI command.

Sessions are stored server-side in Postgres (the `session` table, created by
the migration above) via `connect-pg-simple`, so restarting the server
doesn't log anyone out.

### Administrator password recovery

If the only administrator forgets the password, run the maintenance command
from the application directory on a trusted server environment with access to
the configured `DATABASE_URL`:

```bash
npm run reset-admin -- admin
```

The username argument defaults to `admin`. The command only resets an existing
user whose role is `ADMIN`; it never creates a user, changes a role, activates
an account, prints the password, or accepts a password from shell history. It
prompts for the new password and confirmation without echoing either value.
Keep server and database access restricted because anyone who can run this
command can recover an administrator account.

The login screen's **Forgot password?** link explains both recovery paths
without attempting an unauthenticated password reset. For a future packaged
desktop release, this link can lead to a support-verified, one-time recovery
workflow or a separate signed recovery utility. Do not embed a permanent
password or hidden account in the executable.

## 6. Start the server

```bash
npm run dev     # auto-restarts on file changes (node --watch)
# or
npm start
```

Open **http://localhost:3000**.

## What's in the UI

- **Dashboard** — outstanding receivable/payable totals, status breakdown for
  both received and issued cheques, and a list of cheques still awaiting
  follow-up.
- **Received** — record a cheque against a receipt/issuer/bank; open any row
  to see its full detail drawer: change status, log a follow-up call, record
  a (partial or full) payment, flag it `ON_CHECK` for manual re-verification
  and later resolve that, or issue a replacement cheque for a returned one.
- **Issued** — same lifecycle from the payable side, plus a "Stop payment"
  action.
- **Daily Balance** — per bank account, each morning: enter opening balance
  and anything received that day. "Cheques due" is computed automatically —
  every still-`ISSUED` cheque with `chqDate` on or before the selected day,
  however old, so nothing already in flight gets forgotten. Available balance
  = opening − cheques due + received. Exports to Excel.
- **Parties, Banks, Our accounts, Staff, Receipts** — the reference data
  everything else hangs off of.

Business rules the UI/API enforce (mirroring the schema + manual migration):

- `chequeType` is derived automatically from the payee type (`FIRM` →
  `ACCOUNT_PAYEE`, `INDIVIDUAL` → `BEARER`) rather than trusting two fields
  to agree.
- `totalDays` is recalculated server-side any time `status`/`statusDate`
  changes.
- Marking a cheque `ON_CHECK` snapshots its `previousStatus`; resolving the
  check log applies whatever status turns out to be correct.
- Payments beyond a cheque's remaining balance are rejected client-side,
  server-side, and finally by the Postgres trigger as a last line of
  defense.
- Parties are soft-deleted (`deletedAt`), never hard-deleted, to preserve
  financial history.

## Notes on the driver adapter setup

`lib/prisma.js` creates a plain `pg.Pool` against `DATABASE_URL`, wraps it in
`PrismaPg` from `@prisma/adapter-pg`, and passes that adapter into
`PrismaClient`. This requires `previewFeatures = ["driverAdapters"]` in the
`generator client` block of `schema.prisma` (already set) and a reasonably
recent `prisma` / `@prisma/client` version (pinned to `^5.20.0` here — bump
both together if you upgrade).