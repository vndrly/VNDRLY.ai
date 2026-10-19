import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

const PASSWORD = "companygo";

type AccountSpec = {
  source: string;
  target: string;
  vendorRole?: string;
  roles?: string[];
};
type DbClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> };

const ACCOUNTS: AccountSpec[] = [
  { source: "go-demo-dana-whitfield@example.invalid", target: "partner_admin@gasgo.com" },
  { source: "go-demo-priya-raman@example.invalid", target: "partner_office@gasgo.com" },
  { source: "go-demo-tom-brandt@example.invalid", target: "partner_foreman@gasgo.com" },
  { source: "go-demo-ray-castillo@example.invalid", target: "vendor_admin@fieldgo.com", vendorRole: "office", roles: ["office"] },
  { source: "go-demo-kim-albright@example.invalid", target: "vendor_office@fieldgo.com", vendorRole: "office", roles: ["office", "accounts_payable"] },
  { source: "go-demo-hector-ruiz@example.invalid", target: "vendor_foreman@fieldgo.com", vendorRole: "foreman", roles: ["foreman", "field_employee"] },
  { source: "go-demo-cody-harmon@example.invalid", target: "vendor_field@fieldgo.com", vendorRole: "field", roles: ["field_employee"] },
  { source: "go-demo-curtis-lyle@example.invalid", target: "vendor_admin@fleetgo.com", vendorRole: "office", roles: ["office"] },
  { source: "go-demo-tanya-brooks@example.invalid", target: "vendor_office@fleetgo.com", vendorRole: "office", roles: ["office"] },
  { source: "go-demo-monica-reyes@example.invalid", target: "vendor_fleet_dispatch@fleetgo.com", vendorRole: "office", roles: ["office", "Dispatcher"] },
  { source: "go-demo-ray-alvarado@example.invalid", target: "vendor_fleet_driver@fleetgo.com", vendorRole: "field", roles: ["field_employee", "Driver"] },
  { source: "go-demo-sharon-pike@example.invalid", target: "vendor_admin@gatego.com", vendorRole: "office", roles: ["office"] },
  { source: "go-demo-amber-cole@example.invalid", target: "vendor_office@gatego.com", vendorRole: "office", roles: ["office"] },
  { source: "go-demo-luis-ortega@example.invalid", target: "vendor_gate_supervisor@gatego.com", vendorRole: "gate_supervisor", roles: ["gate_supervisor", "gatekeeper"] },
  { source: "go-demo-maria-sanchez@example.invalid", target: "vendor_gatekeeper@gatego.com", vendorRole: "gatekeeper", roles: ["gatekeeper"] },
];

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function backfillAccounts(client: DbClient) {
  const result: Array<{ username: string; userId: number }> = [];
  for (const spec of ACCOUNTS) {
    const found = await client.query(
      `SELECT id,username,email,password_hash FROM users WHERE lower(username)=lower($1) OR lower(username)=lower($2) ORDER BY CASE WHEN lower(username)=lower($1) THEN 0 ELSE 1 END LIMIT 1`,
      [spec.target, spec.source],
    );
    if (!found.rows[0]) throw new Error(`Missing synthetic source account ${spec.source}`);
    const userId = Number(found.rows[0].id);
    const conflict = await client.query(`SELECT id FROM users WHERE lower(username)=lower($1) AND id<>$2`, [spec.target, userId]);
    if (conflict.rowCount) throw new Error(`Target username already belongs to another user: ${spec.target}`);
    const credentialsChanged = found.rows[0].username.toLowerCase() !== spec.target ||
      found.rows[0].email?.toLowerCase() !== spec.target || !bcrypt.compareSync(PASSWORD, found.rows[0].password_hash);
    const passwordHash = credentialsChanged ? bcrypt.hashSync(PASSWORD, 12) : found.rows[0].password_hash;
    await client.query(`
      UPDATE users SET username=$1,email=$1,password_hash=$2,must_change_password=false,
        email_verified_at=coalesce(email_verified_at,now()),session_version=session_version+$4
      WHERE id=$3
    `, [spec.target, passwordHash, userId, credentialsChanged ? 1 : 0]);
    if (spec.vendorRole) {
      await client.query(`
        UPDATE vendor_people SET email=$1,vendor_role=$2,roles=$3::text[]
        WHERE user_id=$4
      `, [spec.target, spec.vendorRole, spec.roles ?? [], userId]);
    }
    result.push({ username: spec.target, userId });
  }
  return result;
}

async function backfillTrips(client: DbClient) {
  const visits = await client.query(`
    WITH ranked AS (
      SELECT sv.*, row_number() OVER (PARTITION BY sv.check_in_time::date ORDER BY sv.check_in_time) rank
      FROM site_visits sv
      WHERE lower(sv.company)='fleetgo'
        AND sv.check_out_time IS NOT NULL
        AND sv.check_in_time::date BETWEEN current_date-29 AND current_date
        AND sv.site_location_id IN (SELECT id FROM site_locations WHERE partner_id=614)
    )
    SELECT r.id,r.site_location_id,r.first_name,r.last_name,r.vehicle_plate,r.check_in_time,r.check_out_time,
           s.latitude,s.longitude,u.id driver_user_id,a.id asset_id
    FROM ranked r
    JOIN site_locations s ON s.id=r.site_location_id
    JOIN users u ON lower(u.display_name)=lower(r.first_name||' '||r.last_name)
    JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=1114
    LEFT JOIN asset_aliases aa ON aa.kind='plate' AND aa.active=true AND replace(lower(aa.display_value),'-','')=replace(lower(r.vehicle_plate),'-','')
    LEFT JOIN assets a ON a.id=aa.asset_id AND a.responsible_org_type='vendor' AND a.responsible_org_id=1114
    WHERE r.rank=1 ORDER BY r.check_in_time
  `);
  let trips = 0;
  for (const visit of visits.rows) {
    const tripId = stableUuid(`companygo:trip:${visit.id}`);
    const operationId = stableUuid(`companygo:trip-operation:${visit.id}`);
    const startedAt = new Date(new Date(visit.check_in_time).getTime() - 55*60_000);
    const completedAt = new Date(visit.check_out_time);
    const lat = Number(visit.latitude), lng = Number(visit.longitude);
    await client.query(`
      INSERT INTO field_trips(id,operation_id,owner_org_type,owner_org_id,driver_user_id,vehicle_asset_id,
        assignment_id,site_location_id,destination_source,tracking_state,presence_state,last_latitude,last_longitude,
        last_accuracy_meters,last_speed_mps,last_recorded_at,last_point_reliable,final_visit_id,started_at,completed_at,
        completion_operation_id,completion_reason,completed_by_user_id,needs_supervisor_confirmation,created_at,updated_at)
      VALUES($1,$2,'vendor',1114,$3,$4,$5,$6,'assignment','completed','off_site',$7,$8,8,0,$9,true,$10,$11,$9,$12,
        'delivery_completed',$3,false,$11,$9)
      ON CONFLICT(operation_id) DO UPDATE SET final_visit_id=excluded.final_visit_id,vehicle_asset_id=excluded.vehicle_asset_id,
        completed_at=excluded.completed_at,last_recorded_at=excluded.last_recorded_at,updated_at=now()
    `, [tripId,operationId,visit.driver_user_id,visit.asset_id,`companygo:visit:${visit.id}`,visit.site_location_id,lat,lng,completedAt,visit.id,startedAt,stableUuid(`companygo:complete:${visit.id}`)]);
    const points = [
      { lat: lat+0.18, lng: lng-0.16, minutes: 50, distance: 25500, speed: 24 },
      { lat: lat+0.035, lng: lng-0.028, minutes: 12, distance: 5100, speed: 15 },
      { lat, lng, minutes: 0, distance: 25, speed: 2 },
    ];
    for (let index=0; index<points.length; index++) {
      const point=points[index]!;
      await client.query(`
        INSERT INTO field_trip_location_points(id,trip_id,latitude,longitude,accuracy_meters,speed_mps,distance_to_site_meters,reliable,recorded_at,created_at)
        VALUES($1,$2,$3,$4,8,$5,$6,true,$7,$7) ON CONFLICT(id) DO NOTHING
      `, [stableUuid(`companygo:point:${visit.id}:${index}`),tripId,point.lat,point.lng,point.speed,point.distance,new Date(new Date(visit.check_in_time).getTime()-point.minutes*60_000)]);
    }
    for (const direction of ["entry","exit"] as const) {
      const at = direction === "entry" ? new Date(visit.check_in_time) : completedAt;
      await client.query(`
        INSERT INTO field_trip_crossings(id,trip_id,site_location_id,direction,crossed_at,confirmed_at,dedupe_key,visit_id,created_at)
        VALUES($1,$2,$3,$4,$5,$5,$6,$7,$5) ON CONFLICT(dedupe_key) DO NOTHING
      `, [stableUuid(`companygo:crossing:${visit.id}:${direction}`),tripId,visit.site_location_id,direction,at,`companygo:${visit.id}:${direction}`,visit.id]);
    }
    trips++;
  }

  const activeDriver = await client.query(`SELECT id FROM users WHERE lower(username)='vendor_fleet_driver@fleetgo.com'`);
  const activeSite = await client.query(`SELECT id,latitude,longitude FROM site_locations WHERE partner_id=614 AND is_active=true ORDER BY id LIMIT 1`);
  const activeAsset = await client.query(`SELECT id FROM assets WHERE responsible_org_type='vendor' AND responsible_org_id=1114 AND category='truck' AND status='available' ORDER BY name LIMIT 1`);
  if (activeDriver.rows[0] && activeSite.rows[0]) {
    const tripId=stableUuid("companygo:trip:active"), operationId=stableUuid("companygo:trip-operation:active");
    const site=activeSite.rows[0], now=new Date();
    await client.query(`
      INSERT INTO field_trips(id,operation_id,owner_org_type,owner_org_id,driver_user_id,vehicle_asset_id,assignment_id,
        site_location_id,destination_source,tracking_state,presence_state,last_latitude,last_longitude,last_accuracy_meters,
        last_speed_mps,last_recorded_at,last_point_reliable,started_at,created_at,updated_at)
      VALUES($1,$2,'vendor',1114,$3,$4,'companygo:active',$5,'assignment','active','en_route',$6,$7,9,19,$8,true,$9,$9,$8)
      ON CONFLICT(operation_id) DO UPDATE SET driver_user_id=excluded.driver_user_id,vehicle_asset_id=excluded.vehicle_asset_id,
        site_location_id=excluded.site_location_id,tracking_state='active',presence_state='en_route',last_latitude=excluded.last_latitude,
        last_longitude=excluded.last_longitude,last_recorded_at=excluded.last_recorded_at,last_point_reliable=true,completed_at=null,updated_at=now()
    `,[tripId,operationId,activeDriver.rows[0].id,activeAsset.rows[0]?.id ?? null,site.id,Number(site.latitude)+0.06,Number(site.longitude)-0.05,now,new Date(now.getTime()-35*60_000)]);
    await client.query(`
      INSERT INTO field_trip_location_points(id,trip_id,latitude,longitude,accuracy_meters,speed_mps,distance_to_site_meters,reliable,recorded_at,created_at)
      VALUES($1,$2,$3,$4,9,19,8500,true,$5,$5) ON CONFLICT(id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,recorded_at=excluded.recorded_at
    `,[stableUuid("companygo:point:active"),tripId,Number(site.latitude)+0.06,Number(site.longitude)-0.05,now]);
    trips++;
  }
  return trips;
}

async function main() {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const accounts=await backfillAccounts(client as DbClient);
    const trips=await backfillTrips(client as DbClient);
    await client.query("COMMIT");
    console.log(JSON.stringify({accounts:accounts.length,tripsProcessed:trips,password:PASSWORD},null,2));
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
