-- Application role for authorization. Existing users remain regular users;
-- Stripe subscription webhooks synchronize active subscribers to PRO.
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';

CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");
