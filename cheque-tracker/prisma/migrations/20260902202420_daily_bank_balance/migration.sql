-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('PENDING', 'FOLLOWUP', 'ON_CHECK', 'PRESENTED', 'CLEARED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ClearanceMethod" AS ENUM ('PRESENTMENT', 'PARTIAL_RECOVERY');

-- CreateEnum
CREATE TYPE "FollowUpResponse" AS ENUM ('CONFIRMED', 'REQUESTED_DELAY', 'REQUESTED_REPLACEMENT', 'REQUESTED_PARTIAL_PAYMENT', 'REQUESTED_RETURN', 'UNREACHABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('INSUFFICIENT_FUNDS', 'SIGNATURE_MISMATCH', 'ACCOUNT_CLOSED', 'STOPPED_BY_ISSUER', 'DATE_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'IPS', 'CIPS', 'QR', 'BANK_DEPOSIT', 'OTHER');

-- CreateEnum
CREATE TYPE "IssuedChequeStatus" AS ENUM ('ISSUED', 'FOLLOWUP', 'ON_CHECK', 'PRESENTED', 'CLEARED', 'RETURNED', 'STOPPED');

-- CreateEnum
CREATE TYPE "IssuedFollowUpResponse" AS ENUM ('WILL_REPRESENT', 'REQUESTED_REPLACEMENT', 'REQUESTED_PARTIAL_PAYMENT', 'DISPUTE', 'UNREACHABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('FIRM', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "ChequeType" AS ENUM ('ACCOUNT_PAYEE', 'BEARER');

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "receiptNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "type" "PartyType" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "panNo" TEXT,
    "firmId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bank" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBankAccount" (
    "id" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyBankBalance" (
    "id" TEXT NOT NULL,
    "companyBankAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "receivedToday" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyBankBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cheque" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "refNo" TEXT,
    "issuerId" TEXT NOT NULL,
    "issuedOn" TEXT NOT NULL,
    "issuedOnType" "PartyType" NOT NULL,
    "chequeType" "ChequeType" NOT NULL,
    "payableToCompany" BOOLEAN NOT NULL DEFAULT true,
    "chqDate" TIMESTAMP(3) NOT NULL,
    "chqNo" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "presentedBankId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "ChequeStatus" NOT NULL DEFAULT 'PENDING',
    "statusDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousStatus" "ChequeStatus",
    "totalDays" INTEGER,
    "clearanceMethod" "ClearanceMethod",
    "returnReason" "ReturnReason",
    "returnNote" TEXT,
    "replacesChequeId" TEXT,
    "staffId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChequeFollowUp" (
    "id" TEXT NOT NULL,
    "chequeId" TEXT NOT NULL,
    "followUpDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response" "FollowUpResponse" NOT NULL,
    "note" TEXT,
    "nextActionDate" TIMESTAMP(3),
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChequeFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChequePayment" (
    "id" TEXT NOT NULL,
    "chequeId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "referenceNo" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChequePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedCheque" (
    "id" TEXT NOT NULL,
    "companyBankAccountId" TEXT NOT NULL,
    "chqNo" TEXT NOT NULL,
    "chqDate" TIMESTAMP(3) NOT NULL,
    "payeeId" TEXT,
    "payeeName" TEXT NOT NULL,
    "payeeType" "PartyType" NOT NULL,
    "chequeType" "ChequeType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "purpose" TEXT,
    "status" "IssuedChequeStatus" NOT NULL DEFAULT 'ISSUED',
    "statusDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalDays" INTEGER,
    "previousStatus" "IssuedChequeStatus",
    "clearanceMethod" "ClearanceMethod",
    "returnReason" "ReturnReason",
    "returnNote" TEXT,
    "replacesChequeId" TEXT,
    "issuedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuedCheque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedChequeFollowUp" (
    "id" TEXT NOT NULL,
    "issuedChequeId" TEXT NOT NULL,
    "followUpDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response" "IssuedFollowUpResponse" NOT NULL,
    "note" TEXT,
    "nextActionDate" TIMESTAMP(3),
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedChequeFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedChequePayment" (
    "id" TEXT NOT NULL,
    "issuedChequeId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "referenceNo" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedChequePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChequeCheckLog" (
    "id" TEXT NOT NULL,
    "chequeId" TEXT NOT NULL,
    "raisedById" TEXT,
    "reason" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedStatus" "ChequeStatus",
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChequeCheckLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedChequeCheckLog" (
    "id" TEXT NOT NULL,
    "issuedChequeId" TEXT NOT NULL,
    "raisedById" TEXT,
    "reason" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedStatus" "IssuedChequeStatus",
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuedChequeCheckLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Party_panNo_key" ON "Party"("panNo");

-- CreateIndex
CREATE INDEX "Party_name_idx" ON "Party"("name");

-- CreateIndex
CREATE INDEX "Party_firmId_idx" ON "Party"("firmId");

-- CreateIndex
CREATE INDEX "Party_deletedAt_idx" ON "Party"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bank_name_key" ON "Bank"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBankAccount_accountNumber_key" ON "CompanyBankAccount"("accountNumber");

-- CreateIndex
CREATE INDEX "CompanyBankAccount_bankId_idx" ON "CompanyBankAccount"("bankId");

-- CreateIndex
CREATE INDEX "DailyBankBalance_date_idx" ON "DailyBankBalance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBankBalance_companyBankAccountId_date_key" ON "DailyBankBalance"("companyBankAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_replacesChequeId_key" ON "Cheque"("replacesChequeId");

-- CreateIndex
CREATE INDEX "Cheque_status_chqDate_idx" ON "Cheque"("status", "chqDate");

-- CreateIndex
CREATE INDEX "Cheque_chqDate_idx" ON "Cheque"("chqDate");

-- CreateIndex
CREATE INDEX "Cheque_receiptId_idx" ON "Cheque"("receiptId");

-- CreateIndex
CREATE INDEX "Cheque_issuerId_idx" ON "Cheque"("issuerId");

-- CreateIndex
CREATE INDEX "Cheque_presentedBankId_idx" ON "Cheque"("presentedBankId");

-- CreateIndex
CREATE INDEX "Cheque_staffId_idx" ON "Cheque"("staffId");

-- CreateIndex
CREATE INDEX "Cheque_deletedAt_idx" ON "Cheque"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_bankId_chqNo_key" ON "Cheque"("bankId", "chqNo");

-- CreateIndex
CREATE INDEX "ChequeFollowUp_chequeId_idx" ON "ChequeFollowUp"("chequeId");

-- CreateIndex
CREATE INDEX "ChequeFollowUp_staffId_idx" ON "ChequeFollowUp"("staffId");

-- CreateIndex
CREATE INDEX "ChequePayment_chequeId_idx" ON "ChequePayment"("chequeId");

-- CreateIndex
CREATE INDEX "ChequePayment_staffId_idx" ON "ChequePayment"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCheque_replacesChequeId_key" ON "IssuedCheque"("replacesChequeId");

-- CreateIndex
CREATE INDEX "IssuedCheque_status_chqDate_idx" ON "IssuedCheque"("status", "chqDate");

-- CreateIndex
CREATE INDEX "IssuedCheque_chqDate_idx" ON "IssuedCheque"("chqDate");

-- CreateIndex
CREATE INDEX "IssuedCheque_payeeId_idx" ON "IssuedCheque"("payeeId");

-- CreateIndex
CREATE INDEX "IssuedCheque_issuedById_idx" ON "IssuedCheque"("issuedById");

-- CreateIndex
CREATE INDEX "IssuedCheque_deletedAt_idx" ON "IssuedCheque"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCheque_companyBankAccountId_chqNo_key" ON "IssuedCheque"("companyBankAccountId", "chqNo");

-- CreateIndex
CREATE INDEX "IssuedChequeFollowUp_issuedChequeId_idx" ON "IssuedChequeFollowUp"("issuedChequeId");

-- CreateIndex
CREATE INDEX "IssuedChequeFollowUp_staffId_idx" ON "IssuedChequeFollowUp"("staffId");

-- CreateIndex
CREATE INDEX "IssuedChequePayment_issuedChequeId_idx" ON "IssuedChequePayment"("issuedChequeId");

-- CreateIndex
CREATE INDEX "IssuedChequePayment_staffId_idx" ON "IssuedChequePayment"("staffId");

-- CreateIndex
CREATE INDEX "ChequeCheckLog_chequeId_idx" ON "ChequeCheckLog"("chequeId");

-- CreateIndex
CREATE INDEX "ChequeCheckLog_raisedById_idx" ON "ChequeCheckLog"("raisedById");

-- CreateIndex
CREATE INDEX "IssuedChequeCheckLog_issuedChequeId_idx" ON "IssuedChequeCheckLog"("issuedChequeId");

-- CreateIndex
CREATE INDEX "IssuedChequeCheckLog_raisedById_idx" ON "IssuedChequeCheckLog"("raisedById");

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBankAccount" ADD CONSTRAINT "CompanyBankAccount_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyBankBalance" ADD CONSTRAINT "DailyBankBalance_companyBankAccountId_fkey" FOREIGN KEY ("companyBankAccountId") REFERENCES "CompanyBankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_presentedBankId_fkey" FOREIGN KEY ("presentedBankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_replacesChequeId_fkey" FOREIGN KEY ("replacesChequeId") REFERENCES "Cheque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequeFollowUp" ADD CONSTRAINT "ChequeFollowUp_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "Cheque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequeFollowUp" ADD CONSTRAINT "ChequeFollowUp_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequePayment" ADD CONSTRAINT "ChequePayment_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "Cheque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequePayment" ADD CONSTRAINT "ChequePayment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_companyBankAccountId_fkey" FOREIGN KEY ("companyBankAccountId") REFERENCES "CompanyBankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_replacesChequeId_fkey" FOREIGN KEY ("replacesChequeId") REFERENCES "IssuedCheque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedChequeFollowUp" ADD CONSTRAINT "IssuedChequeFollowUp_issuedChequeId_fkey" FOREIGN KEY ("issuedChequeId") REFERENCES "IssuedCheque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedChequeFollowUp" ADD CONSTRAINT "IssuedChequeFollowUp_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedChequePayment" ADD CONSTRAINT "IssuedChequePayment_issuedChequeId_fkey" FOREIGN KEY ("issuedChequeId") REFERENCES "IssuedCheque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedChequePayment" ADD CONSTRAINT "IssuedChequePayment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequeCheckLog" ADD CONSTRAINT "ChequeCheckLog_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "Cheque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequeCheckLog" ADD CONSTRAINT "ChequeCheckLog_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedChequeCheckLog" ADD CONSTRAINT "IssuedChequeCheckLog_issuedChequeId_fkey" FOREIGN KEY ("issuedChequeId") REFERENCES "IssuedCheque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedChequeCheckLog" ADD CONSTRAINT "IssuedChequeCheckLog_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
