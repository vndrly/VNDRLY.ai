/** Read-only real connection/Drizzle/transaction concurrency verification. */
import '../../../../scripts/load-env-local.mjs';
import {writeFile,readFile} from 'node:fs/promises';
import {sql} from 'drizzle-orm';
const access=JSON.parse(await readFile(new URL('../../../../.local/prairie-demo-database-access.json',import.meta.url),'utf8'));
process.env.DEMO_DATABASE_URL=access.url;
const {db,pool,initializeDemoDatabase,runInDatabaseRealm}=await import('../index');
await initializeDemoDatabase();
const result=await Promise.all((['demo','production','demo','production'] as const).map(realm=>runInDatabaseRealm(realm,async()=>{
 const lease=await pool.connect();
 try{
  const direct=(await pool.query('select current_database() name,count(*)::int vendors from vendors')).rows[0];
  const leased=(await lease.query('select current_database() name')).rows[0].name;
  const drizzleRows=(await db.execute(sql`select current_database() name,count(*)::int vendors from vendors`)).rows[0];
  const transaction=await db.transaction(async tx=>(await tx.execute(sql`select current_database() name`)).rows[0].name);
  if(direct.name!==leased||direct.name!==drizzleRows.name||direct.name!==transaction)throw Error('Connection realm mismatch');
  if(realm==='demo'&&(direct.name!=='vndrly_prairie_demo'||direct.vendors!==3))throw Error('Demo boundary failed');
  if(realm==='production'&&direct.name==='vndrly_prairie_demo')throw Error('Production crossed realm');
  return {realm,direct:true,lease:true,drizzle:true,transaction:true,vendors:direct.vendors};
 }finally{lease.release();}
})));
await writeFile(new URL('../../../../.local/prairie-demo-routing-verification.json',import.meta.url),JSON.stringify({verifiedAt:new Date().toISOString(),result},null,2));
console.log(JSON.stringify(result));
// Pools are process resources; this finite verification has no workers.
await pool.end();
await runInDatabaseRealm('demo',()=>pool.end());
