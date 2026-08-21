/*
  Warnings:

  - Added the required column `position` to the `chat_messages` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chat_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chat_messages" ("content", "createdAt", "id", "role", "sessionId") SELECT "content", "createdAt", "id", "role", "sessionId" FROM "chat_messages";
DROP TABLE "chat_messages";
ALTER TABLE "new_chat_messages" RENAME TO "chat_messages";
CREATE INDEX "chat_messages_sessionId_position_idx" ON "chat_messages"("sessionId", "position");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
