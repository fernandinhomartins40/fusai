-- AlterTable
ALTER TABLE "AppUser" ADD COLUMN     "asaasCustomerId" TEXT;

-- AlterTable
ALTER TABLE "OutboundWebhook" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "responseStatus" INTEGER;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "publicId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_publicId_key" ON "Payment"("publicId");

