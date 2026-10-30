import pg from "pg";
import { demoOwnerConnection, assertDemoMigrationIdentity } from "./ios-parity-demo-policy";

// The isolated demo receives the same additive columns, never a reseed/restore.
if (!process.env.DATABASE_URL || !process.env.DEMO_DATABASE_URL) throw Error("Both production and isolated demo database configuration are required");
const production = new pg.Client({ connectionString: process.env.DATABASE_URL });
const demo = new pg.Client({ connectionString: process.env.DEMO_DATABASE_URL });
// Runtime demo credentials remain least privileged. Reuse the existing owner
// credential only in this process, with a strictly verified distinct target.
const owner = new pg.Client({ connectionString: demoOwnerConnection(process.env.DATABASE_URL, process.env.DEMO_DATABASE_URL) });
try {
  await Promise.all([production.connect(), demo.connect(), owner.connect()]);
  const identity = "select current_database() name, host(inet_server_addr()) address, inet_server_port() port, pg_postmaster_start_time()::text started, current_user role";
  const [a, b, c] = await Promise.all([production.query(identity), demo.query(identity), owner.query(identity)]);
  assertDemoMigrationIdentity(a.rows[0], b.rows[0], c.rows[0]);
  if (process.argv.includes("--verify-only")) { console.log("Distinct demo owner and runtime cluster identities verified; no DDL executed."); }
  else {
  await owner.query("BEGIN");
  for (const statement of [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_pin_hash text",
    "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS native_operations_policy jsonb NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE partners ADD COLUMN IF NOT EXISTS native_operations_policy jsonb NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE work_hub_device_preferences ADD COLUMN IF NOT EXISTS native_operations jsonb NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS gate_identity_document jsonb",
    "ALTER TABLE work_hub_user_events ADD COLUMN IF NOT EXISTS retention_until timestamptz",
    "ALTER TABLE field_push_tokens ADD COLUMN IF NOT EXISTS native_device_id uuid",
    "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS operations_categories text[]",
    "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS fleet_commercial_settings jsonb",
    "ALTER TABLE partners ADD COLUMN IF NOT EXISTS fleet_commercial_settings jsonb",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fleet_plan jsonb",
    "ALTER TABLE site_locations ADD COLUMN IF NOT EXISTS fleet_ticket_policy jsonb",
    "ALTER TABLE site_locations ADD COLUMN IF NOT EXISTS gate_link_id uuid",
    "ALTER TABLE site_locations ADD COLUMN IF NOT EXISTS gate_link_name text",
    "ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS connection jsonb",
    "ALTER TABLE gate_duty_sessions ADD COLUMN IF NOT EXISTS post_coverage jsonb NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE vendor_people ADD COLUMN IF NOT EXISTS staff_enrollment jsonb",
    "ALTER TABLE user_org_memberships ADD COLUMN IF NOT EXISTS staff_enrollment jsonb",
    "ALTER TABLE managed_subcontractor_worker_sponsorships ADD COLUMN IF NOT EXISTS staff_enrollment jsonb",
    "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS staff_role_catalog jsonb",
    "ALTER TABLE workforce_staffing_requirements ADD COLUMN IF NOT EXISTS gate_definition jsonb",
    "ALTER TABLE work_hub_shifts ADD COLUMN IF NOT EXISTS gate_definition_id uuid",
  ]) await owner.query(statement.replace("ALTER TABLE ", "ALTER TABLE public."));
  await owner.query("COMMIT");
  console.log("Isolated demo parity columns available; rows and credentials preserved.");
  }
} catch (error) {
  await owner.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await Promise.all([production.end(), demo.end(), owner.end()]);
}
