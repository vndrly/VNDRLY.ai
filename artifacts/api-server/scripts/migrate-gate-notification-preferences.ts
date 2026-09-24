import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS gate_handoffs_enabled boolean NOT NULL DEFAULT true`);
  await db.execute(sql`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS gate_alerts_enabled boolean NOT NULL DEFAULT true`);
  console.log("Gate notification preferences additive migration complete");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
