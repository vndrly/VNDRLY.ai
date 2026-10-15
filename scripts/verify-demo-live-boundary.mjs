/** Authenticated live proof. Never prints tokens, passwords or customer details. */
import './load-env-local.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const accounts=JSON.parse(await readFile('.local/prairie-demo-accounts.json','utf8'));
const report=JSON.parse(await readFile('.local/prairie-demo-report.json','utf8'));
async function login(username,password){const res=await fetch('https://vndrly.ai/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});if(res.status!==200)throw Error(`Login verification failed (${res.status})`);return res.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');}
async function request(cookie,path,method='GET',body){const res=await fetch('https://vndrly.ai/api'+path,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};}
const demoCookie=await login(accounts.accounts.find(a=>a.key==='review').username,accounts.password);
const demoVendors=await request(demoCookie,'/vendors');if(demoVendors.status!==200||demoVendors.data.length!==3)throw Error('Demo vendor directory leaked');
const dashboard=await request(demoCookie,'/dashboard/summary');if(dashboard.status!==200||dashboard.data.totalVendors!==3)throw Error('Demo dashboard count leaked');
const denied=[];for(const [method,path] of [['GET','/tickets/events'],['GET','/accounting/qb/connect'],['GET','/work-hub/file-library'],['POST','/work-hub/calls']]){const result=await request(demoCookie,path,method,method==='POST'?{}:undefined);if(result.status!==403||result.data.code!=='demo.operation_disabled')throw Error('Unsafe demo operation allowed');denied.push({path,status:result.status});}
const envelope={operationId:randomUUID(),owner:{type:'partner',id:report.ids.partner},context:{kind:'organization',id:report.ids.partner},expectedVersion:null,payloadVersion:1,payload:{title:'Isolation verification — Demo',description:'Synthetic demonstration: this task exists only in the isolated demo database.'}};
const before=await request(demoCookie,'/work-hub/tasks');const existing=before.data.find(t=>t.title===envelope.payload.title&&t.description===envelope.payload.description);
const created=existing?{status:200,data:{resource:existing}}:await request(demoCookie,'/work-hub/tasks','POST',envelope);if(![200,201].includes(created.status))throw Error(`Synthetic action failed (${created.status}): ${created.data.code??''}`);
const taskId=created.data.resource.id;
const tasks=await request(demoCookie,'/work-hub/tasks');if(!tasks.data.some(t=>t.id===taskId))throw Error('Synthetic task readback failed');
const production=new Client({connectionString:process.env.DATABASE_URL});await production.connect();
try{if((await production.query('select 1 from work_hub_tasks where id=$1',[taskId])).rowCount)throw Error('Demo action reached production');}finally{await production.end();}
const canonical=await readFile('docs/canonical-credentials.md','utf8');
const row=canonical.split(/\r?\n/).map(line=>line.split('|').slice(1,-1).map(x=>x.trim().replaceAll('`',''))).find(c=>c[0]?.split('/').map(x=>x.trim()).includes('admin'));if(!row?.[1])throw Error('Canonical admin record unavailable');
const realCookie=await login(row[0].split('/')[0].trim(),row[1]);const realMe=await request(realCookie,'/auth/me');if(realMe.status!==200||accounts.accounts.some(a=>a.id===realMe.data.id))throw Error('Real account boundary failed');
const health=await fetch('https://vndrly.ai/api/healthz');if(health.status!==200)throw Error('Production health failed');
const evidence={verifiedAt:new Date().toISOString(),demoVendors:3,demoDashboardVendors:3,denied,syntheticAction:{verificationStatus:created.status,readBack:true,absentFromProduction:true,taskId},realLogin:200,realIdentityRead:200,health:200};
await writeFile('.local/prairie-demo-live-boundary-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
