import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { guardAdditiveReplay } from "../../../scripts/guard-additive-replay.mjs";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('gate-staffing-alerts-migration'))",
    );
    const source = await readFile(
      new URL(
        "../../../lib/db/drizzle/gate_staffing_alerts.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await client.query(guardAdditiveReplay(source));
    await client.query("COMMIT");
    console.log(
      "Shared Gate staffing incident storage ready; existing watch custody and company holds unchanged.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
main()
  .catch(() => {
    console.error(
      "Gate staffing incident migration failed; transaction rolled back.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
