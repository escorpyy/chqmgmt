-- ============================================================================
-- Manual migration additions
-- ============================================================================
-- Prisma's schema language can't express CHECK constraints, functional
-- indexes, or triggers. Run this AFTER `prisma migrate dev` (append it to
-- the generated migration.sql, or apply as a follow-up migration file:
--   npx prisma migrate dev --create-only --name manual_constraints
--   (paste this into the generated migration.sql, then run
--   npx prisma migrate dev)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Amounts must be positive
-- ----------------------------------------------------------------------------
ALTER TABLE "Cheque"              ADD CONSTRAINT chk_cheque_amount_positive          CHECK (amount > 0);
ALTER TABLE "IssuedCheque"        ADD CONSTRAINT chk_issuedcheque_amount_positive    CHECK (amount > 0);
ALTER TABLE "ChequePayment"       ADD CONSTRAINT chk_chequepayment_amount_positive   CHECK (amount > 0);
ALTER TABLE "IssuedChequePayment" ADD CONSTRAINT chk_issuedpayment_amount_positive   CHECK (amount > 0);


-- ----------------------------------------------------------------------------
-- 2. totalDays: never negative, and only meaningful once statusDate >= chqDate
-- ----------------------------------------------------------------------------
ALTER TABLE "Cheque" ADD CONSTRAINT chk_cheque_totaldays_valid
  CHECK ("totalDays" IS NULL OR ("totalDays" >= 0 AND "statusDate" >= "chqDate"));

ALTER TABLE "IssuedCheque" ADD CONSTRAINT chk_issuedcheque_totaldays_valid
  CHECK ("totalDays" IS NULL OR ("totalDays" >= 0 AND "statusDate" >= "chqDate"));


-- ----------------------------------------------------------------------------
-- 3. A cheque can't replace itself
-- ----------------------------------------------------------------------------
ALTER TABLE "Cheque" ADD CONSTRAINT chk_cheque_no_self_replace
  CHECK ("replacesChequeId" IS NULL OR "replacesChequeId" != id);

ALTER TABLE "IssuedCheque" ADD CONSTRAINT chk_issuedcheque_no_self_replace
  CHECK ("replacesChequeId" IS NULL OR "replacesChequeId" != id);


-- ----------------------------------------------------------------------------
-- 4. Party firm/individual sanity
--    - A FIRM-type party shouldn't itself belong to another firm
--    - A party can't be its own firm
-- ----------------------------------------------------------------------------
ALTER TABLE "Party" ADD CONSTRAINT chk_party_firm_not_nested
  CHECK (type != 'FIRM' OR "firmId" IS NULL);

ALTER TABLE "Party" ADD CONSTRAINT chk_party_not_own_firm
  CHECK ("firmId" IS NULL OR "firmId" != id);


-- ----------------------------------------------------------------------------
-- 5. Follow-up / check-log date ordering
--    (cross-field, single-row — CHECK constraints handle these fine)
-- ----------------------------------------------------------------------------
ALTER TABLE "ChequeFollowUp" ADD CONSTRAINT chk_followup_next_action_after
  CHECK ("nextActionDate" IS NULL OR "nextActionDate" >= "followUpDate");

ALTER TABLE "IssuedChequeFollowUp" ADD CONSTRAINT chk_issuedfollowup_next_action_after
  CHECK ("nextActionDate" IS NULL OR "nextActionDate" >= "followUpDate");

ALTER TABLE "ChequeCheckLog" ADD CONSTRAINT chk_checklog_resolved_after_raised
  CHECK ("resolvedAt" IS NULL OR "resolvedAt" >= "raisedAt");

ALTER TABLE "IssuedChequeCheckLog" ADD CONSTRAINT chk_issuedchecklog_resolved_after_raised
  CHECK ("resolvedAt" IS NULL OR "resolvedAt" >= "raisedAt");


-- ----------------------------------------------------------------------------
-- 6. Case-insensitive uniqueness on Bank.name
--    ("ABC Bank" and "abc bank" should not both be allowed)
-- ----------------------------------------------------------------------------
ALTER TABLE "Bank" DROP CONSTRAINT IF EXISTS "Bank_name_key"; -- drop the case-sensitive unique Prisma created
CREATE UNIQUE INDEX bank_name_ci_unique ON "Bank" (lower(name));


-- ----------------------------------------------------------------------------
-- 7. Cumulative payments must never exceed the cheque's amount
--    (cross-row aggregate rule — needs a trigger, not a CHECK constraint)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_cheque_payment_total() RETURNS TRIGGER AS $$
DECLARE
  cheque_amount   NUMERIC(14,2);
  total_paid      NUMERIC(14,2);
BEGIN
  SELECT amount INTO cheque_amount FROM "Cheque" WHERE id = NEW."chequeId";
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
    FROM "ChequePayment"
    WHERE "chequeId" = NEW."chequeId" AND id != NEW.id;

  IF total_paid + NEW.amount > cheque_amount THEN
    RAISE EXCEPTION 'Payment of % would push total payments (%) beyond cheque amount (%) for cheque %',
      NEW.amount, total_paid + NEW.amount, cheque_amount, NEW."chequeId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_cheque_payment_total
  BEFORE INSERT OR UPDATE ON "ChequePayment"
  FOR EACH ROW EXECUTE FUNCTION check_cheque_payment_total();


CREATE OR REPLACE FUNCTION check_issuedcheque_payment_total() RETURNS TRIGGER AS $$
DECLARE
  cheque_amount   NUMERIC(14,2);
  total_paid      NUMERIC(14,2);
BEGIN
  SELECT amount INTO cheque_amount FROM "IssuedCheque" WHERE id = NEW."issuedChequeId";
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
    FROM "IssuedChequePayment"
    WHERE "issuedChequeId" = NEW."issuedChequeId" AND id != NEW.id;

  IF total_paid + NEW.amount > cheque_amount THEN
    RAISE EXCEPTION 'Payment of % would push total payments (%) beyond issued cheque amount (%) for cheque %',
      NEW.amount, total_paid + NEW.amount, cheque_amount, NEW."issuedChequeId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_issuedcheque_payment_total
  BEFORE INSERT OR UPDATE ON "IssuedChequePayment"
  FOR EACH ROW EXECUTE FUNCTION check_issuedcheque_payment_total();


-- ----------------------------------------------------------------------------
-- N. DailyBankBalance: opening balance and received-today can't go negative
--    (unlike Cheque/IssuedCheque amounts, 0 is a valid balance, so >= not >)
-- ----------------------------------------------------------------------------
ALTER TABLE "DailyBankBalance" ADD CONSTRAINT chk_dailybankbalance_opening_nonnegative
  CHECK ("openingBalance" >= 0);
ALTER TABLE "DailyBankBalance" ADD CONSTRAINT chk_dailybankbalance_received_nonnegative
  CHECK ("receivedToday" >= 0);


-- ----------------------------------------------------------------------------
-- NOT included here (needs app-level logic, not a DB rule):
--   - referenceNo required when method IN ('IPS','CIPS','QR') but optional
--     for CASH — this is a *conditional* requirement based on another
--     column's value on the SAME insert, which a CHECK constraint CAN
--     technically express, but is easy to get wrong and easy to bypass
--     via bulk-loads/migrations. Recommend enforcing in the app layer
--     (or add as a CHECK if you want DB-level enforcement too):
--       CHECK (method NOT IN ('IPS','CIPS','QR') OR "referenceNo" IS NOT NULL)
--   - issuedOnType/chequeType and payeeType/chequeType consistency
--     (FIRM -> ACCOUNT_PAYEE, INDIVIDUAL -> BEARER) — better enforced by
--     deriving chequeType automatically in app code rather than trusting
--     two independently-set fields to agree.
-- ============================================================================
