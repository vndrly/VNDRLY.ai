ALTER TABLE "work_hub_channels"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'organization';
