-- Persist which provider model served each assistant message (stamped
-- client-side from the route's X-Served-Model header) plus whether it
-- differed from the user's selection (error-fallback retry or vision
-- auto-routing). NULL for rows that predate the field.

ALTER TABLE "chat_messages" ADD COLUMN "model" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN "modelOverridden" BOOLEAN;
