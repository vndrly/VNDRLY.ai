import { Pool } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Only additive DDL. Keep names aligned with lib/db/src/schema/fleet*.ts. */
export const fleetMobileWorkflowsMigration = [
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_org_memberships'::regclass AND conname = 'user_org_memberships_user_vendor_unique') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('user_org_memberships_user_vendor_unique') AND indisunique AND indisvalid) THEN
      RAISE EXCEPTION 'Valid unique vendor membership index required for additive Fleet migration';
    END IF;
    ALTER TABLE user_org_memberships ADD CONSTRAINT user_org_memberships_user_vendor_unique UNIQUE USING INDEX user_org_memberships_user_vendor_unique;
  END IF; END $$`,
  `CREATE TABLE IF NOT EXISTS fleet_yards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL REFERENCES vendors(id),
    name text NOT NULL, time_zone text NOT NULL, destination_id uuid,
    is_home_base boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_yards_version_check CHECK (version > 0),
    CONSTRAINT fleet_yards_company_id_unique UNIQUE (company_id,id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS fleet_yards_company_id_unique ON fleet_yards(company_id,id)`,
  `CREATE INDEX IF NOT EXISTS fleet_yards_company_active_idx ON fleet_yards(company_id,active)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS fleet_yards_home_base_unique ON fleet_yards(company_id) WHERE is_home_base AND active`,

  `CREATE TABLE IF NOT EXISTS fleet_person_capabilities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL REFERENCES vendors(id),
    user_id integer NOT NULL, capabilities text[] NOT NULL DEFAULT '{}',
    version integer NOT NULL DEFAULT 1, granted_by_user_id integer REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_person_capabilities_member_fk FOREIGN KEY (user_id,company_id) REFERENCES user_org_memberships(user_id,vendor_id) ON DELETE CASCADE,
    CONSTRAINT fleet_person_capabilities_version_check CHECK (version > 0),
    CONSTRAINT fleet_person_capabilities_values_check CHECK (capabilities <@ ARRAY['admin','office','dispatch','yard','driver','self_dispatch']::text[]),
    CONSTRAINT fleet_person_capabilities_self_dispatch_check CHECK (NOT ('self_dispatch' = ANY(capabilities)) OR 'driver' = ANY(capabilities))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS fleet_person_capabilities_company_user_unique ON fleet_person_capabilities(company_id,user_id)`,

  `CREATE TABLE IF NOT EXISTS fleet_yard_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL REFERENCES vendors(id),
    yard_id uuid, detail_id uuid, run_id uuid,
    status text NOT NULL DEFAULT 'requested', outcome text,
    requested_by_user_id integer NOT NULL REFERENCES users(id), assigned_to_user_id integer REFERENCES users(id),
    requested_at timestamptz NOT NULL DEFAULT now(), scheduled_at timestamptz,
    started_at timestamptz, reported_at timestamptz,
    requested_asset_ids uuid[] NOT NULL DEFAULT '{}', actual_asset_ids uuid[] NOT NULL DEFAULT '{}',
    findings jsonb NOT NULL DEFAULT '[]'::jsonb, notes text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_yard_orders_yard_fk FOREIGN KEY (company_id,yard_id) REFERENCES fleet_yards(company_id,id),
    CONSTRAINT fleet_yard_orders_version_check CHECK (version > 0),
    CONSTRAINT fleet_yard_orders_status_check CHECK (status IN ('requested','assigned','in_progress','reported')),
    CONSTRAINT fleet_yard_orders_report_check CHECK ((status = 'reported' AND outcome IS NOT NULL AND outcome IN ('ready','needs_attention','unable_to_complete') AND reported_at IS NOT NULL) OR (status <> 'reported' AND outcome IS NULL AND reported_at IS NULL)),
    CONSTRAINT fleet_yard_orders_report_presence_check CHECK (status <> 'reported' OR outcome IS NOT NULL),
    CONSTRAINT fleet_yard_orders_findings_check CHECK (jsonb_typeof(findings) = 'array' AND jsonb_array_length(findings) <= 100),
    CONSTRAINT fleet_yard_orders_company_id_unique UNIQUE (company_id,id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS fleet_yard_orders_company_id_unique ON fleet_yard_orders(company_id,id)`,
  `CREATE INDEX IF NOT EXISTS fleet_yard_orders_company_status_idx ON fleet_yard_orders(company_id,status)`,

  `CREATE TABLE IF NOT EXISTS fleet_yard_order_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL REFERENCES vendors(id),
    order_id uuid NOT NULL, assigned_to_user_id integer NOT NULL REFERENCES users(id), assigned_by_user_id integer NOT NULL REFERENCES users(id),
    assigned_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
    CONSTRAINT fleet_yard_order_assignments_order_fk FOREIGN KEY (company_id,order_id) REFERENCES fleet_yard_orders(company_id,id),
    CONSTRAINT fleet_yard_order_assignments_time_check CHECK (ended_at IS NULL OR ended_at >= assigned_at)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS fleet_yard_order_assignments_current_unique ON fleet_yard_order_assignments(company_id,order_id) WHERE ended_at IS NULL`,

  `CREATE TABLE IF NOT EXISTS fleet_yard_order_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL REFERENCES vendors(id),
    order_id uuid NOT NULL, operation_id uuid NOT NULL, actor_user_id integer NOT NULL REFERENCES users(id),
    event_type text NOT NULL, order_version integer NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_yard_order_events_order_fk FOREIGN KEY (company_id,order_id) REFERENCES fleet_yard_orders(company_id,id),
    CONSTRAINT fleet_yard_order_events_version_check CHECK (order_version > 0),
    CONSTRAINT fleet_yard_order_events_detail_check CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 32768)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS fleet_yard_order_events_operation_unique ON fleet_yard_order_events(operation_id)`,
  `CREATE INDEX IF NOT EXISTS fleet_yard_order_events_history_idx ON fleet_yard_order_events(company_id,order_id,occurred_at)`,

  `CREATE TABLE IF NOT EXISTS fleet_asset_custody (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL REFERENCES vendors(id),
    asset_id uuid NOT NULL REFERENCES assets(id), state text NOT NULL, method text NOT NULL,
    observed_at timestamptz NOT NULL DEFAULT now(), observed_by_user_id integer NOT NULL REFERENCES users(id),
    yard_id uuid, run_id uuid, detail_id uuid, latitude double precision, longitude double precision,
    notes text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_asset_custody_yard_fk FOREIGN KEY (company_id,yard_id) REFERENCES fleet_yards(company_id,id),
    CONSTRAINT fleet_asset_custody_version_check CHECK (version > 0),
    CONSTRAINT fleet_asset_custody_state_check CHECK (state IN ('intake','at_yard','reserved','attached','in_transit','returned','transferred')),
    CONSTRAINT fleet_asset_custody_method_check CHECK (method IN ('gate_scan','gps_geofence','manual','driver_app')),
    CONSTRAINT fleet_asset_custody_coordinates_check CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
    CONSTRAINT fleet_asset_custody_coordinates_pair_check CHECK ((latitude IS NULL) = (longitude IS NULL)),
    CONSTRAINT fleet_asset_custody_company_asset_unique UNIQUE (company_id,asset_id),
    CONSTRAINT fleet_asset_custody_asset_unique UNIQUE (asset_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS fleet_asset_custody_company_asset_unique ON fleet_asset_custody(company_id,asset_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS fleet_asset_custody_asset_unique ON fleet_asset_custody(asset_id)`,
  `CREATE INDEX IF NOT EXISTS fleet_asset_custody_company_state_idx ON fleet_asset_custody(company_id,state)`,

  `CREATE TABLE IF NOT EXISTS fleet_asset_custody_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation_id uuid NOT NULL,
    company_id integer NOT NULL REFERENCES vendors(id), asset_id uuid NOT NULL REFERENCES assets(id),
    state text NOT NULL, method text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
    observed_by_user_id integer NOT NULL REFERENCES users(id), yard_id uuid, run_id uuid, detail_id uuid,
    latitude double precision, longitude double precision, notes text NOT NULL DEFAULT '',
    asset_version integer NOT NULL DEFAULT 1, occurred_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fleet_asset_custody_events_current_fk FOREIGN KEY (company_id,asset_id) REFERENCES fleet_asset_custody(company_id,asset_id),
    CONSTRAINT fleet_asset_custody_events_yard_fk FOREIGN KEY (company_id,yard_id) REFERENCES fleet_yards(company_id,id),
    CONSTRAINT fleet_asset_custody_events_version_check CHECK (asset_version > 0),
    CONSTRAINT fleet_asset_custody_events_state_check CHECK (state IN ('intake','at_yard','reserved','attached','in_transit','returned','transferred')),
    CONSTRAINT fleet_asset_custody_events_method_check CHECK (method IN ('gate_scan','gps_geofence','manual','driver_app')),
    CONSTRAINT fleet_asset_custody_events_coordinates_check CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
    CONSTRAINT fleet_asset_custody_events_coordinates_pair_check CHECK ((latitude IS NULL) = (longitude IS NULL))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS fleet_asset_custody_events_operation_unique ON fleet_asset_custody_events(operation_id)`,
  `CREATE INDEX IF NOT EXISTS fleet_asset_custody_events_history_idx ON fleet_asset_custody_events(company_id,asset_id,occurred_at)`,

  `CREATE OR REPLACE FUNCTION fleet_mobile_reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Fleet workflow events are append only'; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'fleet_yard_order_events'::regclass AND tgname = 'fleet_yard_order_events_immutable') THEN
    CREATE TRIGGER fleet_yard_order_events_immutable BEFORE UPDATE OR DELETE ON fleet_yard_order_events FOR EACH ROW EXECUTE FUNCTION fleet_mobile_reject_event_mutation(); END IF; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'fleet_asset_custody_events'::regclass AND tgname = 'fleet_asset_custody_events_immutable') THEN
    CREATE TRIGGER fleet_asset_custody_events_immutable BEFORE UPDATE OR DELETE ON fleet_asset_custody_events FOR EACH ROW EXECUTE FUNCTION fleet_mobile_reject_event_mutation(); END IF; END $$`,
  `CREATE OR REPLACE FUNCTION fleet_mobile_assert_asset_company() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NOT EXISTS (SELECT 1 FROM assets WHERE id = NEW.asset_id AND responsible_org_type = 'vendor' AND responsible_org_id = NEW.company_id) THEN
      RAISE EXCEPTION 'Fleet custody asset must belong to company'; END IF; RETURN NEW; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'fleet_asset_custody'::regclass AND tgname = 'fleet_asset_custody_company_guard') THEN
    CREATE TRIGGER fleet_asset_custody_company_guard BEFORE INSERT OR UPDATE ON fleet_asset_custody FOR EACH ROW EXECUTE FUNCTION fleet_mobile_assert_asset_company(); END IF; END $$`,
  // Scope at the moment of writing, while retaining provenance if membership is later removed.
  `CREATE OR REPLACE FUNCTION fleet_mobile_assert_member() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE actor_id integer;
    BEGIN actor_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::integer;
      IF actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_org_memberships WHERE user_id = actor_id AND vendor_id = NEW.company_id) THEN
        RAISE EXCEPTION 'Fleet actor must belong to company';
      END IF;
      RETURN NEW;
    END $$`,
  `DO $$ DECLARE item record; trigger_name text; BEGIN
    FOR item IN SELECT * FROM (VALUES
      ('fleet_person_capabilities','granted_by_user_id'),
      ('fleet_yard_orders','requested_by_user_id'),
      ('fleet_yard_orders','assigned_to_user_id'),
      ('fleet_yard_order_assignments','assigned_to_user_id'),
      ('fleet_yard_order_assignments','assigned_by_user_id'),
      ('fleet_yard_order_events','actor_user_id'),
      ('fleet_asset_custody','observed_by_user_id'),
      ('fleet_asset_custody_events','observed_by_user_id')
    ) AS fields(table_name,column_name) LOOP
      trigger_name := item.table_name || '_' || item.column_name || '_scope';
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass(item.table_name) AND tgname = trigger_name) THEN
        EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION fleet_mobile_assert_member(%L)', trigger_name, item.column_name, item.table_name, item.column_name);
      END IF;
    END LOOP;
  END $$`,
  `CREATE OR REPLACE FUNCTION fleet_mobile_reject_company_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Fleet record company cannot change';
    END IF; RETURN NEW; END $$`,
  `DO $$ DECLARE table_name text; trigger_name text; BEGIN
    FOREACH table_name IN ARRAY ARRAY['fleet_yards','fleet_person_capabilities','fleet_yard_orders','fleet_yard_order_assignments','fleet_asset_custody'] LOOP
      trigger_name := table_name || '_company_immutable';
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass(table_name) AND tgname = trigger_name) THEN
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OF company_id ON %I FOR EACH ROW EXECUTE FUNCTION fleet_mobile_reject_company_change()', trigger_name, table_name);
      END IF;
    END LOOP;
  END $$`,
] as const;

/** Replays also repair checks on tables initially created by an older Drizzle schema. */
const checkRepairs = [
  ["fleet_yards", "fleet_yards_version_check", "version > 0"],
  ["fleet_person_capabilities", "fleet_person_capabilities_version_check", "version > 0"],
  ["fleet_person_capabilities", "fleet_person_capabilities_values_check", "capabilities <@ ARRAY['admin','office','dispatch','yard','driver','self_dispatch']::text[]"],
  ["fleet_person_capabilities", "fleet_person_capabilities_self_dispatch_check", "NOT ('self_dispatch' = ANY(capabilities)) OR 'driver' = ANY(capabilities)"],
  ["fleet_yard_orders", "fleet_yard_orders_version_check", "version > 0"],
  ["fleet_yard_orders", "fleet_yard_orders_status_check", "status IN ('requested','assigned','in_progress','reported')"],
  ["fleet_yard_orders", "fleet_yard_orders_report_check", "(status = 'reported' AND outcome IS NOT NULL AND outcome IN ('ready','needs_attention','unable_to_complete') AND reported_at IS NOT NULL) OR (status <> 'reported' AND outcome IS NULL AND reported_at IS NULL)"],
  ["fleet_yard_orders", "fleet_yard_orders_report_presence_check", "status <> 'reported' OR outcome IS NOT NULL"],
  ["fleet_yard_orders", "fleet_yard_orders_findings_check", "jsonb_typeof(findings) = 'array' AND jsonb_array_length(findings) <= 100"],
  ["fleet_yard_order_assignments", "fleet_yard_order_assignments_time_check", "ended_at IS NULL OR ended_at >= assigned_at"],
  ["fleet_yard_order_events", "fleet_yard_order_events_version_check", "order_version > 0"],
  ["fleet_yard_order_events", "fleet_yard_order_events_detail_check", "jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 32768"],
  ["fleet_asset_custody", "fleet_asset_custody_version_check", "version > 0"],
  ["fleet_asset_custody", "fleet_asset_custody_state_check", "state IN ('intake','at_yard','reserved','attached','in_transit','returned','transferred')"],
  ["fleet_asset_custody", "fleet_asset_custody_method_check", "method IN ('gate_scan','gps_geofence','manual','driver_app')"],
  ["fleet_asset_custody", "fleet_asset_custody_coordinates_check", "(latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)"],
  ["fleet_asset_custody", "fleet_asset_custody_coordinates_pair_check", "(latitude IS NULL) = (longitude IS NULL)"],
  ["fleet_asset_custody_events", "fleet_asset_custody_events_version_check", "asset_version > 0"],
  ["fleet_asset_custody_events", "fleet_asset_custody_events_state_check", "state IN ('intake','at_yard','reserved','attached','in_transit','returned','transferred')"],
  ["fleet_asset_custody_events", "fleet_asset_custody_events_method_check", "method IN ('gate_scan','gps_geofence','manual','driver_app')"],
  ["fleet_asset_custody_events", "fleet_asset_custody_events_coordinates_check", "(latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)"],
  ["fleet_asset_custody_events", "fleet_asset_custody_events_coordinates_pair_check", "(latitude IS NULL) = (longitude IS NULL)"],
] as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fleet_mobile_workflows_migration'))");
    for (const statement of fleetMobileWorkflowsMigration) await client.query(statement);
    for (const [table, name, definition] of checkRepairs) {
      await client.query(`DO $$ BEGIN IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('${table}') AND conname = '${name}'
      ) THEN ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${definition}); END IF; END $$`);
    }
    await client.query("COMMIT");
    console.log("Fleet mobile workflow tables ready");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export function isFleetMigrationMain(moduleUrl: string, argvPath: string | undefined, platform: NodeJS.Platform = process.platform): boolean {
  if (!argvPath) return false;
  const windows = platform === "win32";
  const pathApi = windows ? path.win32 : path.posix;
  const modulePath = pathApi.resolve(fileURLToPath(moduleUrl, { windows }));
  const invokedPath = pathApi.resolve(argvPath);
  return windows ? modulePath.toLowerCase() === invokedPath.toLowerCase() : modulePath === invokedPath;
}

if (isFleetMigrationMain(import.meta.url, process.argv[1])) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
