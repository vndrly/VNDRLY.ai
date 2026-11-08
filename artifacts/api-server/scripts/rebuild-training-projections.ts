import {db,pool} from '@workspace/db';
import {sql} from 'drizzle-orm';
import {rebuildTrainingOwner} from '../src/work-hub/training-projection-worker';
const result=await db.execute(sql`SELECT id FROM vendors WHERE lower(name)='gatego'`);
if(result.rows.length!==1)throw Error('Expected one GateGo company');
const start=Date.now();
try{
 await rebuildTrainingOwner({type:'vendor',id:Number(result.rows[0].id)});
 const rows=await db.execute(sql`SELECT projection_key,computed_at FROM training_read_projections WHERE projection_key LIKE ${`vendor:${result.rows[0].id}:%`}`);
 console.log(JSON.stringify({phase:'saved_summaries_verified',count:rows.rows.length,ms:Date.now()-start}));
}catch(error){console.error({code:(error as {code?:string}).code,message:(error as Error).message});process.exitCode=1;}
finally{await pool.end();}
