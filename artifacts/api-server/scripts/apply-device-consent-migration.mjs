import pg from "pg";
import { runDeviceConsentMigration } from "../../../scripts/device-consent-migration.mjs";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the device consent migration");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await runDeviceConsentMigration(client);
  console.log("Device consent migration verified: nullable original_device_id; existing rows retained.");
} finally { await client.end().catch(() => undefined); }
