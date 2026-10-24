-- Additive only. Apply deliberately to the intended environment; never on app startup.
CREATE TABLE IF NOT EXISTS workforce_coverage_resolutions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 vendor_id integer NOT NULL REFERENCES vendors(id),
 site_id integer NOT NULL REFERENCES site_locations(id),
 gate_station_id uuid NOT NULL REFERENCES gate_stations(id),
 anchor_shift_id uuid NOT NULL REFERENCES work_hub_shifts(id),
 original_user_id integer REFERENCES users(id),
 replacement_user_id integer NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK (kind IN ('temporary','permanent')),
 effective_date date NOT NULL,
 weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
 starts_at_local text NOT NULL,
 ends_at_local text NOT NULL,
 timezone text NOT NULL,
 request_id uuid REFERENCES work_hub_shift_requests(id),
 created_by_id integer NOT NULL REFERENCES users(id),
 operation_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_coverage_resolution_lookup ON workforce_coverage_resolutions(vendor_id,site_id,gate_station_id,effective_date);
-- Access is mediated by the authorized API; no direct client policies.
ALTER TABLE workforce_coverage_resolutions ENABLE ROW LEVEL SECURITY;
