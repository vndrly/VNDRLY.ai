ALTER TABLE work_hub_meetings ADD COLUMN IF NOT EXISTS admission_mode text;
ALTER TABLE work_hub_meeting_participants ADD COLUMN IF NOT EXISTS admission_state text;
ALTER TABLE work_hub_meeting_participants ADD COLUMN IF NOT EXISTS admission_requested_at timestamptz;
ALTER TABLE work_hub_meeting_participants ADD COLUMN IF NOT EXISTS admission_decided_at timestamptz;
ALTER TABLE work_hub_meeting_participants ADD COLUMN IF NOT EXISTS admission_decided_by_id integer REFERENCES users(id);
