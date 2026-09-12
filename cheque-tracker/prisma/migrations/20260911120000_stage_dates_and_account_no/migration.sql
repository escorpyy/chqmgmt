-- ============================================================================
-- Per-stage cheque timestamps, received-side account no., and two new
-- statuses (DEPOSITED, CANCELLED) on the received-cheque side.
--
-- Why: statusDate only ever reflects the CURRENT status, so once a cheque
-- moves past e.g. PRESENTED to CLEARED, the date it was presented is lost.
-- The register needs a stable "Deposit date" / "Clearance date" etc. that
-- doesn't get overwritten by later transitions — so each stage now gets its
-- own nullable timestamp column, stamped once and left alone from then on.
-- Existing rows are left with these columns NULL; nothing is backfilled,
-- since we have no reliable historical date to backfill from (statusDate
-- has already been overwritten for any cheque that moved past one stage).
-- ============================================================================

-- Add new enum values. Must run outside of (or at least not depend on,
-- within the same statement) any INSERT/UPDATE using them — this migration
-- does neither, so it's safe under Prisma's per-migration transaction.
ALTER TYPE "ChequeStatus" ADD VALUE IF NOT EXISTS 'DEPOSITED';
ALTER TYPE "ChequeStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Received cheques (Cheque table)
ALTER TABLE "Cheque"
  ADD COLUMN "accountNo"   TEXT,
  ADD COLUMN "depositedAt" TIMESTAMP(3),
  ADD COLUMN "presentedAt" TIMESTAMP(3),
  ADD COLUMN "clearedAt"   TIMESTAMP(3),
  ADD COLUMN "bouncedAt"   TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- Issued cheques (IssuedCheque table) — no accountNo (already has
-- companyBankAccount -> accountNumber) and no depositedAt (we don't deposit
-- our own issued cheques, the payee does).
ALTER TABLE "IssuedCheque"
  ADD COLUMN "presentedAt" TIMESTAMP(3),
  ADD COLUMN "clearedAt"   TIMESTAMP(3),
  ADD COLUMN "bouncedAt"   TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);