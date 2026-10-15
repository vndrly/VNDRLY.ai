import './load-env-local.mjs';
import {demoDatabaseUrl} from './demo-database-config.mjs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {makeDemoEcosphere,DEMO_VERSION} from './demo-ecosphere-template.mjs';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const reportFile=new URL('../.local/prairie-demo-report.json',import.meta.url),r=JSON.parse(await readFile(reportFile,'utf8')), ids=r.ids,t=makeDemoEcosphere(r.anchor);
const marker=`Synthetic VNDRLY demo (${DEMO_VERSION}). No real work, person, credential, or payment is represented.`;
const uuid=key=>{const h=createHash('sha256').update(`${DEMO_VERSION}:${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const c=new Client({connectionString:await demoDatabaseUrl()});await c.connect();
try{
 await c.query('begin');await c.query('select pg_advisory_xact_lock(hashtext($1))',[DEMO_VERSION]);
 if((await c.query('select 1 from partners where id=$1 and blurb=$2',[ids.partner,marker])).rowCount!==1)throw Error('Demo ownership check failed');
 const gateFlag=await c.query("select 1 from information_schema.columns where table_schema='public' and table_name='site_work_assignments' and column_name='is_gate_contractor'");
 if(gateFlag.rowCount)for(const siteId of Object.values(ids.sites))await c.query('update site_work_assignments set is_gate_contractor=true where site_location_id=$1 and vendor_id=$2 and work_type_id=$3',[siteId,ids.vendors.gate,ids.workTypes.gate]);
 for(const p of t.people.filter(p=>p.vendorKey==='gate'))await c.query("update vendor_people set vendor_role='gatekeeper',roles=ARRAY['field_employee','gatekeeper'] where id=$1 and vendor_id=$2 and user_id=$3",[ids.people[p.key],ids.vendors.gate,ids.users[p.key]]);
 let awarded=0;
 for(const h of t.hotlist.filter(h=>h.status==='awarded')){
  const title=`${h.title} [${h.key}]`;
  const result=await c.query("update hotlist_jobs j set status='awarded',awarded_bid_id=b.id,awarded_vendor_id=b.vendor_id,converted_ticket_id=$1 from hotlist_bids b where j.partner_id=$2 and j.title=$3 and j.description=$4 and b.job_id=j.id and b.vendor_id=$5 and b.notes=$4 returning j.id",[ids.tickets[h.ticketKey],ids.partner,title,marker,ids.vendors[h.vendorKey]]);awarded+=result.rowCount;
 }
 for(const s of t.schedules.filter(s=>s.vendorKey==='gate'))for(const key of ['partner','gate'])await c.query('update work_hub_shifts set gate_station_id=$1,required_staff_count=1 where id=$2 and owner_org_id=$3 and instructions=$4',[ids.stations[s.siteKey],uuid(`${key}-${s.key}`),key==='partner'?ids.partner:ids.vendors.gate,marker]);
 let notes=0;
 const recentStart=new Date(Date.parse(`${r.anchor}T00:00:00Z`)-6*86400000).toISOString();
 for(const [orgType,orgId,staff] of [['partner',ids.partner,ids.users.office],...t.vendors.map(v=>['vendor',ids.vendors[v.key],ids.users[`${v.key}-office`]])])await c.query('update work_hub_tasks set created_by_id=$1 where owner_org_type=$2 and owner_org_id=$3 and description=$4 and created_at<$5',[staff,orgType,orgId,marker,recentStart]);
 for(const ticket of t.tickets.filter(x=>x.vendorKey==='field')) {
  await c.query('update work_hub_checklist_instances set assignee_user_id=$1 where id=$2 and channel_id=$3',[ids.primary,uuid(`checklist-partner-${ticket.key}`),ids.channels.partner]);
  await c.query('update work_hub_form_instances set assignee_user_id=$1 where id=$2 and channel_id=$3',[ids.primary,uuid(`form-partner-${ticket.key}`),ids.channels.partner]);
  await c.query('update work_hub_tasks set assignee_user_id=$1 where id=$2 and owner_org_type=\'partner\' and owner_org_id=$3',[ticket.createdAt>=recentStart?ids.primary:ids.users.office,uuid(`partner-task-${ticket.key}`),ids.partner]);
 }
 for(const [key,channel] of Object.entries(ids.channels))for(const [n,ticket] of t.tickets.filter(x=>key==='partner'?x.vendorKey==='field':x.vendorKey===key).entries()){
  const id=uuid(`note-${key}-${ticket.key}`),title='Shift handoff and site notes — Demo',body=`${marker}\n${ticket.description}\nCrew: ${t.people.find(p=>p.key===ticket.personKey).firstName}.\nStatus: ${ticket.status}.\nFollow-up: ${n%5===0?'Confirm inspection evidence with the next shift.':'Routine handoff; dispatch and gate coverage confirmed.'}`;
  const result=await c.query('insert into work_hub_notes (id,channel_id,title,body,created_by_id,updated_by_id,created_at,updated_at) values ($1,$2,$3,$4,$5,$5,$6,$6) on conflict (id) do nothing',[id,channel,title,body,ids.primary,ticket.createdAt]);notes+=result.rowCount;
 }
 await c.query('commit');const latest=JSON.parse(await readFile(reportFile,'utf8'));latest.finalization={awardedHotlistJobs:awarded,privateHotlistDrafts:t.hotlist.length-awarded,notesInserted:notes,gateEmployees:4};latest.hotlistStatus='historical awards and private drafts; no public fictional listings';await writeFile(reportFile,JSON.stringify(latest,null,2));console.log(JSON.stringify(latest.finalization));
}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{await c.end();}
