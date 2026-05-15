-- Add referral fields to User table
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT UNIQUE;
ALTER TABLE "User" ADD COLUMN "referralRewardRemaining" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Create ReferralReward table
CREATE TABLE "ReferralReward" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "referrerTelegramId" BIGINT NOT NULL,
    "referredTelegramId" BIGINT NOT NULL,
    "rewardAmount" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "ReferralReward_referrerTelegramId_referredTelegramId_key" UNIQUE("referrerTelegramId", "referredTelegramId"),
    CONSTRAINT "ReferralReward_referrerTelegramId_fkey" FOREIGN KEY ("referrerTelegramId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReferralReward_referredTelegramId_fkey" FOREIGN KEY ("referredTelegramId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Create indexes for ReferralReward
CREATE INDEX "ReferralReward_referrerTelegramId_idx" ON "ReferralReward"("referrerTelegramId");
CREATE INDEX "ReferralReward_referredTelegramId_idx" ON "ReferralReward"("referredTelegramId");

-- Create index for referralCode lookup
CREATE INDEX "User_referralCode_idx" ON "User"("referralCode");
