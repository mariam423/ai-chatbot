-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "chat_sessions_userId_idx" ON "chat_sessions"("userId");
