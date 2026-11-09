import { pool } from "@workspace/db";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { isDemoUserId } from "../lib/demo-boundary";

/** Keep production-context fixtures outside the reserved demo identities. */
export async function productionFixtureUserId(): Promise<number> {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  for (;;) {
    const { rows } = await pool.query<{ id: number }>("SELECT nextval(pg_get_serial_sequence('users','id'))::int AS id");
    if (!isDemoUserId(rows[0].id)) return rows[0].id;
  }
}
