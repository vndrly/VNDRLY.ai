import {readFile} from "node:fs/promises";
import {pool} from "@workspace/db";

async function main() {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('coverage-resolutions-migration'))");
    for(const name of ["site_shift_pattern_names.sql","coverage_resolutions.sql"]){
      const source=await readFile(new URL(`../../../lib/db/drizzle/${name}`,import.meta.url),"utf8");
      await client.query(source);
    }
    await client.query("COMMIT");
    console.log("Coverage storage ready; existing shifts and assignments unchanged.");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
main().catch(()=>{console.error("Coverage storage migration failed; transaction rolled back.");process.exitCode=1;}).finally(()=>pool.end());
