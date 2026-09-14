-- ============================================================================
-- Issued cheque redesign.
--
-- 1. Status list trimmed from 7 to 5: ISSUED, ON_CHECK, CLEARED, RETURNED,
--    STOPPED. FOLLOWUP and PRESENTED are dropped as top-level statuses —
--    we never reliably know when a payee presents a cheque, only the
--    final outcome, and the follow-up conversation after a bounce now
--    lives entirely in IssuedChequeFollowUp/IssuedChequeCheckLog underneath
--    a RETURNED cheque rather than as its own status value. Existing rows
--    are remapped before the enum itself is narrowed: PRESENTED -> ISSUED
--    (still an unresolved outcome), FOLLOWUP -> RETURNED (that's what it
--    always followed).
--
-- 2. New fields: pvNo (Payment Voucher No., mirrors Cheque.receiptNo),
--    fiscalYearId (mirrors Cheque.fiscalYearId), authorityId (the senior
--    person who approved the payment — distinct from issuedById, who
--    physically wrote it), payeeCategory (Supplier / Staff / Cash / Other).
--
-- 3. Account-to-account transfers: payeeId/payeeName/payeeType/
--    payeeCategory become optional, and a new transferToAccountId is
--    added. Exactly one of "has a payee" or "is a transfer" must hold —
--    enforced below with a CHECK constraint, not just app-side validation.
-- ============================================================================

-- ---- 1. Status enum: remap existing data, then narrow the type ----------

UPDATE "IssuedCheque" SET status = 'ISSUED' WHERE status = 'PRESENTED';
UPDATE "IssuedCheque" SET status = 'RETURNED' WHERE status = 'FOLLOWUP';
UPDATE "IssuedCheque" SET "previousStatus" = 'ISSUED' WHERE "previousStatus" = 'PRESENTED';
UPDATE "IssuedCheque" SET "previousStatus" = 'RETURNED' WHERE "previousStatus" = 'FOLLOWUP';
UPDATE "IssuedChequeCheckLog" SET "resolvedStatus" = 'ISSUED' WHERE "resolvedStatus" = 'PRESENTED';
UPDATE "IssuedChequeCheckLog" SET "resolvedStatus" = 'RETURNED' WHERE "resolvedStatus" = 'FOLLOWUP';

CREATE TYPE "IssuedChequeStatus_new" AS ENUM ('ISSUED', 'ON_CHECK', 'CLEARED', 'RETURNED', 'STOPPED');

ALTER TABLE "IssuedCheque" ALTER COLUMN status DROP DEFAULT;
ALTER TABLE "IssuedCheque" ALTER COLUMN status TYPE "IssuedChequeStatus_new" USING status::text::"IssuedChequeStatus_new";
ALTER TABLE "IssuedCheque" ALTER COLUMN status SET DEFAULT 'ISSUED';
ALTER TABLE "IssuedCheque" ALTER COLUMN "previousStatus" TYPE "IssuedChequeStatus_new" USING "previousStatus"::text::"IssuedChequeStatus_new";
ALTER TABLE "IssuedChequeCheckLog" ALTER COLUMN "resolvedStatus" TYPE "IssuedChequeStatus_new" USING "resolvedStatus"::text::"IssuedChequeStatus_new";

DROP TYPE "IssuedChequeStatus";
ALTER TYPE "IssuedChequeStatus_new" RENAME TO "IssuedChequeStatus";

-- presentedAt no longer means anything now that PRESENTED is gone — we
-- never reliably knew that date anyway, per the original field comment.
ALTER TABLE "IssuedCheque" DROP COLUMN "presentedAt";

-- ---- 2. New enum + new columns -------------------------------------------

CREATE TYPE "PayeeCategory" AS ENUM ('SUPPLIER', 'STAFF', 'CASH', 'OTHER');

ALTER TABLE "IssuedCheque" ADD COLUMN "pvNo" TEXT;
ALTER TABLE "IssuedCheque" ADD COLUMN "fiscalYearId" TEXT;
ALTER TABLE "IssuedCheque" ADD COLUMN "authorityId" TEXT;
ALTER TABLE "IssuedCheque" ADD COLUMN "payeeCategory" "PayeeCategory";
ALTER TABLE "IssuedCheque" ADD COLUMN "transferToAccountId" TEXT;

-- payeeName/payeeType were required (this is where a transfer has no
-- value at all — no external party involved).
ALTER TABLE "IssuedCheque" ALTER COLUMN "payeeName" DROP NOT NULL;
ALTER TABLE "IssuedCheque" ALTER COLUMN "payeeType" DROP NOT NULL;

-- ---- 3. Backfill fiscalYearId ---------------------------------------------
-- FiscalYear has no start/end date range stored (just a label like
-- "2083/84"), so there's no way to programmatically infer which FY an
-- existing issued cheque actually belongs to. Best-effort backfill: each
-- company's most recently created fiscal year; a company with no fiscal
-- year at all yet gets a placeholder "Unassigned" one created. Review and
-- reassign old cheques individually afterward if this matters for your
-- reporting — this only affects cheques that existed before this migration.
DO $$
DECLARE
  r RECORD;
  fy_id TEXT;
BEGIN
  FOR r IN SELECT DISTINCT "companyId" FROM "IssuedCheque" LOOP
    SELECT id INTO fy_id FROM "FiscalYear" WHERE "companyId" = r."companyId" ORDER BY "createdAt" DESC LIMIT 1;
    IF fy_id IS NULL THEN
      fy_id := 'legacyfy' || substr(md5(random()::text || clock_timestamp()::text), 1, 17);
      INSERT INTO "FiscalYear" (id, "companyId", year, "createdAt", "updatedAt")
      VALUES (fy_id, r."companyId", 'Unassigned', now(), now());
    END IF;
    UPDATE "IssuedCheque" SET "fiscalYearId" = fy_id WHERE "companyId" = r."companyId" AND "fiscalYearId" IS NULL;
  END LOOP;
END $$;

ALTER TABLE "IssuedCheque" ALTER COLUMN "fiscalYearId" SET NOT NULL;

-- ---- 4. Foreign keys + indexes --------------------------------------------

ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_fiscalYearId_fkey"
  FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_authorityId_fkey"
  FOREIGN KEY ("authorityId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_transferToAccountId_fkey"
  FOREIGN KEY ("transferToAccountId") REFERENCES "CompanyBankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "IssuedCheque_fiscalYearId_idx" ON "IssuedCheque"("fiscalYearId");
CREATE INDEX "IssuedCheque_authorityId_idx" ON "IssuedCheque"("authorityId");
CREATE INDEX "IssuedCheque_transferToAccountId_idx" ON "IssuedCheque"("transferToAccountId");

-- ---- 5. Payee-or-transfer, never both / never neither ---------------------

ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_payee_or_transfer_check" CHECK (
  ("payeeName" IS NOT NULL AND "transferToAccountId" IS NULL)
  OR
  ("payeeName" IS NULL AND "transferToAccountId" IS NOT NULL AND "transferToAccountId" != "companyBankAccountId")
);
