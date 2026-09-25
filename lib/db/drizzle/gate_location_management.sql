-- Coordinates remain nullable for existing supervisor-created stations.
-- Never infer physical gate coordinates from the partner's wellhead.
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS geofence_radius_m integer NOT NULL DEFAULT 500;
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS gate_stations_site_active_idx ON gate_stations(site_id, active);
