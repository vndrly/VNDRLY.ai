BEGIN;
CREATE TABLE IF NOT EXISTS gate_stations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id integer NOT NULL REFERENCES site_locations(id) ON DELETE CASCADE,
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gate_stations_site_name_unique ON gate_stations(site_id, name);
INSERT INTO gate_stations(site_id,name) SELECT id,'Main gate' FROM site_locations ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION gate_change_over_provision_station() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO gate_stations(site_id,name) VALUES(NEW.id,'Main gate') ON CONFLICT DO NOTHING;
 RETURN NEW;
END;
$$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='gate_change_over_default_station') THEN
  CREATE TRIGGER gate_change_over_default_station AFTER INSERT ON site_locations FOR EACH ROW EXECUTE FUNCTION gate_change_over_provision_station();
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS gate_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), station_id uuid NOT NULL REFERENCES gate_stations(id),
 operator_id integer NOT NULL REFERENCES users(id), started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz, preparation_id uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS gate_shifts_active_unique ON gate_shifts(station_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS gate_preparations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_id uuid NOT NULL REFERENCES gate_shifts(id),
 prepared_by integer NOT NULL REFERENCES users(id), snapshot jsonb NOT NULL, notes text NOT NULL,
 summary jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_preparations_shift_idx ON gate_preparations(shift_id, created_at);
CREATE TABLE IF NOT EXISTS gate_handovers (
 id uuid PRIMARY KEY, preparation_id uuid NOT NULL UNIQUE REFERENCES gate_preparations(id),
 incoming_shift_id uuid NOT NULL REFERENCES gate_shifts(id), incoming_user_id integer NOT NULL REFERENCES users(id),
 outgoing_name text NOT NULL, incoming_name text NOT NULL, acknowledged_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_handovers_recent_idx ON gate_handovers(acknowledged_at, id);
CREATE TABLE IF NOT EXISTS gate_shift_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), station_id uuid NOT NULL REFERENCES gate_stations(id),
 actor_id integer NOT NULL REFERENCES users(id), item_id uuid NOT NULL, kind text NOT NULL,
 text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_shift_actions_item_idx ON gate_shift_actions(station_id, item_id, created_at);
ALTER TABLE gate_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_shift_actions ENABLE ROW LEVEL SECURITY;
-- API-only tables: no Data API policies or grants. Application checks current
-- users, memberships, assignments and site-specific operational grants.
CREATE OR REPLACE FUNCTION gate_change_over_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Gate handoff history is immutable';
END;
$$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'gate_preparations_immutable') THEN
  CREATE TRIGGER gate_preparations_immutable BEFORE UPDATE OR DELETE ON gate_preparations FOR EACH ROW EXECUTE FUNCTION gate_change_over_immutable();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'gate_handovers_immutable') THEN
  CREATE TRIGGER gate_handovers_immutable BEFORE UPDATE OR DELETE ON gate_handovers FOR EACH ROW EXECUTE FUNCTION gate_change_over_immutable();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'gate_shift_actions_immutable') THEN
  CREATE TRIGGER gate_shift_actions_immutable BEFORE UPDATE OR DELETE ON gate_shift_actions FOR EACH ROW EXECUTE FUNCTION gate_change_over_immutable();
 END IF;
END $$;
COMMIT;
