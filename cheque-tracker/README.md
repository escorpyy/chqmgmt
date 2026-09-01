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
```

Make sure the target database exists, e.g.:

```bash
createdb cheque_tracker
```

## 3. Run the Prisma migration

```bash
npx prisma migrate dev --name init
```

This creates all tables/enums from `prisma/schema.prisma` and generates the
Prisma Client (with the `driverAdapters` preview feature the app needs to run
through `@prisma/adapter-pg`).

## 4. Apply the manual migration additions

Prisma's schema language can't express `CHECK` constraints, functional
(case-insensitive) unique indexes, or triggers, so `prisma/manual-migration-additions.sql`
covers those — positive-amount checks, `totalDays` sanity, no-self-replacement,
party firm/individual sanity, follow-up/check-log date ordering, the
case-insensitive unique index on `Bank.name`, and the two triggers that stop
cumulative payments from exceeding a cheque's amount.

Apply it once, right after your first migration:

```bash
npm run db:apply-manual
```

Re-run this any time you reset the database (`prisma migrate reset`).

## 5. Start the server

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
