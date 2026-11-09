-- Additive incident storage. Existing watches, assignments and notifications stay intact.
CREATE TABLE IF NOT EXISTS gate_staffing_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL,
 owner_org_type text NOT NULL,
 owner_org_id integer NOT NULL,
 site_id integer NOT NULL REFERENCES site_locations(id),
 station_id uuid NOT NULL REFERENCES gate_stations(id),
 shift_id uuid NOT NULL REFERENCES work_hub_shifts(id),
 status text NOT NULL DEFAULT 'open',
 kind text NOT NULL,
 severity text NOT NULL,
 required_count integer NOT NULL,
 actual_count integer NOT NULL,
 notifications_paused boolean NOT NULL DEFAULT false,
 acknowledged_at timestamptz,
 acknowledged_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
 acknowledged_by_name text,
 acknowledged_channel text,
 resolved_at timestamptz,
 resolution_reason text,
 last_notified_at timestamptz,
 escalated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT gate_staffing_alerts_owner_check CHECK(owner_org_type IN ('vendor','partner')),
 CONSTRAINT gate_staffing_alerts_status_check CHECK(status IN ('open','acknowledged','resolved'))
);
ALTER TABLE gate_staffing_alerts ADD COLUMN IF NOT EXISTS resolution_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS gate_staffing_alerts_code_unique ON gate_staffing_alerts(code);
CREATE UNIQUE INDEX IF NOT EXISTS gate_staffing_alerts_active_shift_unique ON gate_staffing_alerts(shift_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS gate_staffing_alerts_owner_status_idx ON gate_staffing_alerts(owner_org_type,owner_org_id,status);
CREATE INDEX IF NOT EXISTS gate_staffing_alerts_station_idx ON gate_staffing_alerts(station_id,resolved_at);
CREATE TABLE IF NOT EXISTS gate_staffing_alert_notifications (
 notification_id integer PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
 alert_id uuid NOT NULL REFERENCES gate_staffing_alerts(id),
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_staffing_alert_notifications_alert_idx ON gate_staffing_alert_notifications(alert_id,user_id);
-- API-only authority. Replays avoid needless table locks after RLS is enabled.
DO $$ BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='gate_staffing_alerts'::regclass) THEN
   ALTER TABLE gate_staffing_alerts ENABLE ROW LEVEL SECURITY;
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='gate_staffing_alert_notifications'::regclass) THEN
   ALTER TABLE gate_staffing_alert_notifications ENABLE ROW LEVEL SECURITY;
 END IF;
END $$;
