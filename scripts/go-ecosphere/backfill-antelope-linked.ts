/** Scoped, additive GateGo linked-gate sample. Dry run unless --apply.
 * No existing staff assignments, credentials or watch custody are replaced.
 * Synthetic evidence is explicitly marked; no invitations or alerts are sent.
 */
import '../load-env-local.mjs';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {WorkdayEventSchema,WorkdaySnapshotSchema,summarizeWorkday} from '../../lib/api-zod/src/workday';
import {assembleShiftSnapshot} from '../../artifacts/api-server/src/services/gate-change-over-snapshot';
const req=createRequire(new URL('../package.json',import.meta.url));
const {Client}=createRequire(new URL('../../lib/db/package.json',import.meta.url))('pg');
const bcrypt=req('bcryptjs');
const BATCH='antelope-linked-30plus7-2026-10-30',VENDOR=1115,SITE=399,PARTNER=614,ACTOR=1144;
const EAST='44c6bfee-e3a1-4a49-a1f0-b3ff58ffb82c',STAFFGO='411a091d-cd2e-4a22-8d82-87db1370e553';
const uid=(key:string)=>{const h=createHash('sha256').update(`${BATCH}:${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
const WEST=uid('west-gate'),NORTH=uid('north-gate'),GROUP=uid('parallel-link');
const APPLY=process.argv.includes('--apply');
const url=new URL(process.env.DATABASE_URL!);
if(url.username!=='postgres.bihjmgbdzbhcnsuhzzwo'||url.pathname!=='/postgres'||!url.hostname.endsWith('.pooler.supabase.com'))throw Error('Unexpected database target');
const c=new Client({connectionString:url.toString()});
const hash=(x:any)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const iso=(v:any)=>new Date(v).toISOString();
const stats:Record<string,number>={};const types=new Map<string,Map<string,string>>();
const allowed=new Set(['gate_stations','users','user_org_memberships','managed_subcontractor_worker_sponsorships','managed_subcontractor_role_grants','work_hub_channels','work_hub_channel_members','workforce_staffing_requirements','work_hub_shifts','work_hub_shift_assignments','workforce_coverage_resolutions','workforce_assignment_states','workforce_coverage_records','gate_shifts','gate_work_sessions','gate_duty_sessions','assistant_action_audit','work_hub_availability','site_visits','gate_preparations','gate_handovers','gate_shift_actions','work_hub_notes','work_hub_tasks','work_hub_task_events','work_hub_messages']);
async function rows(sql:string,args:any[]=[]){return (await c.query(sql,args)).rows}
async function insert(table:string,row:Record<string,any>){
 if(!allowed.has(table))throw Error(`Unexpected table ${table}`);
 if(!types.has(table))types.set(table,new Map((await rows("select column_name,udt_name from information_schema.columns where table_schema='public' and table_name=$1",[table])).map((r:any)=>[r.column_name,r.udt_name])));
 const t=types.get(table)!;
 if(table==='assistant_action_audit'){
  if((await rows('select id from assistant_action_audit where vendor_id=$1 and target_type=$2 and target_id=$3 and tool_input->>\'sampleBatch\'=$4',[VENDOR,row.target_type,row.target_id,BATCH])).length)return;
  row={...row};delete row.id;
 }
 const cols=Object.keys(row);if(cols.some(k=>!t.has(k)))throw Error(`Unknown ${table} column`);
 const values=cols.map(k=>row[k]==null?null:t.get(k)==='jsonb'?JSON.stringify(row[k]):row[k]);
 const result=await c.query(`insert into ${table}(${cols.map(k=>`"${k}"`).join(',')}) values(${cols.map((_,i)=>`$${i+1}`).join(',')}) on conflict do nothing returning id`,values);
 stats[table]=(stats[table]??0)+result.rowCount;return result.rows[0]?.id;
}
function assert(ok:any,message:string):asserts ok{if(!ok)throw Error(message)}
function destination(lat:number,lng:number,bearing:number){const a=1609.344/6371008.8,b=bearing*Math.PI/180,p=lat*Math.PI/180,l=lng*Math.PI/180;const p2=Math.asin(Math.sin(p)*Math.cos(a)+Math.cos(p)*Math.sin(a)*Math.cos(b));return {latitude:+(p2*180/Math.PI).toFixed(7),longitude:+((l+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(p),Math.cos(a)-Math.sin(p)*Math.sin(p2)))*180/Math.PI).toFixed(7)}}
const mark={sampleBatch:BATCH,synthetic:true,notificationsSent:false,physicalProofVerified:false};
await c.connect();
try{
 await c.query('BEGIN');await c.query("set local lock_timeout='5s'");await c.query("set local statement_timeout='60s'");
 await c.query('select pg_advisory_xact_lock(hashtext($1))',[BATCH]);
 await c.query("select pg_advisory_xact_lock(hashtext('gate-definitions:1115'))");
 assert((await rows('select name from vendors where id=$1',[VENDOR]))[0]?.name==='GateGo','Wrong vendor');
 const site=(await rows('select * from site_locations where id=$1 for update',[SITE]))[0];assert(site?.partner_id===PARTNER,'Wrong site');
 const east=(await rows('select * from gate_stations where id=$1 for update',[EAST]))[0];assert(east?.site_id===SITE&&east.active&&['Main Gate','East Gate'].includes(east.name),'East gate differs');
 const priorAssignments=await rows("select to_jsonb(a) record from work_hub_shift_assignments a join work_hub_shifts s on s.id=a.shift_id where s.owner_org_type='vendor' and s.owner_org_id=$1 and s.gate_station_id<>$2 order by a.id",[VENDOR,WEST]);
 const priorWatches=await rows('select to_jsonb(s) record from gate_shifts s where station_id=any($1::uuid[]) and ended_at is null order by id',[[EAST,'976bb725-c2d7-4217-a329-ca441edad33b','f5ba7544-170d-4453-a942-4127e03bd6bc']]);
 const credentialHash=(await rows("select encode(digest(string_agg(id::text||password_hash,',' order by id),'sha256'),'hex') hash from users where username not like '%@antelope-staffgo.example.invalid'"))[0]?.hash;
 const now=(await rows('select now() now'))[0].now;
 const day=(await rows("select to_char(now() at time zone 'America/Chicago','YYYY-MM-DD') as \"day\""))[0].day;
 assert(day==='2026-10-30','This reviewed batch is dated October 30');
 const windows=await rows(`select to_char(d,'YYYY-MM-DD') as "day",extract(dow from d)::int weekday,h,
  (d::date+case when h=0 then time '06:00' else time '18:00' end) at time zone 'America/Chicago' starts,
  ((d::date+case when h=0 then 0 else 1 end)+case when h=0 then time '18:00' else time '06:00' end) at time zone 'America/Chicago' ends
  from generate_series($1::date-30,$1::date+7,interval '1 day') d cross join generate_series(0,1) h order by d,h`,[day]);
 const from=windows[0].starts,through=windows.at(-1).ends;
 const since=new Date(+new Date(from)-15*86400000),northClosed=new Date(+new Date(now)-14*86400000);
 const backup={inspectedAt:iso(now),site:{id:site.id,name:site.name,gate_link_id:site.gate_link_id,gate_link_name:site.gate_link_name},gates:await rows('select * from gate_stations where site_id=$1',[SITE]),preservedAssignments:hash(priorAssignments),preservedActiveWatches:hash(priorWatches)};
 await mkdir(new URL('../../.local/',import.meta.url),{recursive:true});
 if(APPLY)await writeFile(new URL('../../.local/antelope-linked-before.json',import.meta.url),JSON.stringify(backup,null,2),{flag:'wx'}).catch((e:any)=>{if(e.code!=='EEXIST')throw e});
 // Rename the actual gate, preserving its ID. The retired duplicate stays retired.
 await c.query("update gate_stations set name='East Gate',version=version+1 where id=$1 and name='Main Gate'",[EAST]);
 await c.query("update gate_stations set name='East Gate (Archived)',version=version+1 where site_id=$1 and id<>$2 and active=false and lower(name)='main gate'",[SITE,EAST]);
 await c.query("update site_locations set gate_link_id=coalesce(gate_link_id,$2),gate_link_name=coalesce(gate_link_name,'Antelope Draw') where id=$1",[SITE,GROUP]);
 const west=destination(east.latitude,east.longitude,270),north=destination(east.latitude,east.longitude,0);
 await insert('gate_stations',{id:WEST,site_id:SITE,name:'West Gate',...west,geofence_radius_m:150,active:true,created_at:since});
 await insert('gate_stations',{id:NORTH,site_id:SITE,name:'North Gate',...north,geofence_radius_m:150,active:false,version:2,created_at:since});
 // Only labels belonging to this site/gate are changed; physical evidence is not replaced.
 const renames:Record<string,number>={};
 for(const [key,sql]of Object.entries({
  shifts:"update work_hub_shifts set title=regexp_replace(title,'Main Gate','East Gate','gi'),updated_at=now() where owner_org_type='vendor' and owner_org_id=1115 and gate_station_id=$1 and title~*'Main Gate'",
  requirements:"update workforce_staffing_requirements set pattern_name=regexp_replace(pattern_name,'Main Gate','East Gate','gi') where owner_org_type='vendor' and owner_org_id=1115 and gate_definition->>'stationId'=$1 and pattern_name~*'Main Gate'",
  notes:"update work_hub_notes set title=regexp_replace(title,'Main Gate','East Gate','gi'),body=regexp_replace(body,'Main Gate','East Gate','gi') where channel_id in (select id from work_hub_channels where owner_org_type='vendor' and owner_org_id=1115 and context_id=$1) and (title||body)~*'Main Gate'",
  messages:"update work_hub_messages set body=regexp_replace(body,'Main Gate','East Gate','gi') where channel_id in (select id from work_hub_channels where owner_org_type='vendor' and owner_org_id=1115 and context_id=$1) and body~*'Main Gate'",
  preparations:"update gate_preparations p set notes=regexp_replace(notes,'Main Gate','East Gate','gi'),snapshot=regexp_replace(snapshot::text,'Main Gate','East Gate','gi')::jsonb,summary=regexp_replace(summary::text,'Main Gate','East Gate','gi')::jsonb where shift_id in (select id from gate_shifts where station_id=$1) and (notes||snapshot::text||summary::text)~*'Main Gate'",
  actions:"update gate_shift_actions set text=regexp_replace(text,'Main Gate','East Gate','gi') where station_id=$1 and text~*'Main Gate'",
  entryEvidence:"update site_visits set check_in_gps_evidence=jsonb_set(check_in_gps_evidence,'{gateName}','\"East Gate\"') where check_in_gps_evidence->>'gateStationId'=$1 and check_in_gps_evidence->>'gateName'~*'^Main Gate$'",
  exitEvidence:"update site_visits set check_out_gps_evidence=jsonb_set(check_out_gps_evidence,'{gateName}','\"East Gate\"') where check_out_gps_evidence->>'gateStationId'=$1 and check_out_gps_evidence->>'gateName'~*'^Main Gate$'",
 }))renames[key]=(await c.query(sql,[EAST])).rowCount;
 await c.query("update work_hub_channels set name='Gate | Antelope Draw | East Gate' where owner_org_type='vendor' and owner_org_id=$1 and context_id=$2",[VENDOR,EAST]);
 const channelId=uid('west-channel');
 await insert('work_hub_channels',{id:channelId,owner_org_type:'vendor',owner_org_id:VENDOR,context_kind:'gate',context_id:WEST,name:'Gate | Antelope Draw | West Gate',status:'active',visibility:'group',created_by_id:ACTOR,created_at:since,updated_at:since});
 const people:any[]=[];
 for(const [i,name]of ['Riley Brooks','Avery Castillo','Morgan Hayes','Jordan Ellis'].entries()){
  const email=name.toLowerCase().replace(' ','.')+'@antelope-staffgo.example.invalid';
  let user=(await rows('select id,display_name from users where username=$1',[email]))[0];
  if(!user){const id=await insert('users',{username:email,email,display_name:name,role:'field_employee',password_hash:await bcrypt.hash(randomBytes(32).toString('base64url'),10),created_at:since});user={id,display_name:name}}
  assert(user?.id&&user.display_name===name,'Sample worker collision');
  const enrollment={state:'accepted',userId:user.id,email,acceptedAt:iso(since),...mark};
  let member=(await rows("select id from user_org_memberships where user_id=$1 and vendor_id=$2 and org_type='vendor'",[user.id,VENDOR]))[0];
  if(!member)member={id:await insert('user_org_memberships',{user_id:user.id,org_type:'vendor',vendor_id:VENDOR,role:'field_employee',created_at:since,staff_enrollment:enrollment})};
  await c.query('update users set active_membership_id=$2 where id=$1 and active_membership_id is null',[user.id,member.id]);
  const sponsorship=uid(`sponsorship:${i}`);
  await insert('managed_subcontractor_worker_sponsorships',{id:sponsorship,worker_user_id:user.id,sponsor_vendor_id:VENDOR,managed_organization_id:STAFFGO,status:'active',invited_by_user_id:ACTOR,staff_enrollment:enrollment,created_at:since,updated_at:since});
  await insert('managed_subcontractor_role_grants',{id:uid(`grant:${i}`),sponsorship_id:sponsorship,role:'gatekeeper',site_id:SITE,status:'active',granted_by_user_id:ACTOR,created_at:since});
  people.push({id:user.id,name,index:i,sponsorship});
 }
 const eastChannel=(await rows('select id from work_hub_channels where owner_org_type=\'vendor\' and owner_org_id=$1 and context_id=$2',[VENDOR,EAST]))[0].id;
 const allChannel=(await rows("select id from work_hub_channels where owner_org_type='vendor' and owner_org_id=$1 and name like '%All Hands%'",[VENDOR]))[0].id;
 for(const channel of [channelId,eastChannel,allChannel])for(const person of [...people,{id:1142},{id:1143},{id:1144}])await insert('work_hub_channel_members',{id:uid(`member:${channel}:${person.id}`),channel_id:channel,user_id:person.id,mode:'member',created_at:since});
 const owner=(w:any)=>people[w.h*2+([0,1,2,3].includes(w.weekday)?0:1)];
 const posts:any[]=[];
 for(const w of windows){
  const id=uid(`post:${w.day}:${w.h}`),definition=uid(`definition:${w.h}`),person=owner(w),ended=+w.ends<=+now;
  await insert('work_hub_shifts',{id,owner_org_type:'vendor',owner_org_id:VENDOR,channel_id:channelId,title:`Antelope Draw Central Tank Battery | West Gate — ${w.h?'PM':'AM'} Shift`,starts_at:w.starts,ends_at:w.ends,timezone:'America/Chicago',open:false,calendar_type:'company',site_location_id:SITE,gate_station_id:WEST,gate_definition_id:definition,required_staff_count:1,qualification_codes:[],work_start_policy:'on_site',milestone_status:ended?'completed':+w.starts<+now?'in_progress':'upcoming',percent_complete:ended?100:0,instructions:`Permanent StaffGO relief rotation. Reconcile East/West shared vehicle register and review prior watch notes. [${BATCH}] Synthetic sample; no payroll approval or GPS proof.`,created_by_id:ACTOR,created_at:since,updated_at:since});
  await insert('work_hub_shift_assignments',{id:uid(`assignment:${id}`),shift_id:id,user_id:person.id,status:'accepted',assigned_by_id:ACTOR,created_at:since,warning_snapshot:[mark]});
  await insert('work_hub_availability',{id:uid(`availability:${id}`),owner_org_type:'vendor',owner_org_id:VENDOR,user_id:person.id,starts_at:w.starts,ends_at:w.ends,available:true,created_at:since});
  await insert('workforce_assignment_states',{id:uid(`confirmation:${id}`),shift_id:id,worker_user_id:person.id,state:'confirmed',acknowledgement_due_at:new Date(+w.starts-86400000),acknowledged_at:since,assigned_by_id:ACTOR,operation_id:uid(`confirm-op:${id}`),created_at:since,updated_at:since,override_reason:`Synthetic confirmed permanent roster [${BATCH}]`});
  await insert('workforce_coverage_records',{id:uid(`coverage:${id}`),shift_id:id,gate_station_id:WEST,vacancy_origin:'new_shift',required_count:1,assigned_count:1,actual_count:+w.starts<+now?1:0,coverage_kind:'general',state:'covered',supervisor_user_id:1143,resolved_at:since,created_at:since,updated_at:since});
  posts.push({...w,id,person,watchId:uid(`watch:${id}`),ended});
 }
 for(let h=0;h<2;h++)for(let weekday=0;weekday<7;weekday++){
  const person=owner({h,weekday}),anchor=posts.find(p=>p.h===h&&p.weekday===weekday)!;
  await insert('workforce_staffing_requirements',{id:uid(`requirement:${h}:${weekday}`),owner_org_type:'vendor',owner_org_id:VENDOR,site_id:SITE,role_code:'general',pattern_name:`Antelope Draw West Gate ${h?'PM':'AM'}`,timezone:'America/Chicago',weekday,starts_at_local:h?'18:00':'06:00',ends_at_local:h?'06:00':'18:00',required_count:1,created_by_id:ACTOR,created_at:since,gate_definition:{id:uid(`definition:${h}`),version:1,stationId:WEST,notes:`Permanent StaffGO weekday relief roster [${BATCH}]`,userIds:[],crewIds:[]}});
  await insert('workforce_coverage_resolutions',{id:uid(`permanent:${h}:${weekday}`),vendor_id:VENDOR,site_id:SITE,gate_station_id:WEST,anchor_shift_id:anchor.id,original_user_id:null,replacement_user_id:person.id,kind:'permanent',effective_date:windows[0].day,weekday,starts_at_local:h?'18:00':'06:00',ends_at_local:h?'06:00':'18:00',timezone:'America/Chicago',created_by_id:ACTOR,operation_id:uid(`perm-op:${h}:${weekday}`),created_at:since});
 }
 // A single visit keeps both physical gate references. North's records all predate closure.
 const visitors=[['Carson','Reed','Prairie Well Service','TX','PLM4821'],['Lena','Torres','Basin Tank Testing','TX','BTT7304'],['Owen','Parker','West Lease Electric','OK','WLE1952'],['Grace','Bennett','Red Mesa Water','TX','RMW6610'],['Mateo','Cruz','Stanton Industrial','NM','SIN3085']];
 const gateInfo=(id:string)=>id===EAST?{name:'East Gate',latitude:east.latitude,longitude:east.longitude}:id===WEST?{name:'West Gate',...west}:{name:'North Gate',...north};
 const evidence=(id:string)=>({status:'unavailable',gateStationId:id,gateName:gateInfo(id).name,siteId:SITE,...mark});
 const existingKeys=new Set((await rows('select notes from site_visits where site_location_id=$1 and notes like $2',[SITE,`%[${BATCH}]%`])).map((r:any)=>r.notes.split('. ')[0]));
 for(const w of windows.filter(w=>w.h===0&&+w.starts<+now))for(let n=0;n<4;n++){
  const start=new Date(+w.starts+(n*125+40)*60000);if(+start>+now)continue;
  const duration=[75,165,240,95][n],exit=new Date(+start+duration*60000),end=+exit<=+now?exit:null;
  const entry=n===3?WEST:EAST,exitGate=n===3?EAST:WEST,p=visitors[(new Date(w.starts).getUTCDate()+n)%visitors.length];
  const key=`[${BATCH}] crossing:${w.day}:${n}. Entered ${gateInfo(entry).name}; ${end?`left via ${gateInfo(exitGate).name}`:`on site, departure not recorded`}. Synthetic manual register.`;
  if(!existingKeys.has(key.split('. ')[0]))await insert('site_visits',{site_location_id:SITE,gate_station_id:entry,first_name:p[0],last_name:p[1],company:p[2],plate_state:p[3],vehicle_plate:p[4],purpose:['Pump inspection','Produced-water pickup','Electrical maintenance','Supply delivery'][n],entry_category:'visitor',admission_status:'admitted',expected_duration_minutes:[120,180,180,120][n],host_type:'partner',host_partner_id:PARTNER,check_in_time:start,check_out_time:end,check_in_gps_evidence:evidence(entry),check_out_gps_evidence:end?evidence(exitGate):null,check_out_notes:end?`Exit confirmed at ${gateInfo(exitGate).name}; entry remains recorded at ${gateInfo(entry).name}.`:null,notes:key,recorded_by_user_id:owner(w).id,observation_source:'gatekeeper',observed_arrival_at:start,observed_departure_at:end,created_at:start});
  if(+exit+600000<+northClosed&&n<2){
   const key=`[${BATCH}] north-history:${w.day}:${n}. Entered ${n? 'East Gate':'North Gate'}; left via ${n?'North Gate':'West Gate'}. North Gate is now inactive. Synthetic manual register.`;
   if(!existingKeys.has(key.split('. ')[0]))await insert('site_visits',{site_location_id:SITE,gate_station_id:n?EAST:NORTH,first_name:p[0],last_name:p[1],company:p[2],plate_state:p[3],vehicle_plate:`N${p[4].slice(1)}`,purpose:'Historic northern service-road access',entry_category:'visitor',admission_status:'admitted',expected_duration_minutes:180,host_type:'partner',host_partner_id:PARTNER,check_in_time:new Date(+start+600000),check_out_time:new Date(+exit+600000),check_in_gps_evidence:evidence(n?EAST:NORTH),check_out_gps_evidence:evidence(n?NORTH:WEST),notes:key,check_out_notes:'North access route subsequently closed; use East or West Gate.',recorded_by_user_id:1143,observation_source:'gatekeeper',created_at:start});
  }
 }
 const watches=posts.filter(p=>+p.starts<+now);
 for(const p of watches){
  const end=p.ended?p.ends:null;
  await insert('gate_shifts',{id:p.watchId,station_id:WEST,operator_id:p.person.id,started_at:p.starts,ended_at:end});
  const workSession=uid(`work-session:${p.id}`);
  await insert('gate_work_sessions',{id:workSession,user_id:p.person.id,work_hub_shift_id:p.id,owner_org_type:'vendor',owner_org_id:VENDOR,start_policy:'on_site',travel_status:'arrived',location_sharing_active:false,tracking_status:'not_required',source:'web',started_at:p.starts,arrived_at:p.starts,ended_at:end,idempotency_key:`${BATCH}:work:${p.id}`,created_at:p.starts});
  await insert('gate_duty_sessions',{id:uid(`duty:${p.id}`),station_id:WEST,user_id:p.person.id,work_hub_shift_id:p.id,work_session_id:workSession,source_legacy_shift_id:p.watchId,started_at:p.starts,ended_at:end,ended_by_user_id:end?p.person.id:null,end_reason:end?'Relieved at scheduled West Gate handover':null,source:'web',idempotency_key:`${BATCH}:duty:${p.id}`,post_coverage:{vendorId:VENDOR,...mark},created_at:p.starts});
  const clock=uid(`clock:${p.id}`),events:any[]=[WorkdayEventSchema.parse({id:uid(`clock-start:${p.id}`),shiftId:clock,owner:{type:'vendor',id:VENDOR},workerUserId:p.person.id,kind:'start_shift',capturedAt:iso(p.starts),receivedAt:iso(p.starts),source:'worker_report'})];
  if(end)events.push(WorkdayEventSchema.parse({...events[0],id:uid(`clock-end:${p.id}`),kind:'end_shift',capturedAt:iso(end),receivedAt:iso(end)}));
  const snap=WorkdaySnapshotSchema.parse({id:clock,version:events.length,owner:events[0].owner,workerUserId:p.person.id,timezone:'America/Chicago',summary:summarizeWorkday(events)});
  const audit=(id:string,target_type:string,target_id:string,tool_output:any,created_at:any)=>({id,user_id:p.person.id,actor_role:'field_employee',vendor_id:VENDOR,client_surface:'work-hub',input_mode:'typed',provider:'synthetic',tool_name:'workday',action_type:'workday-record',target_type,target_id,tool_input:mark,tool_output,result_status:'completed',created_at});
  for(let i=0;i<events.length;i++)await insert('assistant_action_audit',audit(uid(`event-audit:${events[i].id}`),'workday-event',events[i].id,{fingerprint:hash(events[i].id),event:events[i],receipt:{operationId:events[i].id,shiftId:clock,version:i+1,event:events[i],summary:summarizeWorkday(events.slice(0,i+1))}},new Date(events[i].capturedAt)));
  await insert('assistant_action_audit',audit(uid(`clock-audit:${p.id}`),'workday',clock,snap,end??p.starts));
 }
 const visits=await rows('select * from site_visits where site_location_id=$1 order by id',[SITE]);
 const noteTexts=['East gate radio check completed; West gate exit register reconciled against the shared log.','Inspected West Gate arm and pedestrian route. Delivery entered East and departed West; single visit retained.','Water hauler convoy cleared through East; exit plates checked at West. No vehicles left on the northern access road.','West Gate visitor badges and emergency keys handed to relief. North Gate remains inactive.'];
 for(let i=0;i<watches.length;i++){
  const p=watches[i],at=p.ended?p.ends:now,prep=uid(`prep:${p.id}`),note=noteTexts[i%noteTexts.length];
  const recordRows=visits.filter((v:any)=>+v.check_in_time<=+at).map((v:any)=>({id:`visit:${v.id}`,kind:'visitor' as const,name:`${v.first_name} ${v.last_name}`,siteId:SITE,entryGateId:v.gate_station_id,exitGateId:v.check_out_gps_evidence?.gateStationId??null,company:v.company,plate:v.vehicle_plate?`${v.plate_state}:${v.vehicle_plate}`:null,checkIn:iso(v.check_in_time),checkOut:v.check_out_time?iso(v.check_out_time):null,admission:v.admission_status,expectedMinutes:v.expected_duration_minutes,reconciliation:v.reconciliation_state,notes:v.notes}));
  const snapshot=assembleShiftSnapshot(recordRows,[],iso(p.starts),new Date(at));
  await insert('gate_preparations',{id:prep,shift_id:p.watchId,prepared_by:p.person.id,snapshot,notes:`${note}\n[${BATCH}] Sample shift notes signed by ${p.person.name}.`,summary:{source:'structured_facts',facts:snapshot.facts,...mark},created_at:new Date(+at-(p.ended?180000:0))});
  await c.query('update gate_shifts set preparation_id=$2 where id=$1 and preparation_id is null',[p.watchId,prep]);
  await insert('gate_shift_actions',{id:uid(`shift-note:${p.id}`),station_id:WEST,actor_id:p.person.id,item_id:p.watchId,kind:'shift_note',text:note,created_at:new Date(+at-(p.ended?600000:60000))});
  const next=watches[i+1];if(p.ended&&next)await insert('gate_handovers',{id:uid(`handover:${p.id}`),preparation_id:prep,incoming_shift_id:next.watchId,incoming_user_id:next.person.id,outgoing_name:p.person.name,incoming_name:next.person.name,acknowledged_at:p.ends});
  if(i%4===0)await insert('work_hub_messages',{id:uid(`radio:${p.id}`),channel_id:channelId,client_operation_id:uid(`message-op:${p.id}`),author_user_id:p.person.id,kind:'text',body:`West Gate ${p.h?'PM':'AM'} watch: ${note} [${BATCH}]`,created_at:new Date(+p.starts+45*60000)});
 }
 await insert('work_hub_notes',{id:uid('roster-note'),channel_id:channelId,title:'West Gate permanent relief roster',body:`AM 06:00–18:00: Riley Brooks (Sun–Wed), Avery Castillo (Thu–Sat).\nPM 18:00–06:00: Morgan Hayes (Sun–Wed), Jordan Ellis (Thu–Sat).\nStaffGO contracted gatekeepers. Linked East/West register; North Gate inactive since ${iso(northClosed).slice(0,10)}.\n[${BATCH}] Synthetic roster, attendance and hours; no payroll approval or real messages.`,created_by_id:ACTOR,updated_by_id:ACTOR,created_at:since,updated_at:since});
 for(const p of posts.filter(p=>+p.starts>+now))await insert('work_hub_notes',{id:uid(`planned:${p.id}`),channel_id:channelId,title:`Planned West Gate handoff — ${p.day} ${p.h?'PM':'AM'}`,body:`${p.person.name}: review last watch notes, shared East/West arrivals and departures, booth keys and open tasks before assuming responsibility. North Gate remains inactive. [${BATCH}] Planned only; not an acknowledged future watch.`,created_by_id:ACTOR,updated_by_id:ACTOR,created_at:now,updated_at:now});
 for(let i=0;i<posts.length;i+=4){
  const p=posts[i],done=p.ended,id=uid(`task:${p.id}`),time=new Date(+p.starts+90*60000);
  await insert('work_hub_tasks',{id,owner_org_type:'vendor',owner_org_id:VENDOR,channel_id:channelId,title:['Inspect West Gate arm and intercom','Reconcile East-to-West truck register','Check emergency route and North Gate closure','Restock West Gate visitor badges'][Math.floor(i/4)%4],description:`Antelope Draw | West Gate. ${noteTexts[Math.floor(i/4)%4]} [${BATCH}] Synthetic sample.`,status:done?'completed':+p.starts<+now?'in_progress':'open',priority:i%12===0?'high':'normal',assignee_user_id:p.person.id,created_by_id:ACTOR,due_at:new Date(+p.starts+180*60000),created_at:new Date(Math.min(+now,+p.starts-86400000)),updated_at:done?time:now});
  if(done)await insert('work_hub_task_events',{id:uid(`resolution:${id}`),task_id:id,actor_user_id:p.person.id,event_type:'status.completed',detail:{completedById:p.person.id,resolution:'Inspection completed, register reconciled and relief briefed.',...mark},created_at:time});
 }
 // Verify preservation and new associations before committing any changes.
 assert(hash(priorAssignments)===hash(await rows("select to_jsonb(a) record from work_hub_shift_assignments a join work_hub_shifts s on s.id=a.shift_id where s.owner_org_type='vendor' and s.owner_org_id=$1 and s.gate_station_id<>$2 order by a.id",[VENDOR,WEST])),'Existing assignments changed');
 assert(hash(priorWatches)===hash(await rows('select to_jsonb(s) record from gate_shifts s where station_id=any($1::uuid[]) and ended_at is null order by id',[[EAST,'976bb725-c2d7-4217-a329-ca441edad33b','f5ba7544-170d-4453-a942-4127e03bd6bc']])),'Existing live custody changed');
 assert(credentialHash===(await rows("select encode(digest(string_agg(id::text||password_hash,',' order by id),'sha256'),'hex') hash from users where username not like '%@antelope-staffgo.example.invalid'"))[0].hash,'Existing credentials changed');
 const conflicts=await rows(`select a.user_id from work_hub_shift_assignments a join work_hub_shifts x on x.id=a.shift_id join work_hub_shift_assignments b on b.user_id=a.user_id and b.shift_id<>a.shift_id join work_hub_shifts y on y.id=b.shift_id where a.user_id=any($1::int[]) and a.status not in ('cancelled','declined') and b.status not in ('cancelled','declined') and x.starts_at<y.ends_at and x.ends_at>y.starts_at`,[people.map(p=>p.id)]);assert(!conflicts.length,'Overlapping worker schedules');
 const northStaff=(await rows(`select (select count(*) from work_hub_shifts where gate_station_id=$1)::int shifts,(select count(*) from gate_shifts where station_id=$1)::int watches,(select count(*) from workforce_staffing_requirements where gate_definition->>'stationId'=$1::text and retired_at is null)::int requirements`,[NORTH]))[0];assert(!northStaff.shifts&&!northStaff.watches&&!northStaff.requirements,'Inactive North has staffing demand');
 const counts=(await rows(`select count(*)::int shifts,count(*) filter(where (select count(*) from work_hub_shift_assignments a where a.shift_id=s.id and a.status not in ('cancelled','declined'))=1)::int staffed from work_hub_shifts s where gate_station_id=$1 and starts_at between $2 and $3`,[WEST,from,through]))[0];assert(counts.shifts===76&&counts.staffed===76,'West 30+7 coverage incomplete');
 const receipt={batch:BATCH,applied:APPLY,inspectedAt:iso(now),range:{from:windows[0].day,through:windows.at(-1).day},site:SITE,east:EAST,west:{id:WEST,...west},north:{id:NORTH,...north,active:false,...northStaff},people,counts,stats,renames,preserved:{existingAssignments:hash(priorAssignments),activeWatches:hash(priorWatches),credentialsUnchanged:true},notificationsSent:false};
 await c.query(APPLY?'COMMIT':'ROLLBACK');
 await writeFile(new URL(`../../.local/antelope-linked-${APPLY?'receipt':'dry-run'}.json`,import.meta.url),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
}catch(e){await c.query('ROLLBACK');throw e}finally{await c.end()}
