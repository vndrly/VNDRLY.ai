/** Provision only an empty demo DB and verify connectivity. Never copies or removes rows. */
import './load-env-local.mjs';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const name='vndrly_prairie_demo';
const source=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:12000});
const result={destination:name,sourceReachable:false,created:false,destinationReachable:false};
await source.connect();
try {
 result.sourceReachable=true;
 const identity=(await source.query('select current_database() name')).rows[0];
 if(identity.name===name)throw Error('Source already points at destination');
 const exists=(await source.query('select 1 from pg_database where datname=$1',[name])).rowCount>0;
 if(!exists&&process.argv.includes('--create')){
  await source.query(`CREATE DATABASE "${name}" TEMPLATE template0`);result.created=true;
 }
 result.exists=exists||result.created;
 if(result.exists){
  const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;
  const destination=new Client({connectionString:url.toString(),connectionTimeoutMillis:12000});
  try{
   await destination.connect();
   const actual=(await destination.query('select current_database() name')).rows[0].name;
   if(actual!==name)throw Error('Destination identity mismatch');
   result.destinationReachable=true;
   result.publicTables=(await destination.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n;
  }catch(error){result.destinationErrorCode=error.code??'CONNECTION_FAILED';result.destinationError=String(error.message).replaceAll(url.password,'[redacted]');}
  finally{await destination.end();}
 }
}catch(error){result.provisionErrorCode=error.code??'PROVISION_FAILED';result.provisionError=String(error.message);}
finally{await source.end();}
await writeFile(new URL('../.local/prairie-demo-database-preflight.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
