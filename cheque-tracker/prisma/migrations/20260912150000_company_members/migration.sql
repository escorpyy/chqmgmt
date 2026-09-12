-- ============================================================================
-- Company membership (shared company access).
--
-- Previously a company was only ever visible to the user who created it
-- (Company.createdById). That meant any second user — including a STAFF
-- account created specifically for day-to-day data entry — had zero
-- companies to select and couldn't see or touch any data at all.
--
-- This adds CompanyMember: an explicit grant of access to a company for a
-- user who isn't its creator. Membership is managed by admins only (see
-- POST/DELETE /api/companies/:id/members). Nothing to backfill — this
-- starts empty; every existing company keeps working exactly as before via
-- its createdById owner, this just adds an additional way in.
-- ============================================================================

CREATE TABLE "CompanyMember" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyMember_companyId_userId_key" ON "CompanyMember"("companyId", "userId");
CREATE INDEX "CompanyMember_companyId_idx" ON "CompanyMember"("companyId");
CREATE INDEX "CompanyMember_userId_idx" ON "CompanyMember"("userId");

-- Pure access-control rows, not financial history — cascade on delete
-- rather than the Restrict used elsewhere in this schema, so removing a
-- company or a user doesn't get blocked by a leftover membership grant.
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
