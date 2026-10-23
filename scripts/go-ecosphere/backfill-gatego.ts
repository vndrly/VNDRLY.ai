/** Additive GateGo sample operations. Default: transaction rolled back.
 * Run: pnpm --filter @workspace/scripts exec tsx ../scripts/go-ecosphere/backfill-gatego.ts [--apply]
 * Optional GO_DEMO_NOW freezes the 30-past / 7-ahead window for reproducible reruns.
 * Never creates users, changes credentials, sends messages, or resets tables.
 */
import "../load-env-local.mjs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { WorkdayEventSchema, WorkdaySnapshotSchema, summarizeWorkday } from "../../lib/api-zod/src/workday";
import { assembleShiftSnapshot, type ShiftRecord } from "../../artifacts/api-server/src/services/gate-change-over-snapshot";

const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const VERSION = "gatego-operations-v2", VENDOR = 1115, PARTNER = 614;
const MARKER = `[${VERSION}] Fictional GateGo test data; no real attendance, GPS proof, payroll approval or payment.`;
const APPLY = process.argv.includes("--apply"), CHECK = process.argv.includes("--check");
const NOW = new Date(process.env.GO_DEMO_NOW ?? Date.now());
if (!Number.isFinite(+NOW)) throw Error("Invalid GO_DEMO_NOW");
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(NOW);
// These sample posts currently live in the September/October CDT window.
if (!/^2026-(09|10)-/.test(date)) throw Error("This dated sample batch needs review outside September/October 2026");
const midnight = Date.parse(`${date}T00:00:00-05:00`);
const at = (offset: number, hour = 0, minute = 0) => new Date(midnight + (offset * 24 + hour) * 3600000 + minute * 60000);
const min = (value: Date, minutes: number) => new Date(+value + minutes * 60000);
const iso = (value: Date | string) => new Date(value).toISOString();
const uuid = (key: string) => { const h = createHash("sha256").update(`${VERSION}:${key}`).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const target = new URL(process.env.DATABASE_URL ?? "");
if (!((target.hostname === "db.bihjmgbdzbhcnsuhzzwo.supabase.co" || target.hostname.endsWith(".pooler.supabase.com")) && target.username === "postgres.bihjmgbdzbhcnsuhzzwo" && target.pathname === "/postgres")) throw Error("Unexpected database target");
const c = new Client({ connectionString: target.toString() });
const stats: Record<string, number> = {};
const tables = new Set(["work_hub_shifts","work_hub_shift_assignments","gate_shifts","gate_preparations","gate_handovers","gate_duty_sessions","gate_shift_actions","work_hub_tasks","work_hub_task_events","work_hub_messages","work_hub_notes","work_hub_meetings","work_hub_meeting_occurrences","work_hub_meeting_participants","work_hub_calls","work_hub_availability","work_hub_shift_requests","work_hub_form_templates","work_hub_form_instances","work_hub_form_submissions","assets","site_visits","safety_events","assistant_action_audit","tickets","ticket_crew","ticket_line_items","ticket_status_history","invoices","invoice_lines","invoice_ticket_links"]);
const colCache = new Map<string, Map<string,string>>();
async function insert(table: string, rows: Record<string, any>[]) {
  if (!tables.has(table)) throw Error(`Unapproved table ${table}`);
  if (!rows.length) return;
  if (!colCache.has(table)) colCache.set(table, new Map((await c.query("select column_name,udt_name from information_schema.columns where table_schema='public' and table_name=$1", [table])).rows.map((r: any) => [r.column_name,r.udt_name])));
  const types = colCache.get(table)!, cols = Object.keys(rows[0]);
  if (cols.some(k => !types.has(k)) || rows.some(r => Object.keys(r).join() !== cols.join())) throw Error(`Invalid/inconsistent ${table} columns`);
  for (let i = 0; i < rows.length; i += 200) {
    const params: unknown[] = [], chunk = rows.slice(i, i + 200);
    const values = chunk.map(row => `(${cols.map(key => { const v = row[key]; params.push(v == null ? null : types.get(key) === "jsonb" ? JSON.stringify(v) : v); return `$${params.length}`; }).join(",")})`).join(",");
    const result = await c.query(`insert into ${table} (${cols.map(k=>`"${k}"`).join(",")}) values ${values} on conflict do nothing`, params);
    stats[table] = (stats[table] ?? 0) + result.rowCount;
  }
}
async function assert(condition: unknown, message: string) { if (!condition) throw Error(message); }
async function report() {
  return (await c.query(`select
    (select count(*) from work_hub_shifts where owner_org_type='vendor' and owner_org_id=$1 and starts_at >= $2 and starts_at < $3) as scheduled_posts,
    (select count(*) from gate_shifts where station_id=any($4::uuid[])) as watches,
    (select count(*) from gate_shifts where station_id=any($4::uuid[]) and ended_at is null) as active_watches,
    (select count(*) from gate_handovers h join gate_preparations p on p.id=h.preparation_id join gate_shifts s on s.id=p.shift_id where s.station_id=any($4::uuid[])) as handovers,
    (select count(*) from site_visits where site_location_id=any($5::int[]) and check_out_time is null) as visits_on_site,
    (select count(*) from work_hub_tasks where owner_org_type='vendor' and owner_org_id=$1) as tasks,
    (select count(*) from work_hub_messages m join work_hub_channels ch on ch.id=m.channel_id where ch.owner_org_type='vendor' and ch.owner_org_id=$1) as messages,
    (select count(*) from work_hub_form_templates where owner_org_type='vendor' and owner_org_id=$1) as form_templates,
    (select count(*) from assets where responsible_org_type='vendor' and responsible_org_id=$1) as inventory_assets`, [VENDOR,at(-30),at(8),stations.map(s=>s.id),stations.map(s=>s.site_id)])).rows[0];
}
let stations: any[] = [];
await c.connect();
try {
  await c.query(CHECK ? "BEGIN READ ONLY" : "BEGIN");
  await c.query("SET LOCAL lock_timeout='5s'");
  await c.query("SET LOCAL statement_timeout='60s'");
  const org = (await c.query("select id,name from vendors where id=$1", [VENDOR])).rows[0];
  await assert(org?.name === "GateGo", "GateGo organization identity changed");
  const people = (await c.query("select p.user_id,p.id as people_id,p.vendor_role,u.display_name,u.username from vendor_people p join users u on u.id=p.user_id where p.vendor_id=$1 and p.deleted_at is null and p.is_active=true order by p.user_id", [VENDOR])).rows;
  await assert(people.length >= 14 && people.some((p: any) => p.user_id===1142 && p.display_name==="Sharon Pike") && people.some((p: any)=>p.user_id===1143 && p.display_name==="Luis Ortega"), "Fictional cast identity changed");
  const users = people.map((p: any)=>p.user_id), names = new Map(people.map((p: any)=>[p.user_id,p.display_name]));
  const keepers = people.filter((p: any)=>p.vendor_role==="gatekeeper").map((p: any)=>p.user_id);
  stations = (await c.query("select g.id,g.site_id,s.name from gate_stations g join site_locations s on s.id=g.site_id where g.active=true and s.id=any($1::int[]) and exists(select 1 from site_work_assignments a where a.site_location_id=s.id and a.vendor_id=$2 and a.is_gate_contractor=true) order by g.site_id", [[399,400,401],VENDOR])).rows;
  await assert(stations.length===3, "Expected exactly three GateGo stations");
  if (CHECK) { console.log(JSON.stringify({date,mode:"read-only",totals:await report()},null,2)); await c.query("ROLLBACK"); }
  else {
    // Serializes only this fixture batch; all application permissions and tables stay intact.
    await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[VERSION]);
    const channels = (await c.query("select id,name,context_id from work_hub_channels where owner_org_type='vendor' and owner_org_id=$1",[VENDOR])).rows;
    const all = channels.find((ch: any)=>ch.name.includes("All Hands"))!.id;
    const supervisors = channels.find((ch: any)=>ch.name.includes("Supervisors"))!.id;
    const stationChannel = (station: any)=>channels.find((ch: any)=>ch.context_id===station.id)?.id ?? all;
    const existingPosts = (await c.query("select s.*,coalesce((select jsonb_agg(a.user_id order by a.created_at) from work_hub_shift_assignments a where a.shift_id=s.id and a.status in ('assigned','accepted','claimed')),'[]') as workers from work_hub_shifts s where s.owner_org_type='vendor' and s.owner_org_id=$1 and s.gate_station_id=any($2::uuid[])",[VENDOR,stations.map(s=>s.id)])).rows;
    const posts: any[] = [], newPosts: any[] = [], assignments: any[] = [];
    for(let d=-30;d<=7;d++) for(let half=0;half<2;half++) for(let index=0;index<3;index++) {
      const station=stations[index], start=at(d,half?18:6),end=min(start,720);
      const old=existingPosts.find((p: any)=>p.gate_station_id===station.id && +new Date(p.starts_at)===+start && +new Date(p.ends_at)===+end);
      const id=old?.id??uuid(`post:${station.id}:${iso(start)}`);
      const gap=!old && d>=5 && half===1 && index<2;
      const worker=old?.workers[0]??(gap?null:keepers[((d+30)*6+half*3+index)%keepers.length]);
      await assert(worker==null || users.includes(worker),"Assignment outside GateGo cast");
      posts.push({id,station,start,end,worker,gap:worker==null});
      if(!old) newPosts.push({id,owner_org_type:"vendor",owner_org_id:VENDOR,channel_id:stationChannel(station),title:`${station.name} — ${half?"Night":"Day"} gate post`,starts_at:start,ends_at:end,timezone:"America/Chicago",open:gap,qualification_codes:["Texas Level II Security"],instructions:`Log entries, verify visitor briefing, review carry-forward actions. ${MARKER}`,site_location_id:station.site_id,gate_station_id:station.id,required_staff_count:1,created_by_id:1144,created_at:at(-30),work_start_policy:"on_site"});
      if(!old && worker) assignments.push({id:uuid(`assignment:${id}:${worker}`),shift_id:id,user_id:worker,status:"assigned",assigned_by_id:1144,created_at:at(-30)});
    }
    // Existing schedules are authoritative; no reassignments or duplicate periods.
    await insert("work_hub_shifts",newPosts); await insert("work_hub_shift_assignments",assignments);

    const oldDuties=(await c.query("select * from gate_duty_sessions where station_id=any($1::uuid[])",[stations.map(s=>s.id)])).rows;
    // Close only expired, originally seeded duty records; never a live or non-synthetic session.
    const closed=await c.query(`update gate_duty_sessions d set ended_at=s.ends_at,ended_by_user_id=d.user_id,end_reason=$1
      from work_hub_shifts s where d.work_hub_shift_id=s.id and s.owner_org_type='vendor' and s.owner_org_id=$2
      and d.post_coverage->>'synthetic'='true' and d.user_id=any($3::int[]) and d.ended_at is null and s.ends_at < $4`,[`${MARKER} Scheduled sample post ended.`,VENDOR,users,NOW]);
    stats.expired_synthetic_duties_closed=closed.rowCount;
    const priorWatches=(await c.query("select * from gate_shifts where station_id=any($1::uuid[])",[stations.map(s=>s.id)])).rows;
    const watches: any[]=[], duties: any[]=[], audits: any[]=[];
    const existingAudit=new Set((await c.query("select target_id from assistant_action_audit where vendor_id=$1 and tool_input->>'sampleBatch'=$2",[VENDOR,VERSION])).rows.map((r: any)=>r.target_id));
    for(const p of posts.filter(p=>p.worker && +p.start<+NOW)) {
      const id=uuid(`watch:${p.id}`),ended=+p.end<=+NOW?p.end:null;
      const old=priorWatches.find((w: any)=>w.station_id===p.station.id && +new Date(w.started_at)===+p.start);
      if(!ended && priorWatches.some((w: any)=>w.station_id===p.station.id && !w.ended_at && w.id!==id)) continue;
      if(!old) watches.push({id,station_id:p.station.id,operator_id:p.worker,started_at:p.start,ended_at:ended});
      p.watchId=old?.id??id;
      if(!oldDuties.some((d: any)=>d.work_hub_shift_id===p.id && d.user_id===p.worker)) duties.push({id:uuid(`duty:${p.id}`),station_id:p.station.id,user_id:p.worker,work_hub_shift_id:p.id,source_legacy_shift_id:old?.id??id,started_at:p.start,ended_at:ended,ended_by_user_id:ended?p.worker:null,end_reason:ended?"Sample shift handed over":null,source:"web",idempotency_key:`${VERSION}:duty:${p.id}`,created_at:p.start,post_coverage:{vendorId:VENDOR,synthetic:true,sampleBatch:VERSION}});
      const clockId=uuid(`clock:${p.id}:${p.worker}`);
      if(existingAudit.has(clockId)) continue;
      const start=WorkdayEventSchema.parse({id:uuid(`clock-start:${p.id}`),shiftId:clockId,owner:{type:"vendor",id:VENDOR},workerUserId:p.worker,kind:"start_shift",capturedAt:iso(p.start),receivedAt:iso(p.start),source:"worker_report"});
      const events=[start];
      if(ended)events.push(WorkdayEventSchema.parse({...start,id:uuid(`clock-end:${p.id}`),kind:"end_shift",capturedAt:iso(ended),receivedAt:iso(ended)}));
      const snapshot=WorkdaySnapshotSchema.parse({id:clockId,version:events.length,owner:start.owner,workerUserId:p.worker,timezone:"America/Chicago",summary:summarizeWorkday(events)});
      const audit=(target_type:string,target_id:string,tool_output:any,created_at:Date)=>({user_id:p.worker,actor_role:"field_employee",vendor_id:VENDOR,client_surface:"work-hub",input_mode:"typed",provider:"synthetic",tool_name:"workday",action_type:"workday-record",target_type,target_id,tool_input:{sampleBatch:VERSION,notice:MARKER},tool_output,result_status:"completed",created_at});
      for(let i=0;i<events.length;i++) {const event=events[i],summary=summarizeWorkday(events.slice(0,i+1));audits.push(audit("workday-event",event.id,{fingerprint:createHash("sha256").update(event.id).digest("hex"),event,receipt:{operationId:event.id,shiftId:clockId,version:i+1,event,summary}},new Date(event.capturedAt)));}
      audits.push(audit("workday",clockId,snapshot,ended??p.start));
    }
    await insert("gate_shifts",watches); await insert("gate_duty_sessions",duties); await insert("assistant_action_audit",audits);

    // Recent physical activity is explicitly a manual sample, never a verified GPS report.
    const existingVisitKeys=new Set((await c.query("select notes from site_visits where site_location_id=any($1::int[]) and notes like $2",[stations.map(s=>s.site_id),`%${VERSION}%`])).rows.map((r: any)=>r.notes));
    const visits:any[]=[];
    const visitors=[["Darren","Wells","Permian Pump Services"],["Kelly","Mercer","Basin Tank Testing"],["Omar","Vega","West Lease Electric"],["Jenna","Holt","Red Mesa Water"],["Trent","Abbott","Prairie Well Service"],["Alma","Rios","Basin Safety Supply"]];
    for(let d=-30;d<=0;d++)for(let si=0;si<3;si++)for(let n=0;n<7;n++) {
      const station=stations[si],start=at(d,7+n*1.5,si*3); if(+start>+NOW)continue;
      const key=`${MARKER} visit:${station.site_id}:${iso(start)}`;if(existingVisitKeys.has(key))continue;
      const person=visitors[(n+si+d+60)%visitors.length],end=min(start,50+(n%4)*45),pending=d===0&&n===3,active=d===0&&n>=1;
      const worker=posts.find(p=>p.station.id===station.id&&+p.start<=+start&&+p.end>+start)?.worker??1143;
      visits.push({site_location_id:station.site_id,first_name:person[0],last_name:person[1],company:person[2],vehicle_plate:`DEMO${si}${n}${String(d+30).padStart(2,"0")}`,plate_state:"TX",purpose:["Pump inspection","Produced-water pickup","Electrical maintenance","Safety supply delivery"][n%4],expected_duration_minutes:n===1?30:180,host_type:"partner",host_partner_id:PARTNER,check_in_time:start,check_out_time:pending||active||+end>+NOW?null:end,recorded_by_user_id:worker,admission_status:pending?"pending":"admitted",entry_category:"visitor",observation_source:"gatekeeper",reconciliation_state:n===2&&d===0?"needs_supervisor_review":"not_required",notes:key,check_in_gps_evidence:{status:"unavailable",synthetic:true,physicalProofVerified:false},created_at:start});
    }
    await insert("site_visits",visits);
    const records=(await c.query("select * from site_visits where site_location_id=any($1::int[])",[stations.map(s=>s.site_id)])).rows;
    const preps:any[]=[],handovers:any[]=[],actions:any[]=[];
    for(const station of stations) {
      const chain=posts.filter(p=>p.station.id===station.id&&p.watchId).sort((a,b)=>+a.start-+b.start);
      const itemId=uuid(`carry:${station.id}`),text=`${station.site_id===399?"Verify east gate arm lamp after dusk":station.site_id===400?"Confirm heavy-haul escort before releasing convoy":"Replenish visitor badge stock in booth"}. ${MARKER}`;
      actions.push({id:uuid(`action:${station.id}`),station_id:station.id,actor_id:1143,item_id:itemId,kind:"open",text,created_at:at(-1,17)});
      for(let i=0;i<chain.length;i++) {
        const p=chain[i];if(+p.end>+NOW)continue;
        const prepId=uuid(`prep:${p.watchId}`);
        const rs:ShiftRecord[]=records.filter((r:any)=>r.site_location_id===station.site_id&&+new Date(r.check_in_time)<=+p.end).map((r:any)=>({id:`visit:${r.id}`,kind:"visitor",name:`${r.first_name} ${r.last_name}`,company:r.company,plate:r.vehicle_plate?`${r.plate_state??"?"}:${r.vehicle_plate}`:null,checkIn:iso(r.check_in_time),checkOut:r.check_out_time?iso(r.check_out_time):null,admission:r.admission_status,expectedMinutes:r.expected_duration_minutes,reconciliation:r.reconciliation_state,notes:r.notes}));
        const snap=assembleShiftSnapshot(rs,[{id:itemId,text,status:"open"}],iso(p.start),p.end);
        preps.push({id:prepId,shift_id:p.watchId,prepared_by:p.worker,snapshot:snap,notes:`${station.name}: radio and keys accounted for; visitor register reconciled. ${text}`,summary:{source:"factual",facts:snap.facts},created_at:min(p.end,-3)});
        if(chain[i+1])handovers.push({id:uuid(`handover:${p.watchId}`),preparation_id:prepId,incoming_shift_id:chain[i+1].watchId,incoming_user_id:chain[i+1].worker,outgoing_name:names.get(p.worker),incoming_name:names.get(chain[i+1].worker),acknowledged_at:p.end});
      }
    }
    await insert("gate_shift_actions",actions);await insert("gate_preparations",preps);await insert("gate_handovers",handovers);
    await insert("gate_shift_actions",stations.map(station=>({id:uuid(`action-brief:${station.id}`),station_id:station.id,actor_id:1143,item_id:uuid(`carry:${station.id}`),kind:"reopen",text:`${station.site_id===399?"Verify east gate arm lamp after dusk":station.site_id===400?"Confirm heavy-haul escort before releasing convoy":"Replenish visitor badge stock in booth"}. (Sample)`,created_at:NOW})));
    // Set only this batch's historical pointer; immutable preparation contents remain untouched.
    if(preps.length)await c.query("update gate_shifts s set preparation_id=p.id from gate_preparations p where p.shift_id=s.id and s.id=any($1::uuid[]) and s.preparation_id is null",[preps.map(p=>p.shift_id)]);

    // Current preview watches need a reviewable handoff, using exactly the same
    // visit + employee facts and item ordering as the live canonical snapshot.
    const currentPreps:any[]=[];
    for(const p of posts.filter(p=>p.watchId===uuid(`watch:${p.id}`)&&+p.start<+NOW&&+p.end>+NOW)) {
      const watch=(await c.query("select preparation_id from gate_shifts where id=$1",[p.watchId])).rows[0];
      if(watch?.preparation_id && watch.preparation_id!==uuid(`current-prep:${p.watchId}`))continue; // Never overwrite an employee's saved notes.
      const source=(await c.query(`SELECT 'visit:' || id AS id,'visitor' AS kind,trim(first_name || ' ' || last_name) AS name,company,
        CASE WHEN vehicle_plate IS NULL THEN NULL ELSE coalesce(plate_state,'?') || ':' || vehicle_plate END AS plate,
        check_in_time AS "checkIn",check_out_time AS "checkOut",admission_status AS admission,expected_duration_minutes AS "expectedMinutes",reconciliation_state AS reconciliation,
        concat_ws(E'\\n',notes,check_out_notes,conflict_reason) AS notes FROM site_visits
        WHERE site_location_id=$1 AND (check_out_time IS NULL OR check_out_time >= $2 OR check_in_time >= $2)
        UNION ALL SELECT 'checkin:' || ci.id,'employee',trim(vp.first_name || ' ' || vp.last_name),v.name,NULL,ci.check_in_at,ci.check_out_at,NULL,NULL,NULL,NULL
        FROM ticket_check_ins ci JOIN tickets t ON t.id=ci.ticket_id JOIN vendor_people vp ON vp.id=ci.employee_id AND vp.vendor_id=t.vendor_id JOIN vendors v ON v.id=t.vendor_id
        WHERE t.site_location_id=$1 AND (ci.check_out_at IS NULL OR ci.check_out_at >= $2 OR ci.check_in_at >= $2) ORDER BY id LIMIT 25001`,[p.station.site_id,p.start])).rows;
      const items=(await c.query(`SELECT DISTINCT ON(item_id) item_id AS id,text,CASE WHEN kind='resolve' THEN 'resolved' ELSE 'open' END AS status
        FROM gate_shift_actions WHERE station_id=$1 AND kind IN ('open','resolve','reopen') ORDER BY item_id,created_at DESC,id DESC`,[p.station.id])).rows;
      const snap=assembleShiftSnapshot(source.map((r:any)=>({...r,checkIn:iso(r.checkIn),checkOut:r.checkOut?iso(r.checkOut):null})),items,iso(p.start),NOW);
      currentPreps.push({id:uuid(`current-prep-brief:${p.watchId}`),shift_id:p.watchId,prepared_by:p.worker,snapshot:snap,notes:`Relief briefing for ${p.station.name}: verify the open visitor register with the next operator, confirm expected departures, and review the carried-forward booth action. Radio, keys and emergency access checked. (Sample)`,summary:{source:"structured_facts",facts:snap.facts,sampleBatch:VERSION},created_at:NOW});
    }
    await insert("gate_preparations",currentPreps);
    if(currentPreps.length)await c.query("update gate_shifts s set preparation_id=p.id from gate_preparations p where p.id=any($1::uuid[]) and p.shift_id=s.id and (s.preparation_id is null or s.preparation_id=any($2::uuid[]))",[currentPreps.map(p=>p.id),currentPreps.map(p=>uuid(`current-prep:${p.shift_id}`))]);

    // Future handoff plans belong to scheduled work/notes, not to the historical
    // acknowledgment ledger. No future watch or incoming review is fabricated.
    const handoffPlans:any[]=[];
    for(const station of stations)for(let d=1;d<=7;d++)for(let half=0;half<2;half++) {
      const start=at(d,half?18:6),p=posts.find(p=>p.station.id===station.id&&+p.start===+start);
      const previous=posts.find(p=>p.station.id===station.id&&+p.end===+start);
      handoffPlans.push({id:uuid(`handoff-plan:${station.id}:${iso(start)}`),channel_id:stationChannel(station),title:`Planned handoff — ${station.name} — ${iso(start).slice(0,10)} ${half?"18:00":"06:00"}`,body:`PLANNED — not yet acknowledged. Outgoing: ${names.get(previous?.worker)??"Relief to be assigned"}. Incoming: ${names.get(p?.worker)??"Open coverage; shift offer pending"}. Review vehicle/visitor register, expected departures, radio and key custody, and booth carry-forward actions before taking over. ${MARKER}`,created_by_id:1144,updated_by_id:1144,created_at:NOW,updated_at:NOW});
    }
    await insert("work_hub_notes",handoffPlans);

    const tasks:any[]=[],messages:any[]=[],notes:any[]=[],availability:any[]=[],offers:any[]=[];
    const taskTitles=["Reconcile visitor register and vehicle count","Inspect gate arm and emergency release","Restock badges and verify radio batteries","Review overnight exceptions with GasGo","Publish next week's relief roster","Check first-aid and spill-kit seals"];
    for(let d=-30;d<=7;d++) {
      for(let n=0;n<3;n++) {
        const due=at(d,16+n),worker=n===0?1142:n===1?1144:keepers[(d+30)%keepers.length];
        const status=d<-2?"completed":d<0?"in_progress":"open";
        tasks.push({id:uuid(`task:${date}:${d}:${n}`),owner_org_type:"vendor",owner_org_id:VENDOR,channel_id:n<2?supervisors:all,title:taskTitles[(d+30+n)%taskTitles.length],description:`${stations[n].name}. ${MARKER}`,status,priority:n===0?"high":"normal",assignee_user_id:worker,created_by_id:1143,due_at:due,created_at:min(due,-1440),updated_at:status==="completed"?min(due,-40):min(due,-1440)});
      }
      if(d<=0)for(let si=0;si<3;si++) {
        const station=stations[si],time=at(d,8,15+si);if(+time>+NOW)continue;
        const p=posts.find(p=>p.station.id===station.id&&+p.start<=+time&&+p.end>+time);
        messages.push({id:uuid(`message:${station.id}:${iso(time)}`),channel_id:stationChannel(station),author_user_id:p?.worker??1143,kind:"text",body:`${["Morning register reconciled. Expect pump-service crew before noon.","Radio check complete. Visitor badges and spare batteries restocked.","Water-haul traffic steady; hold oversized equipment for escort.","Relief briefing: east approach clear, verify all contractor work orders."][(d+30+si)%4]} ${MARKER}`,client_operation_id:uuid(`message-op:${station.id}:${iso(time)}`),created_at:time});
      }
    }
    for(const station of stations) notes.push({id:uuid(`note:${station.id}`),channel_id:stationChannel(station),title:`${station.name} — booth reference`,body:`Emergency assembly: marked visitor parking. Inspect gate arm before each watch. Log all visitors; flag manual GPS exceptions for supervisor review. Carry forward unfinished actions in Shift handoff. ${MARKER}`,created_by_id:1143,updated_by_id:1143,created_at:at(-30),updated_at:at(-1,10)});
    for(let i=0;i<keepers.length;i++) {
      availability.push({id:uuid(`availability:${date}:${keepers[i]}`),owner_org_type:"vendor",owner_org_id:VENDOR,user_id:keepers[i],starts_at:at(1),ends_at:at(8),available:i%4!==0,created_at:NOW});
      await c.query(`insert into work_hub_device_preferences(user_id,owner_org_type,owner_org_id,native_operations) values($1,'vendor',$2,$3::jsonb)
        on conflict(user_id,owner_org_type,owner_org_id) do update set native_operations=coalesce(work_hub_device_preferences.native_operations,'{}'::jsonb)||$3::jsonb
        where work_hub_device_preferences.user_id=any($4::int[])`,[keepers[i],VENDOR,JSON.stringify({onCallActive:i%3===0,sampleAvailability:MARKER}),users]);
    }
    for(const p of posts.filter(p=>p.gap&&+p.start>+NOW))for(let i=0;i<2;i++) offers.push({id:uuid(`offer:${p.id}:${i}`),shift_id:p.id,request_type:"offer",requested_by_id:1144,target_user_id:keepers[(i+7)%keepers.length],status:i?"declined":"pending",warning_snapshot:[],decided_by_id:i?keepers[(i+7)%keepers.length]:null,decided_at:i?NOW:null,created_at:min(NOW,-60*(i+1))});
    await insert("work_hub_tasks",tasks);await insert("work_hub_messages",messages);await insert("work_hub_notes",notes);await insert("work_hub_availability",availability);await insert("work_hub_shift_requests",offers);

    const meeting=uuid("meeting:daily-relief"),occurrences:any[]=[],participants:any[]=[],calls:any[]=[];
    await insert("work_hub_meetings",[{id:meeting,owner_org_type:"vendor",owner_org_id:VENDOR,channel_id:all,title:"GateGo relief and safety briefing",agenda:`Traffic outlook, handoff notes, staffing and safety moment. ${MARKER}`,timezone:"America/Chicago",recording_allowed:false,created_by_id:1143,created_at:at(-30),admission_mode:"company_open"}]);
    for(let d=-30;d<=7;d++) {
      const start=at(d,17,40),end=min(start,15),id=uuid(`meeting:${iso(start)}`);
      occurrences.push({id,meeting_id:meeting,starts_at:start,ends_at:end,status:+end<+NOW?"ended":"scheduled",created_at:min(start,-1440)});
      for(const user of [1142,1143,1144,...keepers.slice((d+30)%8,(d+30)%8+3)])participants.push({id:uuid(`participant:${id}:${user}`),occurrence_id:id,user_id:user,role:user===1143?"host":"participant",rsvp:+end<+NOW?"accepted":"pending"});
      if(d<0) {
        const callId=uuid(`call:${date}:${d}`),occurrenceId=uuid(`call-occurrence:${date}:${d}`),recipient=keepers[(d+30)%keepers.length];
        occurrences.push({id:occurrenceId,meeting_id:meeting,starts_at:at(d,10),ends_at:at(d,10,6),status:"ended",created_at:at(d,10)});
        for(const user of [1143,recipient])participants.push({id:uuid(`participant:${occurrenceId}:${user}`),occurrence_id:occurrenceId,user_id:user,role:user===1143?"host":"participant",rsvp:"accepted"});
        calls.push({id:callId,caller_user_id:1143,recipient_user_id:recipient,occurrence_id:occurrenceId,status:"ended",created_at:at(d,10),answered_at:at(d,10,1),ended_at:at(d,10,6)});
      }
    }
    await insert("work_hub_meeting_occurrences",occurrences);await insert("work_hub_meeting_participants",participants);await insert("work_hub_calls",calls);

    const definition=[{id:"gate-condition",label:"Gate arm and emergency access clear",type:"checkbox",required:true,options:[]},{id:"radios",label:"Radio and spare battery count",type:"number",required:true,options:[]},{id:"notes",label:"Items needing supervisor attention",type:"textarea",required:false,options:[]}];
    const template=uuid("form:booth-inspection"),instances:any[]=[],submissions:any[]=[];
    await insert("work_hub_form_templates",[{id:template,owner_org_type:"vendor",owner_org_id:VENDOR,name:"GateGo booth readiness checklist",definition,created_by_id:1143,created_at:at(-30)}]);
    for(let d=-30;d<=7;d++)for(let si=0;si<3;si++) {
      const due=at(d,7),worker=posts.find(p=>p.station.id===stations[si].id&&+p.start<=+due&&+p.end>+due)?.worker??1143,id=uuid(`form:${stations[si].id}:${iso(due)}`);
      instances.push({id,template_id:template,template_version:1,channel_id:stationChannel(stations[si]),assignee_user_id:worker,definition_snapshot:definition,due_at:due,created_at:min(due,-60),assignment_metadata:{synthetic:true,sampleBatch:VERSION}});
      if(+due<+NOW&&d<-1)submissions.push({id:uuid(`submission:${id}`),instance_id:id,version:1,submitted_by_id:worker,values:{"gate-condition":true,radios:3,notes:`Booth checked, radio functional. ${MARKER}`},submitted_at:min(due,-5)});
    }
    await insert("work_hub_form_instances",instances);await insert("work_hub_form_submissions",submissions);
    const assets:any[]=[];
    for(let si=0;si<3;si++)for(let n=0;n<4;n++)assets.push({id:uuid(`asset:${stations[si].id}:${n}`),name:`GateGo ${["portable radio","spare radio","visitor tablet","spill kit"][n]} — ${stations[si].name}`,category:n<2?"communications":n===2?"electronics":"safety",legal_owner_name:"GateGo",responsible_org_type:"vendor",responsible_org_id:VENDOR,current_location_type:"site",current_location_id:String(stations[si].site_id),status:"active",created_by_user_id:1144,created_at:at(-30),updated_at:at(-1)});
    await insert("assets",assets);
    const oldSafety=new Set((await c.query("select event_number from safety_events where vendor_id=$1",[VENDOR])).rows.map((r:any)=>r.event_number));
    const safety:any[]=[];
    for(let i=0;i<6;i++) {const key=`DEMO-GG-${date}-${i}`;if(oldSafety.has(key))continue;safety.push({event_number:key,event_type:"observation",status:i<4?"closed":"submitted",title:["Gate arm warning light inspection","Visitor parking access review","Booth fire extinguisher inspection","Speed-limit sign replacement","Review muddy shoulder at entry","Check night visibility at cattle guard"][i],description:MARKER,site_location_id:stations[i%3].site_id,partner_id:PARTNER,vendor_id:VENDOR,reported_by_user_id:1143,is_anonymous:false,is_high_potential:false,is_recordable:false,is_stop_work:false,closed_at:i<4?at(-20+i*3,16):null,closed_by_user_id:i<4?1143:null,created_at:at(-25+i*5,9),updated_at:at(-25+i*5,10)});}
    await insert("safety_events",safety);

    // Extend the existing commercial history without touching its old tickets or invoices.
    const catalog=(await c.query("select work_type_id from vendor_work_types where vendor_id=$1 order by id limit 1",[VENDOR])).rows[0];
    await assert(catalog,"Missing GateGo service catalog");
    const existingTickets=new Set((await c.query("select notes from tickets where vendor_id=$1",[VENDOR])).rows.map((r:any)=>r.notes));
    const approved:any[]=[];
    for(let d=-5;d<=7;d++)for(const station of stations) {
      const start=at(d,6),end=at(d+1,6),key=`${MARKER} coverage:${station.site_id}:${iso(start)}`;
      if(existingTickets.has(key))continue;
      const worker=posts.find(p=>p.station.id===station.id&&+p.start===+start)?.worker??keepers[0];
      const person=people.find((p:any)=>p.user_id===worker);
      const status=d< -2?"approved":d<0?"pending_review":+start<+NOW?"in_progress":"initiated";
      const ended=d<0,arrived=+start<+NOW;
      const t=(await c.query(`insert into tickets(site_location_id,vendor_id,field_employee_id,work_type_id,status,lifecycle_state,intake_channel,description,notes,
        check_in_time,check_out_time,scheduled_start_at,scheduled_duration_minutes,scheduled_at,scheduled_by_id,created_by_id,approved_at,created_at,updated_at)
        values($1,$2,$3,$4,$5,$6,'web',$7,$8,$9,$10,$11,1440,$12,1144,1144,$13,$12,$14) returning id`,
        [station.site_id,VENDOR,person.people_id,catalog.work_type_id,status,ended?"off_site":arrived?"on_site":"pending_arrival",`Gate coverage — ${station.name} — ${iso(start).slice(0,10)}`,key,arrived?start:null,ended?end:null,start,min(start,-1440),status==="approved"?min(end,180):null,ended?end:min(start,-1440)])).rows[0];
      stats.tickets=(stats.tickets??0)+1;
      await insert("ticket_crew",[{ticket_id:t.id,employee_id:person.people_id,added_by_user_id:1144,added_at:min(start,-1440),ack_status:"accepted",ack_at:min(start,-60),ack_note:MARKER}]);
      await insert("ticket_status_history",[{ticket_id:t.id,from_status:null,to_status:status,actor_user_id:1144,actor_role:"vendor",reason:MARKER,created_at:ended?end:min(start,-1440)}]);
      if(ended) {
        await insert("ticket_line_items",[{ticket_id:t.id,type:"labor",description:`Two 12-hour gate coverage posts. ${MARKER}`,quantity:"24",unit_price:"28.00",created_at:end}]);
        if(status==="approved")approved.push({id:t.id,end});
      }
    }
    const number=`DEMO-GATEGO-${date.replaceAll("-","")}-V2`;
    if(approved.length && !(await c.query("select id from invoices where vendor_id=$1 and invoice_number=$2",[VENDOR,number])).rowCount) {
      const subtotal=approved.length*24*28;
      const invoice=(await c.query(`insert into invoices(invoice_number,vendor_id,partner_id,cadence,status,period_start,period_end,due_date,subtotal,tax_total,total,paid_amount,notes,generated_at,created_at)
        values($1,$2,$3,'weekly','draft',$4,$5,$6,$7,0,$7,0,$8,$9,$9) returning id`,[number,VENDOR,PARTNER,at(-5),at(-2),at(30),subtotal,MARKER,NOW])).rows[0];
      stats.invoices=1;
      await insert("invoice_ticket_links",approved.map(t=>({invoice_id:invoice.id,ticket_id:t.id,approved_at:min(t.end,180)})));
      await insert("invoice_lines",approved.map((t,i)=>({invoice_id:invoice.id,ticket_id:t.id,source_type:"ticket_line_item",line_type:"labor_regular",description:`Sample gate coverage #${t.id}`,quantity:"24",unit:"hour",unit_price:"28.00",amount:"672.00",taxable:false,tax_amount:"0",sort_order:i,created_at:NOW})));
    }

    // Check canonical state before committing. A failure rolls back the complete batch.
    const invalid=(await c.query("select s.id from gate_shifts s where s.station_id=any($1::uuid[]) and (s.started_at>$2 or s.ended_at<s.started_at)",[stations.map(s=>s.id),NOW])).rows;
    await assert(!invalid.length,"Invalid watch chronology");
    const totals=await report();await assert(Number(totals.active_watches)===3,"Expected one active watch per GateGo station");
    await assert(Number(totals.scheduled_posts)>=228,"Incomplete 38-day station schedule");
    const result={mode:APPLY?"applied":"dry-run-rolled-back",sampleBatch:VERSION,date,asOf:iso(NOW),window:{from:iso(at(-30)),through:iso(at(8))},inserted:stats,totals};
    await c.query(APPLY?"COMMIT":"ROLLBACK");
    await mkdir(new URL("../../.local/gatego/",import.meta.url),{recursive:true});
    await writeFile(new URL(`../../.local/gatego/${APPLY?"applied":"dry-run"}.json`,import.meta.url),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  }
} catch(error) { await c.query("ROLLBACK");throw error; }
finally { await c.end(); }
