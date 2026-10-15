import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { loadVpsSshConfig } from './ssh-vps-config.mjs';
const { Client } = createRequire(import.meta.url)('ssh2');
const client = new Client();
await new Promise((ok,no)=>client.on('ready',ok).on('error',no).connect(loadVpsSshConfig()));
const source = `
import fs from 'node:fs'; import {createRequire} from 'node:module';
const {Client}=createRequire('/var/www/vndrly/lib/db/package.json')('pg');
const env=Object.fromEntries(fs.readFileSync('/var/www/vndrly/.env.production','utf8').split(/\\r?\\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).replace(/^['"]|['"]$/g,'')]}));
for(const key of ['DATABASE_URL','DEMO_DATABASE_URL']){if(!env[key])continue;const c=new Client({connectionString:env[key]});await c.connect();try{
const result=await c.query(\`SELECT v.id,v.name,v.blurb,coalesce(v.fleet_ops_state->>'enabled','false') AS fleet_enabled,
(SELECT jsonb_agg(jsonb_build_object('name',w.name,'category',w.category)) FROM vendor_work_types x JOIN work_types w ON w.id=x.work_type_id WHERE x.vendor_id=v.id) AS services,
(SELECT count(*)::int FROM vendor_people p WHERE p.vendor_id=v.id AND p.deleted_at IS NULL AND p.vendor_role IN ('gatekeeper','gate_supervisor')) AS gate_staff
FROM vendors v ORDER BY v.id\`);console.log(JSON.stringify({realm:key==='DATABASE_URL'?'production':'demo',companies:result.rows}));
}finally{await c.end();}}
`;
let output='';
try { await new Promise((ok,no)=>client.exec('node --input-type=module',(error,stream)=>{if(error)return no(error);stream.on('data',data=>output+=data);stream.stderr.on('data',data=>process.stderr.write(data));stream.on('close',code=>code?no(Error('Inspection failed')):ok());stream.end(source);})); await writeFile('C:/Users/JohnElerick/DEV/VNDRLY.ai/.local/company-operations-inventory.jsonl',output); console.log(output); } finally {client.end();}
