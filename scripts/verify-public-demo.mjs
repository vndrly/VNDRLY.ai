/** Read-only verification of public entry and denied writes. No credentials needed. */
import {readFile,writeFile} from 'node:fs/promises';
const base=process.env.DEMO_VERIFY_BASE||'https://vndrly.ai/api',report=JSON.parse(await readFile('.local/prairie-demo-report.json','utf8'));
const allowed=new Set(Object.values(report.ids.tickets)),results=[];
async function request(path,body,cookie){const res=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json().catch(()=>null),cookie:res.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};}
for(const persona of ['partner','field','fleet','gate']){
 const entry=await request('/auth/demo-entry',{persona});if(entry.status!==200||!entry.cookie)throw Error(`Entry ${persona}: ${entry.status}`);
 const signed=JSON.parse(Buffer.from(decodeURIComponent(entry.cookie.slice(entry.cookie.indexOf('=')+1)).split('.')[0],'base64').toString());if(signed.realm!=='demo'||!signed.publicDemo||signed.exp-signed.iat!==7200)throw Error('Public session boundary incorrect');
 const me=await request('/auth/me',null,entry.cookie),tickets=await request('/tickets',null,entry.cookie),rows=Array.isArray(tickets.data)?tickets.data:tickets.data?.tickets??tickets.data?.items??[];
 if(me.status!==200||tickets.status!==200||!rows.length||rows.some(t=>!allowed.has(t.id)))throw Error(`Public ${persona} data invalid`);
 if(persona!=='partner'&&rows.length!==30)throw Error('Vendor view scope incorrect');
 const denied=await request('/work-hub/tasks',{title:'Should never be created'},entry.cookie);if(denied.status!==403)throw Error('Public write was not blocked');
 const switchDenied=await request('/auth/switch-context',{membershipId:806},entry.cookie);if(switchDenied.status!==403)throw Error('Context upgrade not blocked');
 const extra={};
 if(persona==='fleet'){const assets=await request('/implementation-a/assets',null,entry.cookie);if(assets.status!==200)throw Error(`Fleet assets unavailable ${assets.status}`);extra.assets=assets.data.assets.length;}
 if(persona==='gate'){
  const sites=await request('/gate-change-over/sites?mode=history',null,entry.cookie);if(sites.status!==200||!sites.data?.sites?.length)throw Error('Gate sites missing');
  const siteId=sites.data.sites[0].id,stations=await request(`/gate-change-over/stations?siteId=${siteId}&mode=history`,null,entry.cookie);if(stations.status!==200)throw Error(`Gate stations unavailable ${stations.status}`);
  const history=await request('/gate-report/query',{reportKind:'history',filters:{siteId,range:'30d',recordType:'all'}},entry.cookie);if(history.status!==200||!history.data.rows.length)throw Error(`Gate history unavailable ${history.status}`);extra.gateHistory=history.data.rows.length;
 }
 const second=await request('/auth/demo-entry',{persona});await request('/auth/logout',{},entry.cookie);const still=await request('/auth/me',null,second.cookie);if(still.status!==200)throw Error('One visitor logout invalidated another visitor');
 results.push({persona,role:me.data.role,tickets:rows.length,readOnly:denied.status===403,otherVisitorSurvivedLogout:true,...extra});
}
const invalid=await request('/auth/demo-entry',{persona:'admin'});if(invalid.status!==400)throw Error('Unapproved public identity accepted');
await writeFile('.local/public-demo-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),results,invalidPersona:400},null,2));console.log(JSON.stringify(results));
