/** Enrich only the explicitly marked fictional ecosystem; additive and rerunnable. */
import './load-env-local.mjs';
import {demoDatabaseUrl} from './demo-database-config.mjs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {makeDemoEcosphere,DEMO_VERSION} from './demo-ecosphere-template.mjs';
const {Client}=createRequire(new URL('../lib/db/package.json',import.meta.url))('pg');
const reportFile=new URL('../.local/prairie-demo-report.json',import.meta.url);
const report=JSON.parse(await readFile(reportFile,'utf8')), ids=report.ids;
const template=makeDemoEcosphere(report.anchor);
const marker=`Synthetic VNDRLY demo (${DEMO_VERSION}). No real work, person, credential, or payment is represented.`;
const uuid=key=>{const h=createHash('sha256').update(`${DEMO_VERSION}:${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const allowed=new Set(['ticket_crew','work_hub_checklist_templates','work_hub_checklist_instances','work_hub_form_templates','work_hub_form_instances','work_hub_form_submissions','work_hub_meetings','work_hub_meeting_occurrences','work_hub_meeting_participants','work_hub_announcements','work_hub_announcement_recipients','work_hub_crews','work_hub_crew_members']);
const c=new Client({connectionString:await demoDatabaseUrl()});let inserted=0,reused=0;
const ident=s=>{if(!/^[a-z_]+$/.test(s))throw Error('Invalid identifier');return `"${s}"`;};
async function add(table,data,key={id:data.id}) {
 if(!allowed.has(table))throw Error('Unexpected table');
 const pairs=Object.entries(key), exists=await c.query(`select 1 from ${ident(table)} where ${pairs.map(([k],i)=>`${ident(k)}=$${i+1}`).join(' and ')}`,pairs.map(([,v])=>v));
 if(exists.rowCount){reused++;return;}
 const entries=Object.entries(data);await c.query(`insert into ${ident(table)} (${entries.map(([k])=>ident(k)).join(',')}) values (${entries.map((_,i)=>`$${i+1}`).join(',')})`,entries.map(([,v])=>v));inserted++;
}
await c.connect();
try {
 await c.query('begin');await c.query('select pg_advisory_xact_lock(hashtext($1))',[DEMO_VERSION]);
 const owner=await c.query('select blurb from partners where id=$1',[ids.partner]);if(owner.rows[0]?.blurb!==marker)throw Error('Demo owner verification failed');
 for(const vendor of template.vendors){
  const changed=await c.query('update vendors set latitude=$1,longitude=$2,operating_radius_miles=250 where id=$3 and blurb=$4',[35.53,-97.92,ids.vendors[vendor.key],marker]);if(changed.rowCount!==1)throw Error('Demo vendor ownership failed');
  const crewId=uuid(`crew-${vendor.key}`);await add('work_hub_crews',{id:crewId,name:`${vendor.service} Crew — Demo`,owner_org_type:'vendor',owner_org_id:ids.vendors[vendor.key],created_by_id:ids.primary,created_at:template.tickets[0].createdAt});
  for(const person of template.people.filter(p=>p.vendorKey===vendor.key))await add('work_hub_crew_members',{id:uuid(`crew-member-${person.key}`),crew_id:crewId,user_id:ids.users[person.key]});
 }
 for(const t of template.tickets){
  await add('ticket_crew',{ticket_id:ids.tickets[t.key],employee_id:ids.people[t.personKey],added_by_user_id:ids.primary,added_at:t.createdAt,ack_status:'accepted',ack_at:t.createdAt},{ticket_id:ids.tickets[t.key],employee_id:ids.people[t.personKey]});
  // Align synthetic billable hours and historical attendance; no real records match.
  if(t.checkOutAt){const end=new Date(Date.parse(t.checkInAt)+t.hours*3600000).toISOString();await c.query('update tickets set check_out_time=$1 where id=$2 and vendor_id=$3 and notes like $4',[end,ids.tickets[t.key],ids.vendors[t.vendorKey],`${marker}%`]);await c.query('update ticket_check_ins set check_out_at=$1 where ticket_id=$2 and employee_id=$3',[end,ids.tickets[t.key],ids.people[t.personKey]]);}
 }
 const checklist=[{id:'ppe',label:'PPE and job safety plan reviewed',type:'checkbox',required:true},{id:'equipment',label:'Equipment inspected before shift',type:'checkbox',required:true},{id:'handoff',label:'Dispatch and gate handoff confirmed',type:'checkbox',required:true}];
 const form=[{id:'summary',label:'Shift summary',type:'text',required:true},{id:'hours',label:'Hours worked',type:'number',required:true},{id:'followup',label:'Next shift follow-up',type:'text',required:false}];
 for(const [key,type,org] of [['partner','partner',ids.partner],...template.vendors.map(v=>[v.key,'vendor',ids.vendors[v.key]])]) {
  const ownership={owner_org_type:type,owner_org_id:org}, channel=ids.channels[key];
  await add('work_hub_checklist_templates',{id:uuid(`checklist-${key}`),...ownership,name:'Pre-shift safety check — Demo',definition:JSON.stringify(checklist),created_by_id:ids.primary,created_at:template.tickets[0].createdAt});
  await add('work_hub_form_templates',{id:uuid(`form-${key}`),...ownership,name:'Daily shift handoff — Demo',definition:JSON.stringify(form),created_by_id:ids.primary,created_at:template.tickets[0].createdAt});
  await add('work_hub_meetings',{id:uuid(`meeting-${key}`),...ownership,channel_id:channel,title:'Operations and safety briefing — Demo',agenda:'Synthetic briefing: assignments, deliveries, gate coverage, and outstanding ticket reviews.',timezone:'America/Chicago',created_by_id:ids.primary,created_at:template.tickets[0].createdAt});
  const selected=template.tickets.filter(t=>key==='partner'?t.vendorKey==='field':t.vendorKey===key);
  for(let n=0;n<selected.length;n++) {
   const t=selected[n], uid=key==='partner'?ids.users.office:ids.users[t.personKey], historic=n<29;
   await add('work_hub_checklist_instances',{id:uuid(`checklist-${key}-${t.key}`),template_id:uuid(`checklist-${key}`),template_version:1,channel_id:channel,assignee_user_id:uid,snapshot:JSON.stringify(checklist),responses:JSON.stringify(historic?{ppe:true,equipment:true,handoff:true}:{}),status:historic?'completed':'open',due_at:t.scheduledAt,created_at:t.createdAt});
   const formId=uuid(`form-${key}-${t.key}`);
   await add('work_hub_form_instances',{id:formId,template_id:uuid(`form-${key}`),template_version:1,channel_id:channel,assignee_user_id:uid,definition_snapshot:JSON.stringify(form),due_at:t.checkOutAt??t.scheduledAt,created_at:t.createdAt});
   if(historic)await add('work_hub_form_submissions',{id:uuid(`submission-${key}-${t.key}`),instance_id:formId,version:1,submitted_by_id:uid,values:JSON.stringify({summary:'Synthetic shift completed; visitor and dispatch records reconciled.',hours:t.hours,followup:n%5===0?'Review equipment inspection at next briefing.':'Routine next shift coverage.'}),submitted_at:t.checkOutAt});
   if(n%7===0||!historic){const occ=uuid(`occurrence-${key}-${t.key}`);await add('work_hub_meeting_occurrences',{id:occ,meeting_id:uuid(`meeting-${key}`),starts_at:t.scheduledAt,ends_at:new Date(Date.parse(t.scheduledAt)+1800000).toISOString(),status:historic?'ended':'scheduled',created_at:t.createdAt});for(const participant of [ids.primary,uid])await add('work_hub_meeting_participants',{id:uuid(`participant-${occ}-${participant}`),occurrence_id:occ,user_id:participant,role:participant===ids.primary?'host':'participant',rsvp:'accepted'});}
   if(n%7===0){const announcement=uuid(`announcement-${key}-${t.key}`);await add('work_hub_announcements',{id:announcement,...ownership,channel_id:channel,title:'Weekly operations update — Demo',body:`${marker} Review work assignments, transport arrivals, gate coverage, and outstanding approvals.`,published_by_id:ids.primary,published_at:t.createdAt});await add('work_hub_announcement_recipients',{id:uuid(`recipient-${announcement}`),announcement_id:announcement,user_id:uid,viewed_at:t.createdAt});}
  }
 }
 await c.query('commit');report.enrichment={inserted,reused,checklists:120,forms:120,formSubmissions:116,crews:3};await writeFile(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({complete:true,...report.enrichment}));
}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally {await c.end();}
