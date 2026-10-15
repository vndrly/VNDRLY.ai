import './load-env-local.mjs';
import {createRequire} from 'node:module';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const c=new Client({connectionString:process.env.DATABASE_URL});
await c.connect();
try { console.log(JSON.stringify((await c.query("select state,wait_event_type,wait_event,now()-xact_start as elapsed from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and xact_start is not null")).rows)); }
finally {await c.end();}
