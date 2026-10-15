/** Verify production reads with only the fictional identities; never prints credentials. */
import {readFile,writeFile} from 'node:fs/promises';
const creds=JSON.parse(await readFile(new URL('../.local/prairie-demo-accounts.json',import.meta.url),'utf8'));
const report=JSON.parse(await readFile(new URL('../.local/prairie-demo-report.json',import.meta.url),'utf8'));
const base=process.env.DEMO_VERIFY_BASE||'https://vndrly.ai/api';const results=[];
for(const key of ['review','field-office','fleet-office','gate-office','person-1','person-5','person-9']) {
 const account=creds.accounts.find(a=>a.key===key);let cookie='';
 async function request(path,body){const res=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const set=res.headers.getSetCookie();if(set.length)cookie=set.map(s=>s.split(';')[0]).join('; ');let data;try{data=await res.json();}catch{data=null;}return {status:res.status,data};}
 const login=await request('/auth/login',{username:account.username,password:creds.password});if(login.status!==200)throw Error(`Demo login failed: ${key} (${login.status})`);
 const me=await request('/auth/me');if(me.status!==200)throw Error(`Demo identity read failed: ${key}`);
 const tickets=await request('/tickets');const rows=Array.isArray(tickets.data)?tickets.data:tickets.data?.tickets??tickets.data?.items??[];
 if(tickets.status!==200||!rows.length)throw Error(`Demo tickets unavailable: ${key} (${tickets.status})`);
 const allowed=new Set(Object.values(report.ids.tickets));if(rows.some(t=>!allowed.has(t.id)))throw Error(`Non-demo ticket visible: ${key}`);
 const hub=await request('/work-hub/channels');
 const tasks=await request('/work-hub/tasks');if(tasks.status!==200)throw Error(`Demo tasks unavailable: ${key}`);
 const calendar=await request('/work-hub/calendar?start=2026-09-10T00:00:00Z&end=2026-10-19T00:00:00Z');if(calendar.status!==200)throw Error(`Demo calendar unavailable: ${key} (${calendar.status})`);
 const required=await request('/work-hub/required-actions');if(required.status!==200)throw Error(`Demo forms unavailable: ${key}`);
 const extra={tasks:Array.isArray(tasks.data)?tasks.data.length:null,calendar:calendar.status,checklists:required.data?.checklists?.length??0,forms:required.data?.forms?.length??0};
 if(key==='review'){const jobs=await request('/hotlist/jobs');if(jobs.status!==200||!Array.isArray(jobs.data)||jobs.data.length!==34)throw Error('Demo Hotlist incomplete');extra.hotlist=jobs.data.length;const visits=await request('/visits/gate/ops');const allowedVisits=new Set(Object.values(report.ids.visits));if(visits.status!==200||!visits.data.visits.length||visits.data.visits.some(v=>!allowedVisits.has(v.id)))throw Error(`Demo gate rolling history or isolation invalid (${visits.status})`);extra.visits=visits.data.visits.length;extra.visitWindow='Rolling 30 days; full baseline count verified separately in isolated database';}
 if(key==='gate-office'||key==='person-9'){const gates=await request('/gate-change-over/sites?mode=history');if(gates.status!==200||!gates.data?.sites?.length){const state=await request(`/gate-change-over/${Object.values(report.ids.stations)[0]}/state`);throw Error(`Demo gate access failed: ${key}, status=${state.status}, message=${state.data?.message??''}`);}extra.gateSites=gates.data.sites.length;}
 if(key==='fleet-office'){const trips=await request('/implementation-a/trips');if(trips.status!==200)throw Error(`Demo fleet trips unavailable (${trips.status})`);extra.fleetTripsStatus=trips.status;}
 if(key==='field-office'){const foreign=await request(`/tickets/${report.ids.tickets['day-01-fleet']}`);if(![403,404].includes(foreign.status))throw Error(`Foreign demo ticket boundary failed (${foreign.status})`);extra.foreignTicketDenied=foreign.status;}
 results.push({account:key,login:login.status,role:me.data.role,tickets:rows.length,workHubStatus:hub.status,workHubChannels:Array.isArray(hub.data)?hub.data.length:hub.data?.channels?.length??null,...extra});
}
await writeFile(new URL('../.local/prairie-demo-verification.json',import.meta.url),JSON.stringify({verifiedAt:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));
