ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_meeting_recording_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_microsoft_365_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "work_hub_exports_enabled" boolean NOT NULL DEFAULT false;
