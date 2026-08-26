-- SQLite cannot alter a column default in place. Rebuild users while
-- preserving all existing account, billing, and usage data.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "passwordHash" TEXT,
    "emailVerified" DATETIME,
    "role" TEXT NOT NULL DEFAULT 'FREE',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "usageDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_users" (
    "id", "email", "name", "image", "passwordHash", "emailVerified",
    "role", "plan", "stripeCustomerId", "stripeSubscriptionId",
    "usageCount", "usageDate", "createdAt"
)
SELECT
    "id", "email", "name", "image", "passwordHash", "emailVerified",
    CASE "role"
      WHEN 'PRO' THEN 'PRO'
      WHEN 'ADMIN' THEN 'ADMIN'
      ELSE 'FREE'
    END,
    "plan", "stripeCustomerId", "stripeSubscriptionId",
    "usageCount", "usageDate", "createdAt"
FROM "users";

DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

PRAGMA foreign_keys=ON;
