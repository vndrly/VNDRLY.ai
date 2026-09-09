ALTER TABLE work_hub_meeting_chat ADD COLUMN IF NOT EXISTS recipient_user_id integer REFERENCES users(id);
ALTER TABLE work_hub_meeting_chat ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'typed';
ALTER TABLE work_hub_meeting_chat ADD COLUMN IF NOT EXISTS attachment jsonb;
ALTER TABLE work_hub_meeting_participants ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE work_hub_meeting_participants ADD COLUMN IF NOT EXISTS removed_by_id integer REFERENCES users(id);
ALTER TABLE work_hub_meeting_occurrences ADD COLUMN IF NOT EXISTS askv_invited_at timestamptz;
ALTER TABLE work_hub_meeting_occurrences ADD COLUMN IF NOT EXISTS askv_invited_by_id integer REFERENCES users(id);
ALTER TABLE work_hub_meeting_occurrences ADD COLUMN IF NOT EXISTS runtime jsonb NOT NULL DEFAULT '{}';
