/** Create a NEW demo-only service login; never rotate an existing credential. */
import './load-env-local.mjs';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const file=new URL('../.local/prairie-demo-database-access.json',import.meta.url);
let access;try{access=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const source=new Client({connectionString:process.env.DATABASE_URL});await source.connect();
const url=new URL(process.env.DATABASE_URL);url.pathname='/vndrly_prairie_demo';
const owner=new Client({connectionString:url.toString()});await owner.connect();
try{
 const role='vndrly_prairie_demo_service';
 const exists=(await source.query('select 1 from pg_roles where rolname=$1',[role])).rowCount>0;
 if(exists&&!access)throw Error('Existing service role has no private saved credential; refusing rotation');
 if(!access){access={role,password:randomBytes(32).toString('base64url')};await writeFile(file,JSON.stringify(access),{flag:'wx',mode:0o600});}
 if(access.role!==role||!/^[A-Za-z0-9_-]+$/.test(access.password))throw Error('Invalid service credential record');
 if(!exists)await source.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${access.password}'`);
 await source.query(`GRANT CONNECT ON DATABASE vndrly_prairie_demo TO "${role}"`);
 await owner.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
 await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
 await owner.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
 const username=decodeURIComponent(url.username);url.username=role+(username.includes('.')?username.slice(username.indexOf('.')):'');url.password=access.password;
 const demo=new Client({connectionString:url.toString(),connectionTimeoutMillis:10000});await demo.connect();
 try{const actual=(await demo.query('select current_database() name,current_user role,count(*)::int vendors from vendors')).rows[0];if(actual.name!=='vndrly_prairie_demo'||actual.role!==role||actual.vendors!==3)throw Error('Dedicated demo connection failed identity verification');}finally{await demo.end();}
 const realUrl=new URL(url);realUrl.pathname=new URL(process.env.DATABASE_URL).pathname;
 const forbidden=new Client({connectionString:realUrl.toString(),connectionTimeoutMillis:10000});let productionReadDenied=false;
 try{await forbidden.connect();await forbidden.query('select id from public.users limit 1');}catch(e){if(!['42501','28000'].includes(e.code))throw e;productionReadDenied=true;}finally{await forbidden.end();}
 if(!productionReadDenied)throw Error('Demo service can read production; cutover prohibited');
 access.url=url.toString();access.verifiedAt=new Date().toISOString();await writeFile(file,JSON.stringify(access,null,2),{mode:0o600});
 console.log(JSON.stringify({dedicatedDemoRole:true,demoVendors:3,productionReadDenied:true,existingCredentialsRotated:false}));
}finally{await Promise.all([source.end(),owner.end()]);}
