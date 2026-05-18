-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "senderTelegramId" BIGINT NOT NULL,
    "receiverTelegramId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_senderTelegramId_idx" ON "Message"("senderTelegramId");

-- CreateIndex
CREATE INDEX "Message_receiverTelegramId_idx" ON "Message"("receiverTelegramId");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");
