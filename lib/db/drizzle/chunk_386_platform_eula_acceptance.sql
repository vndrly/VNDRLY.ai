-- Platform EULA acceptance on partner and vendor org rows (onboarding + audit).
ALTER TABLE "partners"
  ADD COLUMN IF NOT EXISTS "platform_eula_accepted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "platform_eula_version" text,
  ADD COLUMN IF NOT EXISTS "platform_eula_hash" text,
  ADD COLUMN IF NOT EXISTS "platform_eula_accepted_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "platform_eula_accepted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "platform_eula_version" text,
  ADD COLUMN IF NOT EXISTS "platform_eula_hash" text,
  ADD COLUMN IF NOT EXISTS "platform_eula_accepted_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
