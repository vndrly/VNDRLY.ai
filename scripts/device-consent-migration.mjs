export const DEVICE_CONSENT_MIGRATION = 'ALTER TABLE "location_consents" ADD COLUMN IF NOT EXISTS "original_device_id" text';

export async function runDeviceConsentMigration(client) {
  await client.query(DEVICE_CONSENT_MIGRATION);
  const result = await client.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='location_consents' AND column_name='original_device_id'");
  if (result.rows.length !== 1 || result.rows[0].data_type !== "text" || result.rows[0].is_nullable !== "YES") throw new Error("Device consent migration verification failed");
}
