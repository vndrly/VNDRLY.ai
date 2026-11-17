import { pool } from "@workspace/db";
import { ensureAskVScopeIndexes } from "../../../scripts/askv-scope-indexes.mjs";

const client = await pool.connect();
try {
  console.log(await ensureAskVScopeIndexes(client));
} finally {
  client.release();
  await pool.end();
}
