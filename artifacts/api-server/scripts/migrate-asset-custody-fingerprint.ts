import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`ALTER TABLE asset_custody_events ADD COLUMN IF NOT EXISTS command_fingerprint text`);
  console.log("Asset custody fingerprint additive migration complete");
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
