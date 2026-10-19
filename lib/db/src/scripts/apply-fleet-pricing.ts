import { pool } from "../index";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of [
      "ALTER TABLE vendor_work_types ADD COLUMN IF NOT EXISTS precise_unit_price numeric(24,9)",
      "ALTER TABLE vendor_work_types ADD COLUMN IF NOT EXISTS fleet_rate_card jsonb",
      "ALTER TABLE partner_vendor_work_type_approvals ADD COLUMN IF NOT EXISTS precise_unit_price numeric(24,9)",
      "ALTER TABLE partner_vendor_work_type_approvals ADD COLUMN IF NOT EXISTS fleet_rate_card jsonb",
      "ALTER TABLE site_work_assignments ADD COLUMN IF NOT EXISTS fleet_rate_card jsonb",
      "ALTER TABLE ticket_line_items ADD COLUMN IF NOT EXISTS precise_quantity numeric(24,9)",
      "ALTER TABLE ticket_line_items ADD COLUMN IF NOT EXISTS precise_unit_price numeric(24,9)",
      "ALTER TABLE ticket_line_items ADD COLUMN IF NOT EXISTS fleet_billing_metadata jsonb",
      "ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS precise_quantity numeric(24,9)",
      "ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS precise_unit_price numeric(24,9)",
      "ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS fleet_billing_metadata jsonb",
    ]) await client.query(statement);
    await client.query("COMMIT");
    console.log("Fleet precise pricing columns ready; historical amounts unchanged");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
void main();
