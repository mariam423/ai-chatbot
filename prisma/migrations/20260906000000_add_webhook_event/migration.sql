-- CreateTable
CREATE TABLE "webhook_events" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "webhook_events_userId_idx" ON "webhook_events"("userId");