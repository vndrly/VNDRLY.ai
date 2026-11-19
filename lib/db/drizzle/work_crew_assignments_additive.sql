ALTER TABLE work_hub_crews ADD COLUMN IF NOT EXISTS work_crew jsonb;
ALTER TABLE work_hub_announcements ADD COLUMN IF NOT EXISTS work_crew_id uuid REFERENCES work_hub_crews(id);
