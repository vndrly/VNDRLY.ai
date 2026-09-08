import { readFileSync } from "node:fs";
import pg from "pg";

// Explicit opt-in prevents an import or ordinary application boot from
// modifying the shared database. The caller must supply the target URL.
if (process.env.APPLY_PARTNER_OWNED_CATALOGS !== "1" || !process.env.DATABASE_URL) {
  throw new Error("Set APPLY_PARTNER_OWNED_CATALOGS=1 and an explicit DATABASE_URL after target review");
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(90407003)");
  await client.query(readFileSync(new URL("./migrate-partner-owned-catalogs.sql", import.meta.url), "utf8"));
  const result = await client.query(`SELECT
    (SELECT count(*)::int FROM partners) AS partners,
    (SELECT count(*)::int FROM work_types WHERE partner_id IS NULL) AS source_items,
    (SELECT count(*)::int FROM work_types WHERE partner_id IS NOT NULL AND source_work_type_id IS NOT NULL) AS mapped_items,
    (SELECT count(*)::int FROM work_types owned JOIN partner_vendor_relationships rel ON rel.partner_id = owned.partner_id
      WHERE rel.status = 'approved' AND owned.source_work_type_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM partner_catalog_initializations init WHERE init.kind = 'selection'
        AND init.partner_id = owned.partner_id AND init.vendor_id = rel.vendor_id
        AND init.source_work_type_id = owned.source_work_type_id)) AS uninitialized_selections,
    (SELECT count(*)::int FROM partners p CROSS JOIN work_types source
      WHERE source.partner_id IS NULL AND NOT EXISTS
      (SELECT 1 FROM work_types owned WHERE owned.partner_id = p.id
        AND owned.source_work_type_id = source.id)) AS missing_copies`);
  if (result.rows[0].missing_copies !== 0) throw new Error("Partner catalog copy verification failed; transaction rolled back");
  if (result.rows[0].uninitialized_selections !== 0) throw new Error("Partner catalog initialization verification failed; transaction rolled back");
  await client.query("COMMIT");
  console.log(JSON.stringify(result.rows[0]));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
