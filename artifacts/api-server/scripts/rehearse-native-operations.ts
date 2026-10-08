import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import pg from "pg";
import {freshLocalChildEnvironment,provisionFreshLocalTestDatabase,resolveFreshLocalTestDatabaseTarget} from "../../../scripts/fresh-test-database.mjs";
/** Narrow DDL first/replay proof; full schema/authority behavior runs in the isolated API gate. */
async function main(){
 assert.equal(process.env.VNDRLY_LOAD_ENV_LOCAL,"0");
 const target=resolveFreshLocalTestDatabaseTarget(process.env);
 const env=freshLocalChildEnvironment(process.env,target);
 await provisionFreshLocalTestDatabase(target,url=>new pg.Client({connectionString:url}),async()=>({hasDataLoss:false,warnings:[],statementsToExecute:[
  "CREATE TABLE vendors(id integer PRIMARY KEY, preservation_marker text NOT NULL)",
  "CREATE TABLE partners(id integer PRIMARY KEY, preservation_marker text NOT NULL)",
  "CREATE TABLE work_hub_device_preferences(id integer PRIMARY KEY, preservation_marker text NOT NULL)",
  "CREATE TABLE work_hub_user_events(id integer PRIMARY KEY, preservation_marker text NOT NULL)",
  "CREATE TABLE site_visits(id integer PRIMARY KEY, preservation_marker text NOT NULL)",
  "CREATE TABLE field_push_tokens(id integer PRIMARY KEY, preservation_marker text NOT NULL)",
 ]}));
 const client=new pg.Client({connectionString:target.testUrl});await client.connect();
 try{
  const tables=["vendors","partners","work_hub_device_preferences","work_hub_user_events","site_visits","field_push_tokens"];
  for(const table of tables)await client.query(`INSERT INTO ${table}(id,preservation_marker) VALUES(1,'synthetic-preservation-marker')`);
  const path=fileURLToPath(new URL("./migrate-native-operations.ts",import.meta.url));
  const migrate=()=>new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,["--import","tsx",path],{env,cwd:fileURLToPath(new URL("../",import.meta.url)),stdio:"inherit"});child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(Error("Native migration failed")));});
  await migrate();
  await client.query("UPDATE vendors SET native_operations_policy=$1::jsonb WHERE id=1",[JSON.stringify({enabled:false,grants:[]})]);
  await client.query("UPDATE work_hub_device_preferences SET native_operations=$1::jsonb WHERE id=1",[JSON.stringify({consent:{locationSharing:false}})]);
  await client.query("UPDATE site_visits SET gate_identity_document=$1::jsonb WHERE id=1",[JSON.stringify({fields:{firstName:"Synthetic"}})]);
  const before=await Promise.all(tables.map(async table=>(await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`)).rows));
  await migrate();
  const after=await Promise.all(tables.map(async table=>(await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`)).rows));
  assert.deepEqual(after,before,"Replay preserves all existing policy, consent, identity and unrelated fields");
  console.log("PASS: native additive first application and replay preserve existing rows and permissions");
 }finally{await client.end();}
}
main().catch(error=>{console.error("Native guarded migration rehearsal failed",error instanceof Error?error.name:"unknown");process.exitCode=1;});
