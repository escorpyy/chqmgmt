-- AlterTable
ALTER TABLE "FiscalYear" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "session" ALTER COLUMN "sess" SET DATA TYPE JSONB;
