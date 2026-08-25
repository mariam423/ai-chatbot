-- Add the per-message model-caption preference (default: shown).
ALTER TABLE "user_preferences" ADD COLUMN "showModelCaptions" BOOLEAN NOT NULL DEFAULT true;
