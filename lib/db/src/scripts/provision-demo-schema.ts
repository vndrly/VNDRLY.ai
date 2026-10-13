/** Empty destination only. Generate and validate additive DDL before execution. */
import '../../../../scripts/load-env-local.mjs';
import {assertAdditiveSchemaPlan} from '../../../../scripts/fresh-test-database.mjs';
import {drizzle} from 'drizzle-orm/node-postgres';
import {pushSchema} from 'drizzle-kit/api';
import pg from 'pg';
import * as schema from '../schema';
const url=new URL(process.env.DATABASE_URL!);
url.pathname='/vndrly_prairie_demo';
const pool=new pg.Pool({connectionString:url.toString()});
try{
 const identity=(await pool.query('select current_database() name')).rows[0].name;
 if(identity!=='vndrly_prairie_demo')throw Error('Destination identity mismatch');
 const tables=Number((await pool.query("select count(*) n from information_schema.tables where table_schema='public'")).rows[0].n);
 if(tables)throw Error('Destination is not empty; refusing schema application');
 const plan=await pushSchema(schema,drizzle(pool));
 assertAdditiveSchemaPlan(plan);
 console.log(JSON.stringify({database:identity,empty:true,additiveStatements:plan.statementsToExecute.length,apply:process.argv.includes('--apply')}));
 if(process.argv.includes('--apply'))for(const statement of plan.statementsToExecute)await pool.query(statement);
}finally{await pool.end();}
