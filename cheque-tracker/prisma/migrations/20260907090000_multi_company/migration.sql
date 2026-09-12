-- ============================================================================
-- Multi-company support.
--
-- This app previously modeled exactly one business. Existing data (if any)
-- all belongs to that one business, so this migration:
--   1. Creates the Company table.
--   2. Backfills a single "Default Company" row, owned by the first admin
--      user (or first user at all, if no admin exists yet — or no company
--      at all if there are no users yet, e.g. a brand new install).
--   3. Adds companyId to every table that needs scoping, backfilling every
--      existing row to that one default company.
--   4. Only then makes companyId NOT NULL and rewrites the affected unique
--      constraints to be per-company instead of global.
--
-- Rename "Default Company" via the Users tab (or the Company management UI)
-- once you're signed in — this is just a safe landing spot for pre-existing
-- data, not a name you have to keep.
-- ============================================================================

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Company_createdById_idx" ON "Company"("createdById");
ALTER TABLE "Company" ADD CONSTRAINT "Company_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one default company, owned by an existing admin (or any user).
-- On a brand new install with no users yet, this simply creates no company
-- — the first user to sign up and create a company starts clean.
CREATE TEMP TABLE "_default_company" ("id" TEXT);

DO $$
DECLARE
  default_owner_id TEXT;
  default_company_id TEXT;
BEGIN
  SELECT "id" INTO default_owner_id FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1;
  IF default_owner_id IS NULL THEN
    SELECT "id" INTO default_owner_id FROM "User" ORDER BY "createdAt" ASC LIMIT 1;
  END IF;

  IF default_owner_id IS NOT NULL THEN
    default_company_id := 'default-company-' || substr(md5(random()::text), 1, 20);
    INSERT INTO "Company" ("id", "name", "createdById", "createdAt", "updatedAt")
    VALUES (default_company_id, 'Default Company', default_owner_id, now(), now());

    INSERT INTO "_default_company" VALUES (default_company_id);
  END IF;
END $$;

-- ---- FiscalYear -------------------------------------------------------
ALTER TABLE "FiscalYear" ADD COLUMN "companyId" TEXT;
UPDATE "FiscalYear" SET "companyId" = (SELECT "id" FROM "_default_company");
ALTER TABLE "FiscalYear" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "FiscalYear_companyId_idx" ON "FiscalYear"("companyId");
DROP INDEX IF EXISTS "FiscalYear_year_key";
CREATE UNIQUE INDEX "FiscalYear_companyId_year_key" ON "FiscalYear"("companyId", "year");

-- ---- Party --------------------------------------------------------------
ALTER TABLE "Party" ADD COLUMN "companyId" TEXT;
UPDATE "Party" SET "companyId" = (SELECT "id" FROM "_default_company");
ALTER TABLE "Party" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Party" ADD CONSTRAINT "Party_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Party_companyId_idx" ON "Party"("companyId");
DROP INDEX IF EXISTS "Party_panNo_key";
CREATE UNIQUE INDEX "Party_companyId_panNo_key" ON "Party"("companyId", "panNo");

-- ---- Bank -----------------------------------------------------------------
ALTER TABLE "Bank" ADD COLUMN "companyId" TEXT;
UPDATE "Bank" SET "companyId" = (SELECT "id" FROM "_default_company");
ALTER TABLE "Bank" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Bank" ADD CONSTRAINT "Bank_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Bank_companyId_idx" ON "Bank"("companyId");
DROP INDEX IF EXISTS "Bank_name_key";
CREATE UNIQUE INDEX "Bank_companyId_name_key" ON "Bank"("companyId", "name");

-- ---- Staff ----------------------------------------------------------------
ALTER TABLE "Staff" ADD COLUMN "companyId" TEXT;
UPDATE "Staff" SET "companyId" = (SELECT "id" FROM "_default_company");
ALTER TABLE "Staff" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Staff_companyId_idx" ON "Staff"("companyId");

-- ---- CompanyBankAccount ----------------------------------------------------
ALTER TABLE "CompanyBankAccount" ADD COLUMN "companyId" TEXT;
UPDATE "CompanyBankAccount" SET "companyId" = (SELECT "id" FROM "_default_company");
ALTER TABLE "CompanyBankAccount" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "CompanyBankAccount" ADD CONSTRAINT "CompanyBankAccount_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CompanyBankAccount_companyId_idx" ON "CompanyBankAccount"("companyId");
DROP INDEX IF EXISTS "CompanyBankAccount_accountNumber_key";
CREATE UNIQUE INDEX "CompanyBankAccount_companyId_accountNumber_key" ON "CompanyBankAccount"("companyId", "accountNumber");

-- ---- Cheque (denormalized companyId for direct filtering) -----------------
ALTER TABLE "Cheque" ADD COLUMN "companyId" TEXT;
UPDATE "Cheque" SET "companyId" = (SELECT "id" FROM "_default_company");
ALTER TABLE "Cheque" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Cheque_companyId_idx" ON "Cheque"("companyId");

-- ---- IssuedCheque (denormalized companyId for direct filtering) -----------
ALTER TABLE "IssuedCheque" ADD COLUMN "companyId" TEXT;
UPDATE "IssuedCheque" SET "companyId" = (SELECT "id" FROM "_default_company");
ALTER TABLE "IssuedCheque" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "IssuedCheque_companyId_idx" ON "IssuedCheque"("companyId");

DROP TABLE IF EXISTS "_default_company";