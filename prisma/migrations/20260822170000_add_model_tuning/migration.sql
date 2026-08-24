-- Model & generation tuning per user: preferred default model (UI key from
-- lib/models.ts), sampling temperature, and max completion tokens. Applied to
-- chat requests when the user has configured them.

ALTER TABLE "user_preferences" ADD COLUMN "preferredModel" TEXT;
ALTER TABLE "user_preferences" ADD COLUMN "temperature" REAL;
ALTER TABLE "user_preferences" ADD COLUMN "maxCompletionTokens" INTEGER;
