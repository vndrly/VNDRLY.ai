import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

type DbClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> };

export const COMPANYGO_FLEET_ACCOUNTS = [
  { login: "vendor_admin@fleetgo.com", capabilities: ["admin", "office", "dispatch", "yard", "driver", "self_dispatch"] },
  { login: "vendor_office@fleetgo.com", capabilities: ["office"] },
  { login: "vendor_fleet_dispatch@fleetgo.com", capabilities: ["dispatch"] },
  { login: "vendor_fleet_driver@fleetgo.com", capabilities: ["yard", "driver", "self_dispatch"] },
] as const;

export function stableCompanyGoUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(`companygo:fleet-mobile:${value}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const yardId = stableCompanyGoUuid("yard:home");
const historyTicketBase = 1_870_000_000;
const custodyOperationIds = [1, 2, 3].map((ordinal) => stableCompanyGoUuid(`custody-event:${ordinal}`));
const orders = [
  { key: "requested", status: "requested", outcome: null, assignee: null, offset: "6 days", note: "Upcoming ticket detail awaiting yard assignment." },
  { key: "assigned", status: "assigned", outcome: null, assignee: "vendor_fleet_driver@fleetgo.com", offset: "2 days", note: "Driver and Yard capability coverage for a small-shop hookup." },
  { key: "in-progress", status: "in_progress", outcome: null, assignee: "vendor_fleet_driver@fleetgo.com", offset: "-1 hour", note: "Rigging package is being assembled and inspected." },
  { key: "ready", status: "reported", outcome: "ready", assignee: "vendor_fleet_driver@fleetgo.com", offset: "-2 days", note: "Truck and rigging verified ready for dispatch." },
  { key: "attention", status: "reported", outcome: "needs_attention", assignee: "vendor_fleet_driver@fleetgo.com", offset: "-5 days", note: "Substitute trailer recorded; Dispatch may continue ticket flow." },
] as const;

const capabilitySql = `
WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1),
spec(login, capabilities, fixture_id) AS (VALUES
${COMPANYGO_FLEET_ACCOUNTS.map((row) => `  ('${row.login}', ARRAY[${row.capabilities.map((c) => `'${c}'`).join(",")}]::text[], '${stableCompanyGoUuid(`capability:${row.login}`)}'::uuid)`).join(",\n")}
), resolved AS (
  SELECT f.id company_id, u.id user_id, s.capabilities, s.fixture_id
  FROM fleetgo f JOIN spec s ON true
  JOIN users u ON lower(coalesce(u.email,u.username)) = s.login
  JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=f.id
)
INSERT INTO fleet_person_capabilities(id,company_id,user_id,capabilities,version,granted_by_user_id)
SELECT fixture_id,company_id,user_id,capabilities,1,
  (SELECT u.id FROM users u WHERE lower(coalesce(u.email,u.username))='vendor_admin@fleetgo.com' LIMIT 1)
FROM resolved ON CONFLICT DO NOTHING;
WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1),
spec(login, capabilities) AS (VALUES
${COMPANYGO_FLEET_ACCOUNTS.map((row) => `  ('${row.login}', ARRAY[${row.capabilities.map((c) => `'${c}'`).join(",")}]::text[])`).join(",\n")}
), resolved AS (
  SELECT f.id company_id, u.id user_id, s.capabilities
  FROM fleetgo f JOIN spec s ON true
  JOIN users u ON lower(coalesce(u.email,u.username)) = s.login
  JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=f.id
)
UPDATE fleet_person_capabilities current
SET capabilities=(SELECT array_agg(DISTINCT capability ORDER BY capability) FROM unnest(current.capabilities || resolved.capabilities) capability),
    version=current.version+1,updated_at=now()
FROM resolved
WHERE current.company_id=resolved.company_id AND current.user_id=resolved.user_id
  AND NOT current.capabilities @> resolved.capabilities`;

const orderSql = `
WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1),
actors AS (
 SELECT f.id company_id,
  (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1) dispatcher_id,
  (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_driver@fleetgo.com' LIMIT 1) driver_id
 FROM fleetgo f
), asset_pool AS (
 SELECT array_agg(id ORDER BY id) FILTER (WHERE ordinal <= 3) asset_ids FROM (
  SELECT a.id,row_number() OVER(ORDER BY a.id) ordinal FROM assets a JOIN fleetgo f ON a.responsible_org_type='vendor' AND a.responsible_org_id=f.id WHERE a.retired_at IS NULL
 ) ranked
), spec(id,status,outcome,assignee,scheduled_at,notes) AS (VALUES
${orders.map((row) => ` ('${stableCompanyGoUuid(`yard-order:${row.key}`)}'::uuid,'${row.status}',${row.outcome ? `'${row.outcome}'` : "NULL"},${row.assignee ? "'driver'" : "NULL"},now()+interval '${row.offset}','${row.note.replaceAll("'", "''")}')`).join(",\n")}
)
INSERT INTO fleet_yard_orders(id,company_id,yard_id,status,outcome,requested_by_user_id,assigned_to_user_id,requested_at,scheduled_at,started_at,reported_at,requested_asset_ids,actual_asset_ids,findings,notes,version)
SELECT s.id,a.company_id,'${yardId}',s.status,s.outcome,a.dispatcher_id,
 CASE WHEN s.assignee='driver' THEN a.driver_id END,now()-interval '7 days',s.scheduled_at,
 CASE WHEN s.status IN ('in_progress','reported') THEN s.scheduled_at END,
 CASE WHEN s.status='reported' THEN s.scheduled_at+interval '30 minutes' END,
 coalesce(p.asset_ids,'{}'::uuid[]),CASE WHEN s.status='reported' THEN coalesce(p.asset_ids,'{}'::uuid[]) ELSE '{}'::uuid[] END,
 CASE WHEN s.outcome='needs_attention' THEN jsonb_build_array(jsonb_build_object('assetId',(p.asset_ids)[1],'kind','substituted','note','Recorded substitute; advisory only')) ELSE '[]'::jsonb END,
 s.notes,1 FROM spec s CROSS JOIN actors a CROSS JOIN asset_pool p ON CONFLICT DO NOTHING`;

export const COMPANYGO_FLEET_SEED_SQL = [
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1)
   INSERT INTO fleet_yards(id,company_id,name,time_zone,is_home_base,active,version)
   SELECT '${yardId}',id,'FleetGo Stanton Yard','America/Chicago',true,true,1 FROM fleetgo ON CONFLICT DO NOTHING`,
  capabilitySql,
  orderSql,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1), driver AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), dispatcher AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1)
   INSERT INTO fleet_yard_order_assignments(id,company_id,order_id,assigned_to_user_id,assigned_by_user_id,assigned_at,ended_at)
   SELECT '${stableCompanyGoUuid("assignment:driver")}',f.id,'${stableCompanyGoUuid("yard-order:assigned")}',d.id,x.id,now()-interval '1 day',NULL FROM fleetgo f CROSS JOIN driver d CROSS JOIN dispatcher x ON CONFLICT DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1), actor AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1), rows(order_id,event_type,version,operation_id) AS (VALUES
   ('${stableCompanyGoUuid("yard-order:requested")}'::uuid,'requested',1,'${stableCompanyGoUuid("event:requested")}'::uuid),
   ('${stableCompanyGoUuid("yard-order:assigned")}'::uuid,'assigned',1,'${stableCompanyGoUuid("event:assigned")}'::uuid),
   ('${stableCompanyGoUuid("yard-order:in-progress")}'::uuid,'started',1,'${stableCompanyGoUuid("event:started")}'::uuid),
   ('${stableCompanyGoUuid("yard-order:ready")}'::uuid,'reported',1,'${stableCompanyGoUuid("event:ready")}'::uuid),
   ('${stableCompanyGoUuid("yard-order:attention")}'::uuid,'reported',1,'${stableCompanyGoUuid("event:attention")}'::uuid))
   INSERT INTO fleet_yard_order_events(id,company_id,order_id,operation_id,actor_user_id,event_type,order_version,detail,occurred_at)
   SELECT gen_random_uuid(),f.id,r.order_id,r.operation_id,a.id,r.event_type,r.version,jsonb_build_object('fixture','companygo-fleet-mobile'),now()-interval '1 day' FROM rows r CROSS JOIN fleetgo f CROSS JOIN actor a ON CONFLICT DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1), driver AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), selected AS (SELECT a.id,row_number() OVER(ORDER BY a.id) ordinal FROM assets a JOIN fleetgo f ON a.responsible_org_type = 'vendor' AND a.responsible_org_id=f.id WHERE a.retired_at IS NULL LIMIT 3)
   INSERT INTO fleet_asset_custody(id,company_id,asset_id,state,method,observed_at,observed_by_user_id,yard_id,notes,version)
   SELECT gen_random_uuid(),f.id,s.id,CASE WHEN s.ordinal=1 THEN 'attached' WHEN s.ordinal=2 THEN 'reserved' ELSE 'at_yard' END,'driver_app',now()-interval '30 minutes',d.id,'${yardId}','CompanyGo canonical Fleet custody fixture',1 FROM selected s CROSS JOIN fleetgo f CROSS JOIN driver d ON CONFLICT DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1), driver AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), selected AS (SELECT a.id,row_number() OVER(ORDER BY a.id) ordinal FROM assets a JOIN fleetgo f ON a.responsible_org_type = 'vendor' AND a.responsible_org_id=f.id WHERE a.retired_at IS NULL LIMIT 3)
   INSERT INTO fleet_asset_custody_events(id,operation_id,company_id,asset_id,state,method,observed_at,observed_by_user_id,yard_id,notes,asset_version,occurred_at)
   SELECT gen_random_uuid(),CASE s.ordinal WHEN 1 THEN '${custodyOperationIds[0]}'::uuid WHEN 2 THEN '${custodyOperationIds[1]}'::uuid ELSE '${custodyOperationIds[2]}'::uuid END,f.id,s.id,CASE WHEN s.ordinal=1 THEN 'attached' WHEN s.ordinal=2 THEN 'reserved' ELSE 'at_yard' END,'driver_app',now()-interval '30 minutes',d.id,'${yardId}','CompanyGo canonical readback receipt',1,now()-interval '30 minutes' FROM selected s CROSS JOIN fleetgo f CROSS JOIN driver d ON CONFLICT DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name)='fleetgo' LIMIT 1), gasgo AS (SELECT id FROM partners WHERE lower(name)='gasgo' LIMIT 1), site AS (SELECT s.id FROM site_locations s JOIN gasgo g ON s.partner_id=g.id ORDER BY s.id LIMIT 1), work AS (SELECT w.id FROM vendor_work_types w JOIN fleetgo f ON w.vendor_id=f.id ORDER BY w.id LIMIT 1), employee AS (SELECT vp.id FROM vendor_people vp JOIN users u ON u.id=vp.user_id JOIN fleetgo f ON vp.vendor_id=f.id WHERE lower(coalesce(u.email,u.username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), creator AS (SELECT u.id FROM users u WHERE lower(coalesce(u.email,u.username))='vendor_admin@fleetgo.com' LIMIT 1), days AS (SELECT generate_series(0,29) n)
   INSERT INTO tickets(id,site_location_id,vendor_id,field_employee_id,work_type_id,status,intake_channel,description,notes,check_in_time,check_out_time,lifecycle_state,scheduled_start_at,scheduled_duration_minutes,created_by_id,closed_by_id,closed_at,approved_at,created_at,updated_at)
   SELECT ${historyTicketBase}+d.n,s.id,f.id,e.id,w.id,'approved','partner_self_service','CompanyGo completed Fleet run day '||(d.n+1),'Stable additive 30-day Fleet workflow fixture',current_date-d.n+interval '08:00',current_date-d.n+interval '16:00','off_site',current_date-d.n+interval '08:00',480,c.id,c.id,current_date-d.n+interval '16:00',current_date-d.n+interval '17:00',current_date-d.n+interval '07:00',current_date-d.n+interval '17:00' FROM days d CROSS JOIN fleetgo f CROSS JOIN site s CROSS JOIN work w CROSS JOIN employee e CROSS JOIN creator c ON CONFLICT(id) DO NOTHING`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name)='fleetgo' LIMIT 1), gasgo AS (SELECT id FROM partners WHERE lower(name)='gasgo' LIMIT 1), site AS (SELECT s.id FROM site_locations s JOIN gasgo g ON s.partner_id=g.id ORDER BY s.id LIMIT 1), work AS (SELECT w.id FROM vendor_work_types w JOIN fleetgo f ON w.vendor_id=f.id ORDER BY w.id LIMIT 1), employee AS (SELECT vp.id FROM vendor_people vp JOIN users u ON u.id=vp.user_id JOIN fleetgo f ON vp.vendor_id=f.id WHERE lower(coalesce(u.email,u.username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), creator AS (SELECT u.id FROM users u WHERE lower(coalesce(u.email,u.username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1), days AS (SELECT generate_series(0,6) n)
   INSERT INTO tickets(id,site_location_id,vendor_id,field_employee_id,work_type_id,status,intake_channel,description,notes,lifecycle_state,scheduled_start_at,scheduled_duration_minutes,created_by_id,created_at,updated_at)
   SELECT ${historyTicketBase}+100+d.n,s.id,f.id,e.id,w.id,'initiated','partner_self_service','CompanyGo scheduled Fleet run day '||(d.n+1),'Stable additive seven-day Fleet schedule fixture','pending_arrival',current_date+d.n+interval '08:00',480,c.id,now(),now() FROM days d CROSS JOIN fleetgo f CROSS JOIN site s CROSS JOIN work w CROSS JOIN employee e CROSS JOIN creator c ON CONFLICT(id) DO NOTHING`,
  `INSERT INTO ticket_line_items(ticket_id,type,description,quantity,unit_price,fleet_billing_metadata)
   SELECT t.id,'labor','CompanyGo Fleet day rate',1,1250,jsonb_build_object('fixture','companygo-fleet-mobile','billingMode','per_day') FROM tickets t WHERE t.id BETWEEN ${historyTicketBase} AND ${historyTicketBase}+29 AND NOT EXISTS(SELECT 1 FROM ticket_line_items li WHERE li.ticket_id=t.id AND li.description='CompanyGo Fleet day rate')`,
  `WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name)='fleetgo' LIMIT 1), actor AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_dispatch@fleetgo.com' LIMIT 1), driver AS (SELECT id FROM users WHERE lower(coalesce(email,username))='vendor_fleet_driver@fleetgo.com' LIMIT 1), site AS (SELECT s.id FROM site_locations s JOIN partners p ON p.id=s.partner_id WHERE lower(p.name)='gasgo' ORDER BY s.id LIMIT 1), vehicle AS (SELECT a.id FROM assets a JOIN fleetgo f ON a.responsible_org_type='vendor' AND a.responsible_org_id=f.id WHERE a.retired_at IS NULL ORDER BY a.id LIMIT 1), days(n,run_id,stop_id) AS (VALUES
   ${Array.from({ length: 30 }, (_, n) => `(${n},'${stableCompanyGoUuid(`run:history:${n}`)}'::uuid,'${stableCompanyGoUuid(`run:history:${n}:stop`)}'::uuid)`).join(",\n   ")})
   INSERT INTO assistant_action_audit(user_id,vendor_id,actor_role,actor_membership_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status,created_at)
   SELECT a.id,f.id,'vendor','office','fleet','fixture','canonical','fleet_run','fleet-run-snapshot','fleet-run',d.run_id::text,jsonb_build_object('fixture','companygo-fleet-mobile'),jsonb_build_object(
     'id',d.run_id::text,'fleetId','6fefab43-28cc-4e90-967c-347c28c48a13','companyId',f.id,'title','CompanyGo completed Fleet run day '||(d.n+1),
     'driverUserId',u.id,'vehicleAssetId',v.id,'trailerAssetId',NULL,'siteIds',jsonb_build_array(s.id),'status','completed','phase',NULL,'version',1,
     'stops',jsonb_build_array(jsonb_build_object('id',d.stop_id::text,'siteId',s.id,'kind','delivery','sequence',0)),'loads','[]'::jsonb,'inspections','[]'::jsonb,
     'currentStopId',NULL,'visitedStopIds',jsonb_build_array(d.stop_id::text),'events','[]'::jsonb,'linkedTicketId',${historyTicketBase}+d.n,'allowedActions','[]'::jsonb
   ),'completed',current_date-d.n+interval '17:00' FROM days d CROSS JOIN fleetgo f CROSS JOIN actor a CROSS JOIN driver u CROSS JOIN site s CROSS JOIN vehicle v WHERE NOT EXISTS(SELECT 1 FROM assistant_action_audit prior WHERE prior.vendor_id=f.id AND prior.target_type='fleet-run' AND prior.target_id=d.run_id::text)`,
] as const;

export const COMPANYGO_FLEET_ACCEPTANCE_SQL = `
WITH fleetgo AS (SELECT id FROM vendors WHERE lower(name) = 'fleetgo' LIMIT 1),
gasgo AS (SELECT id FROM partners WHERE lower(name) = 'gasgo' LIMIT 1)
SELECT
 (SELECT count(DISTINCT t.check_in_time::date) FROM tickets t JOIN fleetgo f ON t.vendor_id=f.id WHERE t.check_in_time::date BETWEEN current_date - 29 AND current_date) history_days,
 (SELECT count(DISTINCT t.scheduled_start_at::date) FROM tickets t JOIN fleetgo f ON t.vendor_id=f.id WHERE t.scheduled_start_at::date BETWEEN current_date AND current_date + 6) scheduled_days,
 (SELECT count(*) FROM tickets t JOIN fleetgo f ON t.vendor_id=f.id) ticket_count,
 (SELECT count(*) FROM ticket_line_items li JOIN tickets t ON t.id=li.ticket_id JOIN fleetgo f ON t.vendor_id=f.id) billing_line_count,
 (SELECT count(*) FROM assistant_action_audit a JOIN fleetgo f ON a.vendor_id=f.id WHERE a.tool_name='fleet_run') run_snapshot_count,
 (SELECT count(*) FROM users u WHERE lower(coalesce(u.email,u.username))=ANY($1::text[])) account_count,
 (SELECT count(*) FROM fleet_person_capabilities c JOIN fleetgo f ON c.company_id=f.id JOIN users u ON u.id=c.user_id JOIN (VALUES
${COMPANYGO_FLEET_ACCOUNTS.map((row) => `('${row.login}',ARRAY[${row.capabilities.map((c) => `'${c}'`).join(",")}]::text[])`).join(",\n")}
 ) required(login,capabilities) ON lower(coalesce(u.email,u.username))=required.login WHERE c.capabilities @> required.capabilities) capability_account_count,
 (SELECT count(*) FROM gasgo) gasgo_count`;

export async function verifyCompanyGoFleetCoverage(client: DbClient): Promise<Record<string, number>> {
  const result = await client.query(COMPANYGO_FLEET_ACCEPTANCE_SQL, [COMPANYGO_FLEET_ACCOUNTS.map((row) => row.login)]);
  const counts = Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]));
  const required: Array<[string, number]> = [["history_days", 30], ["scheduled_days", 7], ["ticket_count", 37], ["billing_line_count", 30], ["run_snapshot_count", 30], ["account_count", COMPANYGO_FLEET_ACCOUNTS.length], ["capability_account_count", COMPANYGO_FLEET_ACCOUNTS.length], ["gasgo_count", 1]];
  for (const [key, minimum] of required) if ((counts[key] ?? 0) < minimum) throw new Error(`CompanyGo Fleet acceptance requires ${key} >= ${minimum}; found ${counts[key] ?? 0}.`);
  return counts;
}

export async function seedCompanyGoFleetWorkflows(client: DbClient): Promise<void> {
  const accounts = await client.query(`SELECT lower(coalesce(email,username)) login,password_hash FROM users WHERE lower(coalesce(email,username)) = ANY($1::text[])`, [COMPANYGO_FLEET_ACCOUNTS.map((row) => row.login)]);
  for (const expected of COMPANYGO_FLEET_ACCOUNTS) {
    const actual = accounts.rows.find((row) => row.login === expected.login);
    if (!actual) throw new Error(`Missing CompanyGo Fleet account: ${expected.login}`);
    if (!bcrypt.compareSync("companygo", actual.password_hash)) throw new Error(`CompanyGo password hash drifted for ${expected.login}; run the canonical account backfill instead of rotating it here.`);
  }
  const prerequisites = await client.query(`SELECT (SELECT count(*) FROM vendors WHERE lower(name)='fleetgo') vendor_count,(SELECT count(*) FROM partners WHERE lower(name)='gasgo') partner_count,(SELECT count(*) FROM assets a JOIN vendors v ON a.responsible_org_type='vendor' AND a.responsible_org_id=v.id WHERE lower(v.name)='fleetgo' AND a.retired_at IS NULL) asset_count`);
  const prerequisite = prerequisites.rows[0] ?? {};
  if (Number(prerequisite.vendor_count) !== 1 || Number(prerequisite.partner_count) !== 1 || Number(prerequisite.asset_count) < 3) throw new Error(`CompanyGo Fleet prerequisites are incomplete: ${JSON.stringify(prerequisite)}.`);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('companygo_fleet_mobile_fixtures'))");
  for (const statement of COMPANYGO_FLEET_SEED_SQL) await client.query(statement);
}

export function isCompanyGoFleetSeedMain(moduleUrl: string, argvPath: string | undefined, platform: NodeJS.Platform = process.platform): boolean {
  if (!argvPath) return false;
  const api = platform === "win32" ? path.win32 : path.posix;
  const modulePath = api.resolve(fileURLToPath(moduleUrl, { windows: platform === "win32" }));
  const invokedPath = api.resolve(argvPath);
  return platform === "win32" ? modulePath.toLowerCase() === invokedPath.toLowerCase() : modulePath === invokedPath;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) throw new Error("Pass --apply to add the idempotent CompanyGo Fleet workflow fixtures.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try { await client.query("BEGIN"); await seedCompanyGoFleetWorkflows(client); const counts = await verifyCompanyGoFleetCoverage(client); await client.query("COMMIT"); console.info("CompanyGo Fleet acceptance", counts); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}

if (isCompanyGoFleetSeedMain(import.meta.url, process.argv[1])) main().catch((error) => { console.error(error); process.exitCode = 1; });
