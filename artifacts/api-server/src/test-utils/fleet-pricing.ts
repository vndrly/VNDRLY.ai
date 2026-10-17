import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
export async function createFleetPricingFixture() {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const tag = randomUUID();
  const vendor = (
    await pool.query(
      "INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",
      [tag, `${tag}@example.invalid`],
    )
  ).rows[0].id;
  const partner = (
    await pool.query(
      "INSERT INTO partners(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id",
      [tag, `${tag}@example.invalid`],
    )
  ).rows[0].id;
  const user = (
    await pool.query(
      "INSERT INTO users(username,password_hash,display_name,role) VALUES($1,'not-a-login','Synthetic approver','partner') RETURNING id",
      [tag],
    )
  ).rows[0].id;
  const site = (
    await pool.query(
      "INSERT INTO site_locations(partner_id,name,address,latitude,longitude,site_code,afe) VALUES($1,'Synthetic','Synthetic',35,-97,$2,'AFE1') RETURNING id",
      [partner, tag],
    )
  ).rows[0].id;
  const service = (
    await pool.query(
      "INSERT INTO work_types(name,category) VALUES($1,'Synthetic') RETURNING id",
      [tag],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO vendor_work_types(vendor_id,work_type_id,unit_price,precise_unit_price,unit,currency) VALUES($1,$2,'0.02','0.02','per_barrel','USD')",
    [vendor, service],
  );
  await pool.query(
    "INSERT INTO site_work_assignments(vendor_id,work_type_id,site_location_id,afe) VALUES($1,$2,$3,'AFE1')",
    [vendor, service, site],
  );
  await pool.query(
    "INSERT INTO partner_vendor_relationships(partner_id,vendor_id,status,approved_at,approved_by_user_id) VALUES($1,$2,'approved','2026-10-01T00:00:00Z',$3)",
    [partner, vendor, user],
  );
  await pool.query(
    "INSERT INTO partner_vendor_work_type_approvals(partner_id,vendor_id,work_type_id,approved_unit_price,precise_unit_price,approved_unit,approved_currency,approved_by_user_id,approved_at) VALUES($1,$2,$3,'0.01','0.0125','per_barrel','USD',$4,'2026-10-01T00:00:00Z')",
    [partner, vendor, service, user],
  );
  const manager = (
    await pool.query(
      "INSERT INTO users(username,password_hash,display_name,role) VALUES($1,'not-a-login','Synthetic fleet manager','vendor') RETURNING id,session_version",
      [`manager-${tag}`],
    )
  ).rows[0];
  const member = (
    await pool.query(
      "INSERT INTO user_org_memberships(user_id,org_type,vendor_id,role) VALUES($1,'vendor',$2,'admin') RETURNING id",
      [manager.id, vendor],
    )
  ).rows[0];
  return {
    vendor,
    partner,
    user,
    site,
    service,
    manager: {
      userId: manager.id,
      companyId: vendor,
      role: "vendor",
      membershipRole: "admin",
      sv: manager.session_version,
      activeMembershipId: member.id,
    },
  };
}
