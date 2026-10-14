ALTER TABLE vendors ADD COLUMN IF NOT EXISTS call_transcription_policy jsonb;
ALTER TABLE work_hub_voicemail ADD COLUMN IF NOT EXISTS transcription_state text NOT NULL DEFAULT 'pending';
ALTER TABLE work_hub_meetings ADD COLUMN IF NOT EXISTS attendance_confirmation_required boolean NOT NULL DEFAULT false;
ALTER TABLE work_hub_voicemail ADD COLUMN IF NOT EXISTS transcription_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE work_hub_voicemail ADD COLUMN IF NOT EXISTS transcription_claim_token uuid;
ALTER TABLE work_hub_voicemail ADD COLUMN IF NOT EXISTS transcription_claimed_at timestamptz;
ALTER TABLE work_hub_voicemail ADD COLUMN IF NOT EXISTS transcription_next_attempt_at timestamptz;
