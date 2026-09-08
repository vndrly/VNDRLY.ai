ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS calendar_type text NOT NULL DEFAULT 'company';
ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS project_name text;
ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS milestone_status text NOT NULL DEFAULT 'upcoming';
ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS percent_complete integer NOT NULL DEFAULT 0;
ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS shared_with_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
