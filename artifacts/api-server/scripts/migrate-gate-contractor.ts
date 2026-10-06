import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`ALTER TABLE site_work_assignments ADD COLUMN IF NOT EXISTS is_gate_contractor boolean NOT NULL DEFAULT false`);
  console.log("Explicit Gate contractor additive migration complete");
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
