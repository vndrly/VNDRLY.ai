BEGIN;

ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS site_location_id integer REFERENCES site_locations(id);
ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS gate_station_id uuid REFERENCES gate_stations(id);
ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS required_staff_count integer;
ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS work_start_policy text;
CREATE INDEX IF NOT EXISTS work_hub_shifts_gate_time_idx ON work_hub_shifts(gate_station_id, starts_at, ends_at);

ALTER TABLE workforce_coverage_records ADD COLUMN IF NOT EXISTS gate_station_id uuid REFERENCES gate_stations(id);
ALTER TABLE workforce_coverage_records ADD COLUMN IF NOT EXISTS actual_count integer NOT NULL DEFAULT 0;
ALTER TABLE workforce_coverage_records ADD COLUMN IF NOT EXISTS coverage_kind text NOT NULL DEFAULT 'general';
ALTER TABLE workforce_coverage_records ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;

CREATE TABLE IF NOT EXISTS gate_work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES users(id),
  work_hub_shift_id uuid REFERENCES work_hub_shifts(id),
  owner_org_type text NOT NULL,
  owner_org_id integer NOT NULL,
  start_policy text NOT NULL,
  travel_status text NOT NULL DEFAULT 'not_started',
  eta_at timestamptz,
  eta_source text,
  location_sharing_active boolean NOT NULL DEFAULT false,
  tracking_status text NOT NULL DEFAULT 'not_required',
  tracking_exception_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  arrived_at timestamptz,
  ended_at timestamptz,
  start_latitude double precision,
  start_longitude double precision,
  source text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_work_sessions_user_active_idx ON gate_work_sessions(user_id, ended_at);
CREATE INDEX IF NOT EXISTS gate_work_sessions_shift_idx ON gate_work_sessions(work_hub_shift_id, started_at);

CREATE TABLE IF NOT EXISTS gate_duty_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES gate_stations(id),
  user_id integer NOT NULL REFERENCES users(id),
  work_hub_shift_id uuid REFERENCES work_hub_shifts(id),
  work_session_id uuid REFERENCES gate_work_sessions(id),
  source_legacy_shift_id uuid UNIQUE REFERENCES gate_shifts(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by_user_id integer REFERENCES users(id),
  end_reason text,
  source text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_duty_sessions_station_active_idx ON gate_duty_sessions(station_id, ended_at);
CREATE UNIQUE INDEX IF NOT EXISTS gate_duty_sessions_user_station_active_unique ON gate_duty_sessions(station_id, user_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS gate_attendance_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_hub_shift_id uuid NOT NULL REFERENCES work_hub_shifts(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'unresolved',
  disposition text,
  reason text,
  resolved_by_user_id integer REFERENCES users(id),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(work_hub_shift_id, user_id)
);
CREATE INDEX IF NOT EXISTS gate_attendance_exceptions_unresolved_idx ON gate_attendance_exceptions(state, detected_at);

CREATE TABLE IF NOT EXISTS gate_coverage_status (
  station_id uuid PRIMARY KEY REFERENCES gate_stations(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'active',
  paused_until timestamptz,
  reason text,
  changed_by_user_id integer NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gate_visit_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id integer NOT NULL REFERENCES site_visits(id),
  action text NOT NULL,
  reason text NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  reverses_reconciliation_id uuid REFERENCES gate_visit_reconciliations(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_visit_reconciliations_visit_time_idx ON gate_visit_reconciliations(visit_id, created_at);

CREATE TABLE IF NOT EXISTS gate_report_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id integer NOT NULL REFERENCES users(id),
  recipient_user_id integer NOT NULL REFERENCES users(id),
  report_kind text NOT NULL,
  format text NOT NULL,
  filters jsonb NOT NULL,
  recipient_scope jsonb NOT NULL,
  token_hash text NOT NULL UNIQUE,
  delivery_key text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  opened_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_report_deliveries_recipient_time_idx ON gate_report_deliveries(recipient_user_id, created_at);

INSERT INTO gate_duty_sessions(
  station_id, user_id, source_legacy_shift_id, started_at, source, idempotency_key
)
SELECT station_id, operator_id, id, started_at, 'legacy_backfill', 'legacy-shift:' || id::text
FROM gate_shifts
WHERE ended_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM gate_duty_sessions existing
    WHERE existing.station_id = gate_shifts.station_id
      AND existing.user_id = gate_shifts.operator_id
      AND existing.ended_at IS NULL
  )
ON CONFLICT (source_legacy_shift_id) DO NOTHING;

ALTER TABLE gate_work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_duty_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_attendance_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_coverage_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_visit_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_report_deliveries ENABLE ROW LEVEL SECURITY;

COMMIT;
