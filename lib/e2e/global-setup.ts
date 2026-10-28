import type { FullConfig } from "@playwright/test";
import {
  assertIsolatedTestDatabaseEnvironment,
  assertLocalE2EBaseUrl,
} from "../../scripts/e2e-isolation.mjs";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { ADMIN_PIN_SCHEMA } from "../../artifacts/api-server/src/lib/admin-pin";
import { readCompanyGoFleetFixtureFingerprint, seedCompanyGoFleetWorkflows, stableCompanyGoUuid, verifyCompanyGoFleetCoverage } from "../../artifacts/api-server/scripts/seed-companygo-fleet-workflows";
import { emptyFleetState } from "../../artifacts/api-server/src/services/fleet-repository";

async function seedIsolatedCompanyGoPrerequisites(client: import("pg").PoolClient): Promise<void> {
  const passwordHash = bcrypt.hashSync("companygo", 10);
  const partner = await client.query<{ id: number }>(
    `INSERT INTO partners(name,contact_name,contact_email)
     VALUES ('GasGo','GasGo Testing','partner_admin@gasgo.com') RETURNING id`,
  );
  const vendor = await client.query<{ id: number }>(
    `INSERT INTO vendors(name,contact_name,contact_email,operations_categories)
     VALUES ('FleetGo','FleetGo Testing','vendor_admin@fleetgo.com',ARRAY['fleet']::text[]) RETURNING id`,
  );
  const site = await client.query<{ id: number }>(
    `INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code,site_radius_meters,afe)
     VALUES ($1,'GasGo Stanton Yard','100 Fleet Test Road, Stanton, TX',32.1293,-101.7885,'GASGO-FLEET-E2E',500,'GASGO-E2E') RETURNING id`,
    [partner.rows[0]!.id],
  );
  const workType = await client.query<{ id: number }>(
    `INSERT INTO work_types(name,category,description)
     VALUES ('CompanyGo Fleet Hauling','fleet','Isolated Fleet workflow acceptance service') RETURNING id`,
  );
  await client.query(
    `INSERT INTO vendor_work_types(vendor_id,work_type_id,unit_price,precise_unit_price,unit,currency,notes)
     VALUES ($1,$2,1250,1250,'per_day','USD','Isolated CompanyGo acceptance rate')`,
    [vendor.rows[0]!.id, workType.rows[0]!.id],
  );

  const accountSpecs = [
    ["vendor_admin@fleetgo.com", "vendor", "FleetGo Admin", "admin", "admin", ["admin", "office"]],
    ["vendor_office@fleetgo.com", "vendor", "FleetGo Office", "member", "office", ["office"]],
    ["vendor_fleet_dispatch@fleetgo.com", "vendor", "FleetGo Dispatch", "member", "fleet_dispatch", ["fleet_dispatch"]],
    ["vendor_fleet_driver@fleetgo.com", "field_employee", "FleetGo Driver", "field_employee", "fleet_driver", ["fleet_driver", "yard"]],
  ] as const;
  const userIds: number[] = [];
  for (const [login, role, displayName, membershipRole, vendorRole, roles] of accountSpecs) {
    const user = await client.query<{ id: number }>(
      `INSERT INTO users(username,email,password_hash,role,display_name,email_verified_at)
       VALUES ($1,$1,$2,$3,$4,now()) RETURNING id`,
      [login, passwordHash, role, displayName],
    );
    const person = await client.query<{ id: number }>(
      `INSERT INTO vendor_people(vendor_id,vendor_role,roles,first_name,last_name,email,is_active,user_id)
       VALUES ($1,$2,$3,$4,'Testing',$5,true,$6) RETURNING id`,
      [vendor.rows[0]!.id, vendorRole, roles, displayName, login, user.rows[0]!.id],
    );
    const membership = await client.query<{ id: number }>(
      `INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role,vendor_people_id)
       VALUES ($1,'vendor',$2,$3,$4) RETURNING id`,
      [user.rows[0]!.id, vendor.rows[0]!.id, membershipRole, person.rows[0]!.id],
    );
    await client.query(`UPDATE users SET active_membership_id=$1 WHERE id=$2`, [membership.rows[0]!.id, user.rows[0]!.id]);
    userIds.push(user.rows[0]!.id);
  }
  await client.query(
    `INSERT INTO site_work_assignments(site_location_id,work_type_id,vendor_id,is_gate_contractor)
     VALUES ($1,$2,$3,false)`,
    [site.rows[0]!.id, workType.rows[0]!.id, vendor.rows[0]!.id],
  );
  await client.query(
    `INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status,approved_at,approved_by_user_id)
     VALUES ($1,$2,'approved','2026-10-01T00:00:00.000Z',$3)`,
    [partner.rows[0]!.id, vendor.rows[0]!.id, userIds[0]],
  );
  await client.query(
    `INSERT INTO partner_vendor_work_type_approvals(partner_id,vendor_id,work_type_id,approved_at,approved_by_user_id)
     VALUES ($1,$2,$3,'2026-10-01T00:00:00.000Z',$4)`,
    [partner.rows[0]!.id, vendor.rows[0]!.id, workType.rows[0]!.id, userIds[0]],
  );
  const assets = await client.query<{ id: string }>(
    `INSERT INTO assets(name,category,legal_owner_name,responsible_org_type,responsible_org_id,status,created_by_user_id)
     VALUES
       ('FleetGo Truck 01','truck','FleetGo','vendor',$1,'available',$2),
       ('FleetGo Trailer 01','trailer','FleetGo','vendor',$1,'available',$2),
       ('FleetGo Rigging 01','rigging','FleetGo','vendor',$1,'available',$2)
     RETURNING id`,
    [vendor.rows[0]!.id, userIds[0]],
  );
  for (const asset of assets.rows) {
    await client.query(
      `INSERT INTO asset_attachment_links(asset_id,attachment_type,attachment_id,linked_by_user_id)
       VALUES ($1,'fleet_inventory',$2,$3)`,
      [asset.id, String(vendor.rows[0]!.id), userIds[0]],
    );
  }
  const fleetId = "6fefab43-28cc-4e90-967c-347c28c48a13";
  await client.query(
    `UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1`,
    [vendor.rows[0]!.id, JSON.stringify({
      ...emptyFleetState(),
      enabled: true,
      fleets: [{ id: fleetId, name: "FleetGo Test Fleet", siteIds: [site.rows[0]!.id], equipmentAssetIds: assets.rows.map((row) => row.id), requiredCertifications: [] }],
      grants: userIds.map((userId, index) => ({ userId, fleetIds: [fleetId], siteIds: [site.rows[0]!.id], roles: index === 0 ? ["fleet_manager"] : index === 2 ? ["dispatcher"] : ["driver"], safetyRelease: false, financeRead: index < 2 })),
      runs: [{
        id: stableCompanyGoUuid("run:active"), fleetId, companyId: vendor.rows[0]!.id,
        title: "GasGo active Fleet acceptance run", driverUserId: userIds[3]!,
        vehicleAssetId: assets.rows[0]!.id, trailerAssetId: assets.rows[1]!.id,
        siteIds: [site.rows[0]!.id], status: "dispatched", phase: null, version: 1,
        stops: [{ id: stableCompanyGoUuid("run:active:stop"), siteId: site.rows[0]!.id, kind: "delivery", sequence: 0 }],
        loads: [], inspections: [], currentStopId: null, visitedStopIds: [], events: [],
        linkedTicketId: 1_870_000_100, allowedActions: [],
      }],
    })],
  );
}

// Isolated-only safety net: hit POST /api/auth/seed before any spec so the
// fixed values in docs/canonical-credentials.md are applied verbatim inside
// the wrapper-owned test database. The provenance assertion runs before the
// request and fixture routes independently enforce the marker, exact normalized
// DATABASE_URL/TEST_DATABASE_URL target, and `_test` database-name invariant.
// The origin assertion prevents this seed call from reaching any external API.
// A seed failure aborts the suite rather than allowing misleading login errors.
//
export default async function globalSetup(_config: FullConfig): Promise<void> {
  assertIsolatedTestDatabaseEnvironment(process.env);
  const baseURL = assertLocalE2EBaseUrl(process.env.E2E_BASE_URL);
  const seedURL = `${baseURL}/api/auth/seed`;
  const res = await fetch(seedURL, { method: "POST" });
  if (!res.ok) {
    throw new Error(
      `[e2e global-setup] POST /api/auth/seed -> ${res.status} ${res.statusText}; refusing to run with unverified canonical demo credentials`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    "[e2e global-setup] isolated seed ok — canonical demo credentials applied",
  );
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(ADMIN_PIN_SCHEMA);
    await seedIsolatedCompanyGoPrerequisites(client);
    await seedCompanyGoFleetWorkflows(client);
    const beforeReplay = await readCompanyGoFleetFixtureFingerprint(client);
    await seedCompanyGoFleetWorkflows(client);
    const afterReplay = await readCompanyGoFleetFixtureFingerprint(client);
    if (afterReplay !== beforeReplay) throw new Error("CompanyGo Fleet fixture replay changed authoritative state or row counts.");
    await verifyCompanyGoFleetCoverage(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
