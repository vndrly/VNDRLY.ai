import { pool } from "../index";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of [
      "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS fleet_compliance_configuration jsonb",
      "ALTER TABLE assets ADD COLUMN IF NOT EXISTS fleet_compliance_record_ids jsonb",
      "ALTER TABLE vendor_people ADD COLUMN IF NOT EXISTS fleet_compliance_record_ids jsonb",
      "ALTER TABLE partner_vendor_relationships ADD COLUMN IF NOT EXISTS fleet_commercial_authority jsonb",
      "ALTER TABLE partner_vendor_relationships ADD COLUMN IF NOT EXISTS fleet_compliance_policies jsonb",
    ]) await client.query(statement);
    await client.query("COMMIT");
    console.log("Fleet compliance columns ready; warning policy and existing approvals unchanged");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
void main();
