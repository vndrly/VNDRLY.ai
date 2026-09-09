BEGIN;
CREATE TABLE IF NOT EXISTS work_hub_crews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, owner_org_type text NOT NULL, owner_org_id integer NOT NULL, created_by_id integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS work_hub_crew_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), crew_id uuid NOT NULL REFERENCES work_hub_crews(id), user_id integer NOT NULL REFERENCES users(id), mode text NOT NULL DEFAULT 'member');
CREATE UNIQUE INDEX IF NOT EXISTS work_hub_crew_members_unique ON work_hub_crew_members (crew_id, user_id);
CREATE TABLE IF NOT EXISTS work_hub_collaboration_channels (channel_id uuid PRIMARY KEY REFERENCES work_hub_channels(id), crew_id uuid REFERENCES work_hub_crews(id), kind text NOT NULL);
CREATE TABLE IF NOT EXISTS work_hub_chat_invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel_id uuid NOT NULL REFERENCES work_hub_channels(id), sender_user_id integer NOT NULL REFERENCES users(id), recipient_user_id integer NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS work_hub_chat_invitation_recipient_unique ON work_hub_chat_invitations (channel_id, recipient_user_id);
CREATE TABLE IF NOT EXISTS work_hub_preferences (user_id integer PRIMARY KEY REFERENCES users(id), preferences jsonb NOT NULL DEFAULT '{}');
COMMIT;
