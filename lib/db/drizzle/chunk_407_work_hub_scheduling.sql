BEGIN;
CREATE TABLE IF NOT EXISTS work_hub_scheduling_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_org_type text NOT NULL, owner_org_id integer NOT NULL,
 host_user_id integer NOT NULL REFERENCES users(id), title text NOT NULL, description text NOT NULL DEFAULT '',
 duration_minutes integer NOT NULL, timezone text NOT NULL, visibility text NOT NULL DEFAULT 'personal',
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_hub_scheduling_types_owner_idx ON work_hub_scheduling_types(owner_org_type, owner_org_id);
CREATE TABLE IF NOT EXISTS work_hub_scheduling_availability (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type_id uuid NOT NULL REFERENCES work_hub_scheduling_types(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_hub_scheduling_availability_type_idx ON work_hub_scheduling_availability(type_id, starts_at);
COMMIT;
