ALTER TABLE "users" ADD COLUMN "usageTokens" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "custom_agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "modelKey" TEXT,
    "toolConfig" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "custom_agents_userId_updatedAt_idx" ON "custom_agents"("userId", "updatedAt");

ALTER TABLE "chat_sessions" ADD COLUMN "customAgentId" TEXT;
CREATE INDEX "chat_sessions_customAgentId_idx" ON "chat_sessions"("customAgentId");
