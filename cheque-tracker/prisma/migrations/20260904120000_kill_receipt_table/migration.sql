-- ============================================================================
-- Kill the Receipt table: replace it with a small FiscalYear master table,
-- and move receiptNo onto Cheque directly as free text.
--
-- Sequenced as add-nullable -> backfill -> tighten -> drop-old, so this is
-- safe to run against a live database with existing Cheque/Receipt rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. New FiscalYear table
-- ----------------------------------------------------------------------------
CREATE TABLE "FiscalYear" (
    "id"        TEXT NOT NULL,
    "year"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalYear_year_key" ON "FiscalYear"("year");


-- ----------------------------------------------------------------------------
-- 2. Add the new Cheque columns, nullable for now
-- ----------------------------------------------------------------------------
ALTER TABLE "Cheque" ADD COLUMN "fiscalYearId" TEXT;
ALTER TABLE "Cheque" ADD COLUMN "receiptNo" TEXT;


-- ----------------------------------------------------------------------------
-- 3. Backfill: one FiscalYear row per distinct Receipt.fiscalYear value
-- ----------------------------------------------------------------------------
INSERT INTO "FiscalYear" ("id", "year", "createdAt", "updatedAt")
SELECT substr(md5(random()::text || clock_timestamp()::text || r."fiscalYear"), 1, 25),
       r."fiscalYear",
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "fiscalYear" FROM "Receipt") r;

-- Backfill Cheque.fiscalYearId + Cheque.receiptNo from the Receipt each
-- cheque used to point at.
UPDATE "Cheque" c
SET "fiscalYearId" = fy.id,
    "receiptNo"    = r."receiptNo"
FROM "Receipt" r
JOIN "FiscalYear" fy ON fy."year" = r."fiscalYear"
WHERE c."receiptId" = r.id;


-- ----------------------------------------------------------------------------
-- 4. Tighten: fiscalYearId is required going forward
-- ----------------------------------------------------------------------------
ALTER TABLE "Cheque" ALTER COLUMN "fiscalYearId" SET NOT NULL;

ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_fiscalYearId_fkey"
  FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Cheque_fiscalYearId_idx" ON "Cheque"("fiscalYearId");


-- ----------------------------------------------------------------------------
-- 5. Drop the old Receipt link and the Receipt table itself
-- ----------------------------------------------------------------------------
ALTER TABLE "Cheque" DROP CONSTRAINT "Cheque_receiptId_fkey";
DROP INDEX IF EXISTS "Cheque_receiptId_idx";
ALTER TABLE "Cheque" DROP COLUMN "receiptId";

DROP TABLE "Receipt";
