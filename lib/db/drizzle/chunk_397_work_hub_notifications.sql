ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "work_hub_messages_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "work_hub_tasks_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "work_hub_announcements_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "work_hub_schedule_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "work_hub_meetings_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "work_hub_digest_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "work_hub_urgent_bypass_dnd_enabled" boolean NOT NULL DEFAULT false;
