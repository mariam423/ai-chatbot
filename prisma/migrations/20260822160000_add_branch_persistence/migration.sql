-- Persist conversation branches: each message belongs to a branch (by index),
-- and the session remembers which branch was last active so it is restored on
-- session switch / reload. A message may appear in several branches (the shared
-- prefix of a fork), so the row identity becomes (sessionId, branchId, id) —
-- one row per branch, replacing the id-only primary key.

ALTER TABLE "chat_sessions" ADD COLUMN "activeBranch" INTEGER NOT NULL DEFAULT 0;

-- SQLite cannot alter a primary key, so rebuild chat_messages with the
-- composite identity and copy the existing rows (all land on branch "0").
CREATE TABLE "chat_messages_new" (
  "sessionId" TEXT NOT NULL,
  "role"      TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "position"  INTEGER NOT NULL,
  "branchId"  TEXT NOT NULL DEFAULT '0',
  "id"        TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("sessionId","branchId","id")
);

INSERT INTO "chat_messages_new" ("sessionId", "role", "content", "position", "branchId", "id", "createdAt")
  SELECT "sessionId", "role", "content", "position", "0", "id", "createdAt"
  FROM "chat_messages";

DROP TABLE "chat_messages";
ALTER TABLE "chat_messages_new" RENAME TO "chat_messages";

CREATE INDEX "chat_messages_sessionId_branchId_position_idx"
  ON "chat_messages"("sessionId", "branchId", "position");
