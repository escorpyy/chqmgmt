-- ============================================================================
-- Soft delete for Bank, Staff, CompanyBankAccount.
--
-- Party, Cheque, and IssuedCheque already have deletedAt. Bank, Staff, and
-- CompanyBankAccount didn't, so deleting one that was actually in use just
-- hit the onDelete: Restrict foreign key and failed outright (surfaced to
-- the user as a 409). This brings all three in line: delete now hides the
-- record from new selection while keeping every existing cheque/account
-- that references it intact, and it can be restored from Trash.
--
-- Nothing to backfill — every existing row simply starts undeleted.
-- ============================================================================

ALTER TABLE "Bank" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CompanyBankAccount" ADD COLUMN "deletedAt" TIMESTAMP(3);
