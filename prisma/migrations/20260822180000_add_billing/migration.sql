-- SaaS billing (FR: plan tiers + usage limits). Users get a plan ("free" |
-- "pro"), Stripe customer/subscription ids, and a daily usage counter used to
-- enforce the free tier's request cap.

ALTER TABLE "users" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "users" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "users" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "users" ADD COLUMN "usageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "usageDate" TEXT;
