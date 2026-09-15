-- ============================================================================
-- Parties gain an explicit role: customer, vendor, or both. Previously every
-- party was shown in both the received-cheque issuer picker and the
-- issued-cheque payee picker with no way to tell them apart, which is why
-- staff had trouble finding the right vendor in a list full of customers.
--
-- isCustomer defaults to true so existing parties keep working exactly as
-- they did in the received-cheque flow (the app's original, customer-facing
-- surface) with zero behavior change. isVendor defaults to false, then gets
-- backfilled true for any party that's actually been used as a payee on an
-- issued cheque, so the vendor picker isn't empty on first deploy.
-- ============================================================================

ALTER TABLE "Party" ADD COLUMN "isCustomer" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Party" ADD COLUMN "isVendor"   BOOLEAN NOT NULL DEFAULT false;

UPDATE "Party" p SET "isVendor" = true
WHERE EXISTS (SELECT 1 FROM "IssuedCheque" ic WHERE ic."payeeId" = p.id);

CREATE INDEX "Party_isCustomer_idx" ON "Party"("isCustomer");
CREATE INDEX "Party_isVendor_idx" ON "Party"("isVendor");
